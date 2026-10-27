import { expect, it } from "@effect/vitest";
import {
	Effect,
	Array as EffectArray,
	Fiber,
	Layer,
	Option,
	Schema,
	TestClock,
} from "effect";
import { HostActionFailed } from "../../src/actions/action-errors.js";
import type { ActionConfig } from "../../src/actions/action-registry.js";
import { createActionDraft } from "../../src/actions/action-registry.js";
import {
	type KeyFeedback,
	KeyRuntime,
	KeyRuntimePort,
} from "../../src/actions/key-runtime-service.js";
import {
	createEmptyProfileKey,
	ProfileEnvelope,
	ProfileJsonObject,
	ProfileKey,
} from "../../src/profiles/profile-contracts.js";
import { managerState } from "../../src/profiles/profile-manager-invariants.js";

function fixture(
	config: unknown,
	unsupported = false,
	delay = 0,
	overrides: Partial<KeyRuntimePort["Type"]> = {},
) {
	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	const rawConfig = Schema.decodeUnknownSync(ProfileJsonObject)(config);
	const key = Schema.decodeUnknownSync(ProfileKey)({
		...empty,
		childrenName: typeof rawConfig.type === "string" ? rawConfig.type : "timer",
		...(unsupported
			? { compatibility: { unsupported: true, source: { synthetic: true } } }
			: {}),
		config: {
			...empty.config,
			...rawConfig,
		},
	});
	let envelope = Schema.decodeUnknownSync(ProfileEnvelope)({
		schemaVersion: 1,
		profiles: [
			{
				id: "p",
				name: "P",
				revision: 0,
				pages: [
					{ id: "one", keys: [Schema.encodeSync(ProfileKey)(key)] },
					{ id: "two", keys: [] },
				],
			},
			{
				id: "q",
				name: "Q",
				revision: 0,
				pages: [{ id: "one", keys: [Schema.encodeSync(ProfileKey)(key)] }],
			},
		],
		activeByDevice: { device: { profileId: "p", pageId: "one" } },
	});
	const feedback: KeyFeedback[] = [],
		calls: ActionConfig[] = [];
	let fail = false;
	const layer = KeyRuntime.DefaultWithoutDependencies.pipe(
		Layer.provide(
			Layer.succeed(KeyRuntimePort, {
				read: Effect.sync(() => envelope),
				execute: (config) =>
					Effect.gen(function* () {
						calls.push(config);
						if (delay) yield* Effect.sleep(delay);
						if (fail) return yield* Effect.fail(new HostActionFailed("failed"));
					}),
				publish: (state) =>
					Effect.sync(() => {
						feedback.push(state);
					}),
				alarm: () => Effect.void,
				select: (deviceId, profileId, pageId) =>
					Effect.sync(() => {
						envelope = {
							...envelope,
							activeByDevice: {
								...envelope.activeByDevice,
								[deviceId]: { profileId, pageId },
							},
						};
					}),
				...overrides,
			}),
		),
	);
	return {
		layer,
		read: () => envelope,
		set: (next: ProfileEnvelope) => {
			envelope = next;
		},
		feedback,
		calls,
		fail: () => {
			fail = true;
		},
		switch: () => {
			envelope = {
				...envelope,
				activeByDevice: { device: { profileId: "q", pageId: "one" } },
			};
		},
		selection: () => envelope.activeByDevice.device,
		nextRevision: () => {
			envelope = {
				...envelope,
				profiles: EffectArray.map(envelope.profiles, (p) => ({
					...p,
					revision: p.revision + 1,
				})),
			};
		},
	};
}
const press = Effect.gen(function* () {
	const runtime = yield* KeyRuntime;
	yield* runtime.activate("device", "1,1", "press");
	yield* runtime.activate("device", "1,1", "release");
});
it.effect(
	"alternates exactly once per press and preserves state across revisions",
	() => {
		const f = fixture({
			type: "hotkeySwitch",
			actions: [
				{ type: "key", value: "control+a" },
				{ type: "key", value: "control+b" },
			],
		});
		return Effect.gen(function* () {
			const r = yield* KeyRuntime;
			yield* r.activate("device", "1,1", "press");
			yield* r.activate("device", "1,1", "press");
			yield* r.activate("device", "1,1", "release");
			f.nextRevision();
			yield* press;
			yield* press;
			expect(f.calls.map((c) => c.actions?.[0])).toEqual([
				{ type: "key", value: "control+a" },
				{ type: "key", value: "control+b" },
				{ type: "key", value: "control+a" },
			]);
			expect(f.feedback.map((s) => s.alternate)).toEqual([1, 0, 1]);
		}).pipe(Effect.provide(f.layer));
	},
);
it.effect(
	"countdown survives profile switching and suppresses an unrelated alarm",
	() => {
		const f = fixture({
			type: "timer",
			actions: [
				{ type: "time", value: 3000 },
				{ type: "sound", value: "" },
			],
		});
		return Effect.gen(function* () {
			yield* press;
			yield* TestClock.adjust(1000);
			expect(f.feedback.some((s) => s.countdown === 2000)).toBe(true);
			f.switch();
			yield* TestClock.adjust(3000);
			expect(f.feedback.some((s) => s.alert === 2)).toBe(false);
		}).pipe(Effect.provide(f.layer));
	},
);
it.effect(
	"timer can be cancelled and expires with alarm and countdown reset",
	() => {
		const f = fixture({
			type: "timer",
			actions: [{ type: "time", value: 3000 }],
		});
		return Effect.gen(function* () {
			yield* press;
			yield* TestClock.adjust(1000);
			yield* press;
			yield* TestClock.adjust(5000);
			expect(f.feedback.filter((s) => s.alert === 2)).toHaveLength(0);
			yield* press;
			yield* TestClock.adjust(3000);
			expect(f.feedback.at(-1)).toMatchObject({ countdown: -1, alert: 2 });
		}).pipe(Effect.provide(f.layer));
	},
);
const sequence = {
	type: "multiActions",
	actions: [],
	subActions: [
		{ config: { type: "hotkey", actions: [{ type: "key", value: "a" }] } },
		{ config: { type: "delay", actions: [{ type: "time", value: 2000 }] } },
		{ config: { type: "hotkey", actions: [{ type: "key", value: "b" }] } },
	],
};
it.effect(
	"sequence awaits delays, exposes progress and cancels remaining operations",
	() => {
		const f = fixture(sequence);
		return Effect.gen(function* () {
			yield* press;
			yield* TestClock.adjust(100);
			expect(f.calls).toHaveLength(1);
			yield* press;
			yield* TestClock.adjust(5000);
			expect(f.calls).toHaveLength(1);
			expect(f.feedback.some((s) => s.progress === 100)).toBe(true);
		}).pipe(Effect.provide(f.layer));
	},
);
it.effect("sequence stops at first failure and completes progress", () => {
	const f = fixture(sequence);
	f.fail();
	return Effect.gen(function* () {
		yield* press;
		yield* TestClock.adjust(5000);
		expect(f.calls).toHaveLength(1);
		expect(f.feedback.some((s) => s.alert === 1 && s.progress === 100)).toBe(
			true,
		);
	}).pipe(Effect.provide(f.layer));
});
it.effect("page navigation wraps, goToPage clamps, groups wrap", () => {
	const f = fixture({
		type: "timer",
		actions: [{ type: "time", value: 1000 }],
	});
	return Effect.gen(function* () {
		const r = yield* KeyRuntime;
		yield* r.navigate("device", 0);
		expect(f.selection()?.pageId).toBe("two");
		yield* r.navigate("device", 1);
		expect(f.selection()?.pageId).toBe("one");
		yield* r.navigate("device", 1, 999);
		expect(f.selection()?.pageId).toBe("two");
		yield* r.navigate("device", 2);
		expect(f.selection()?.profileId).toBe("q");
		yield* r.navigate("device", 3);
		expect(f.selection()?.profileId).toBe("p");
	}).pipe(Effect.provide(f.layer));
});

it.effect(
	"restores countdown completion without leaking an inactive alarm and resets device state",
	() => {
		const f = fixture({
			type: "timer",
			actions: [{ type: "time", value: 3000 }],
		});
		return Effect.gen(function* () {
			const r = yield* KeyRuntime;
			yield* press;
			yield* TestClock.adjust(1000);
			f.switch();
			yield* TestClock.adjust(3000);
			yield* r.navigate("device", 2);
			expect(f.feedback.at(-1)).toMatchObject({ countdown: -1, alert: 0 });
			yield* r.reset("device");
			expect(yield* r.snapshot).toEqual([]);
		}).pipe(Effect.provide(f.layer));
	},
);
it.effect("drops stale panel targets before executing the current key", () => {
	const f = fixture({
		type: "hotkeySwitch",
		actions: [
			{ type: "key", value: "a" },
			{ type: "key", value: "b" },
		],
	});
	return Effect.gen(function* () {
		const r = yield* KeyRuntime;
		yield* r.activate("device", "1,1", "press", {
			profileId: "old",
			pageId: "one",
			revision: 0,
		});
		yield* r.activate("device", "1,1", "release");
		expect(f.calls).toEqual([]);
		yield* press;
		expect(f.calls).toHaveLength(1);
		yield* r.reset("device");
		yield* press;
		expect(f.calls[1]).toEqual(f.calls[0]);
	}).pipe(Effect.provide(f.layer));
});

for (const config of [
	{ type: "goToPage", actions: [] },
	{ type: "goToPage", actions: [{ type: "page", value: 0 }] },
	{ type: "goToPage", actions: [{ type: "page", value: 1.5 }] },
	{ type: "nextPage", actions: [{ type: "page", value: 1 }] },
	{ type: "previousPage", actions: [{ type: "page", value: 1 }] },
])
	it.effect(`rejects malformed navigation ${JSON.stringify(config)}`, () => {
		const f = fixture(config);
		return Effect.gen(function* () {
			const result = yield* Effect.either(press);
			expect(result._tag).toBe("Left");
			expect(f.selection()?.pageId).toBe("one");
		}).pipe(Effect.provide(f.layer));
	});
for (const config of [
	{
		type: "hotkeySwitch",
		actions: [
			{ type: "key", value: "a" },
			{ type: "key", value: "b" },
		],
	},
	{ type: "text", actions: [{ type: "text", value: "synthetic" }] },
	{ type: "goToPage", actions: [{ type: "page", value: 2 }] },
	{ type: "timer", actions: [{ type: "time", value: 1000 }] },
	{ type: "open", actions: [{ type: "path", value: "/synthetic/app" }] },
])
	it.effect(`retains but never activates unsupported ${config.type}`, () => {
		const f = fixture(config, true);
		return Effect.gen(function* () {
			yield* Effect.either(press);
			yield* TestClock.adjust(2000);
			expect(f.calls).toEqual([]);
			expect(f.feedback).toEqual([]);
			expect(f.selection()?.pageId).toBe("one");
		}).pipe(Effect.provide(f.layer));
	});

it.effect(
	"disconnect reset waits for an in-flight shortcut and clears its late alternate",
	() => {
		const f = fixture(
			{
				type: "hotkeySwitch",
				actions: [
					{ type: "key", value: "a" },
					{ type: "key", value: "b" },
				],
			},
			false,
			1000,
		);
		return Effect.gen(function* () {
			const r = yield* KeyRuntime;
			const activating = yield* Effect.fork(
				r.activate("device", "1,1", "press"),
			);
			yield* TestClock.adjust(100);
			const resetting = yield* Effect.fork(r.reset("device"));
			yield* TestClock.adjust(1100);
			yield* Fiber.join(activating);
			yield* Fiber.join(resetting);
			expect(yield* r.snapshot).toEqual([]);
			const again = yield* Effect.fork(press);
			yield* TestClock.adjust(1100);
			yield* Fiber.join(again);
			expect(f.calls[1]).toEqual(f.calls[0]);
		}).pipe(Effect.provide(f.layer));
	},
);
it.effect(
	"disconnect cancels running sequence and timer before later ticks or host effects",
	() => {
		const f = fixture(sequence);
		return Effect.gen(function* () {
			const r = yield* KeyRuntime;
			yield* press;
			yield* TestClock.adjust(100);
			yield* r.reset("device");
			const count = f.calls.length;
			yield* TestClock.adjust(5000);
			expect(f.calls.length).toBe(count);
			expect(yield* r.snapshot).toEqual([]);
		}).pipe(Effect.provide(f.layer));
	},
);

for (const finalGap of [undefined, 60000])
	it.effect(
		`completes sequence without a final ${finalGap ?? "default"} gap and accepts the next tap`,
		() => {
			const f = fixture({
				type: "multiActions",
				actions: [],
				subActions: [
					{
						config: {
							type: "hotkey",
							actions: [{ type: "key", value: "a" }],
							gap: 1500,
						},
					},
					{
						config: {
							type: "hotkey",
							actions: [{ type: "key", value: "b" }],
							...(finalGap === undefined ? {} : { gap: finalGap }),
						},
					},
				],
			});
			return Effect.gen(function* () {
				yield* press;
				yield* TestClock.adjust(0);
				expect(f.calls).toHaveLength(1);
				yield* TestClock.adjust(1499);
				expect(f.calls).toHaveLength(1);
				yield* TestClock.adjust(1);
				expect(f.calls).toHaveLength(2);
				expect(f.feedback.some((s) => s.progress === 100)).toBe(true);
				yield* press;
				yield* TestClock.adjust(0);
				expect(f.calls).toHaveLength(3);
				expect(f.feedback.at(-1)?.progress).toBe(50);
			}).pipe(Effect.provide(f.layer));
		},
	);
it.effect(
	"honors an explicit final delay but finishes without its following gap",
	() => {
		const f = fixture({
			type: "multiActions",
			actions: [],
			subActions: [
				{
					config: {
						type: "delay",
						actions: [{ type: "time", value: 2000 }],
						gap: 60000,
					},
				},
			],
		});
		return Effect.gen(function* () {
			yield* press;
			yield* TestClock.adjust(1999);
			expect(f.feedback.at(-1)?.progress).toBe(0);
			yield* TestClock.adjust(1);
			expect(f.feedback.some((s) => s.progress === 100)).toBe(true);
			yield* press;
			yield* TestClock.adjust(0);
			expect(f.feedback.at(-1)?.progress).toBe(0);
		}).pipe(Effect.provide(f.layer));
	},
);

it.effect(
	"MAIN-065 held contact executes ordinary actions only on successful up, ignores directional keys",
	() => {
		const f = fixture({ type: "nextPage", actions: [] });
		return Effect.gen(function* () {
			const runtime = yield* KeyRuntime;
			yield* runtime.activate("device", "1,1", "down");
			expect(f.selection()?.pageId).toBe("one");
			yield* runtime.activate("device", "1,1", "cancel");
			expect(f.selection()?.pageId).toBe("one");
			yield* runtime.activate("device", "1,1", "down");
			yield* runtime.activate("device", "1,1", "up");
			expect(f.selection()?.pageId).toBe("two");
			yield* runtime.activate("device", "1,1", "up");
			expect(f.selection()?.pageId).toBe("two");
		}).pipe(Effect.provide(f.layer));
	},
);

it.effect(
	"MAIN-065 hotkey down precedes lift and cancellation releases the original owner after profile change",
	() => {
		const edges: string[] = [];
		const f = fixture(
			{ type: "hotkey", actions: [{ type: "hotkey", value: "control+a" }] },
			false,
			0,
			{
				holdHotkey: () =>
					Effect.sync(() => {
						edges.push("down");
						return Effect.sync(() => {
							edges.push("up");
						});
					}),
			},
		);
		return Effect.gen(function* () {
			const runtime = yield* KeyRuntime;
			yield* runtime.activate("device", "1,1", "down");
			yield* runtime.activate("device", "1,1", "down");
			expect(edges).toEqual(["down"]);
			f.switch();
			yield* runtime.activate("device", "1,1", "cancel");
			yield* runtime.activate("device", "1,1", "up");
			expect(edges).toEqual(["down", "up"]);
			expect(f.calls).toEqual([]);
		}).pipe(Effect.provide(f.layer));
	},
);

it.effect(
	"MAIN-065 directional contact edges never execute a normal action",
	() => {
		const f = fixture({ type: "vol", actions: [] });
		return Effect.gen(function* () {
			const runtime = yield* KeyRuntime;
			yield* runtime.activate("device", "1,1", "down");
			yield* runtime.activate("device", "1,1", "up");
			expect(f.calls).toEqual([]);
		}).pipe(Effect.provide(f.layer));
	},
);

it.effect("held release failure retains its owner for reset cleanup", () =>
	Effect.gen(function* () {
		let releases = 0;
		const f = fixture(
			{ type: "hotkey", actions: [{ type: "key", value: "a" }] },
			false,
			0,
			{
				holdHotkey: () =>
					Effect.succeed(
						Effect.suspend(() =>
							++releases === 1
								? Effect.fail(new HostActionFailed("release-failed"))
								: Effect.void,
						),
					),
			},
		);
		yield* Effect.gen(function* () {
			const runtime = yield* KeyRuntime;
			yield* runtime.activate("device", "1,1", "down");
			expect(
				(yield* Effect.either(runtime.activate("device", "1,1", "up")))._tag,
			).toBe("Left");
			yield* runtime.reset("device");
			expect(releases).toBe(2);
		}).pipe(Effect.provide(f.layer));
	}),
);

it.effect(
	"reset reports the catalog release error and retries the original held owner",
	() =>
		Effect.gen(function* () {
			let releases = 0;
			const source = new Error("private /Users/test/key.txt token=secret");
			const failure = new HostActionFailed(source);
			const f = fixture(
				{ type: "hotkey", actions: [{ type: "key", value: "a" }] },
				false,
				0,
				{
					holdHotkey: () =>
						Effect.succeed(
							Effect.suspend(() =>
								++releases === 1 ? Effect.fail(failure) : Effect.void,
							),
						),
				},
			);
			yield* Effect.gen(function* () {
				const runtime = yield* KeyRuntime;
				yield* runtime.activate("device", "1,1", "down");
				f.switch();
				const result = yield* Effect.either(runtime.reset("device"));
				expect(result._tag).toBe("Left");
				if (result._tag === "Left") {
					expect(result.left._tag).toBe("HostActionFailed");
					expect(result.left.code).toBe("QUAKE.ACTION.HOST_FAILED");
					expect(result.left.originalCause).toBe(source);
					expect(JSON.stringify(result.left)).not.toContain("secret");
					expect(JSON.stringify(result.left)).not.toContain("key.txt");
				}
				yield* runtime.reset("device");
				expect(releases).toBe(2);
				yield* runtime.reset("device");
				expect(releases).toBe(2);
			}).pipe(Effect.provide(f.layer));
		}),
);
it.effect("scope disposal retries a failed held-key release", () =>
	Effect.gen(function* () {
		let releases = 0;
		const f = fixture(
			{ type: "hotkey", actions: [{ type: "key", value: "a" }] },
			false,
			0,
			{
				holdHotkey: () =>
					Effect.succeed(
						Effect.suspend(() =>
							++releases === 1
								? Effect.fail(new HostActionFailed("release-failed"))
								: Effect.void,
						),
					),
			},
		);
		yield* Effect.gen(function* () {
			const runtime = yield* KeyRuntime;
			yield* runtime.activate("device", "1,1", "down");
		}).pipe(Effect.provide(f.layer));
		expect(releases).toBe(2);
	}),
);

it.effect(
	"a failed synchronous contact press does not consume the next tap",
	() => {
		let attempts = 0;
		const failure = new HostActionFailed("transient-open-failure");
		const f = fixture(
			{
				type: "website",
				actions: [{ type: "url", value: "https://example.com" }],
			},
			false,
			0,
			{
				execute: () =>
					Effect.suspend(() =>
						++attempts === 1 ? Effect.fail(failure) : Effect.void,
					),
			},
		);
		return Effect.gen(function* () {
			const runtime = yield* KeyRuntime;
			yield* runtime.activate("device", "1,1", "down");
			const first = yield* Effect.either(
				runtime.activate("device", "1,1", "up"),
			);
			expect(first._tag).toBe("Left");
			if (first._tag === "Left")
				expect(first.left.code).toBe("QUAKE.ACTION.HOST_FAILED");
			expect(attempts).toBe(1);
			yield* runtime.activate("device", "1,1", "down");
			yield* runtime.activate("device", "1,1", "up");
			expect(attempts).toBe(2);
		}).pipe(Effect.provide(f.layer));
	},
);

it.effect(
	"touching directional knob hotkeys never acquires or executes a chord",
	() => {
		let acquisitions = 0;
		const f = fixture(
			{
				type: "hotkey",
				supportKnob: true,
				actions: [
					{ type: "key", value: "a" },
					{ type: "key", value: "b" },
				],
			},
			false,
			0,
			{
				holdHotkey: () =>
					Effect.sync(() => {
						acquisitions++;
						return Effect.void;
					}),
			},
		);
		return Effect.gen(function* () {
			const runtime = yield* KeyRuntime;
			for (const finish of ["up", "cancel"] as const) {
				yield* runtime.activate("device", "1,1", "down");
				yield* runtime.activate("device", "1,1", finish);
			}
			expect(acquisitions).toBe(0);
			expect(f.calls).toEqual([]);
		}).pipe(Effect.provide(f.layer));
	},
);

it.effect(
	"MGMT-149 KNOB-073: committed AudioBot dispatches exactly once on release and preserves default agent/model",
	() => {
		let toggles = 0;
		const draft = createActionDraft("audioBot");
		const f = fixture(draft, false, 0, {
			executeOwned: (key, owner) =>
				Effect.sync(() => {
					expect(owner.deviceId).toBe("device");
					expect(key.config.actions).toEqual(draft.actions);
					toggles++;
					return true;
				}),
		});
		return Effect.gen(function* () {
			const runtime = yield* KeyRuntime;
			yield* runtime.activate("device", "1,1", "press");
			expect(toggles).toBe(0);
			yield* runtime.activate("device", "1,1", "release");
			yield* runtime.activate("device", "1,1", "release");
			expect(toggles).toBe(1);
			expect(f.calls).toEqual([]);
		}).pipe(Effect.provide(f.layer));
	},
);

const displayTarget = {
	deviceId: "device",
	profileId: "p",
	pageId: "one",
	revision: 0,
	keyCode: "1,1",
};
const timerDraft = {
	type: "timer",
	actions: [
		{ type: "time", value: 1000 },
		{ type: "callback", value: 1 },
	],
};
it.effect(
	"MAIN-075 MGMT-138: zero waits for clear, then restarts with one owned callback and debounce",
	() => {
		let completed = 0;
		const f = fixture(timerDraft, false, 0, {
			timerCompleted: () =>
				Effect.sync(() => {
					completed++;
				}),
		});
		return Effect.gen(function* () {
			const r = yield* KeyRuntime;
			yield* press;
			yield* TestClock.adjust(599);
			yield* press;
			yield* TestClock.adjust(401);
			expect(completed).toBe(1);
			expect(f.feedback.at(-1)).toMatchObject({
				countdownPhase: "expired",
				timerCompleted: true,
			});
			yield* press;
			expect(f.feedback.at(-1)).toMatchObject({
				countdownPhase: "hidden",
				countdown: -1,
			});
			expect(completed).toBe(1);
			yield* TestClock.adjust(600);
			yield* press;
			yield* TestClock.adjust(1000);
			expect(completed).toBe(2);
			expect((yield* r.snapshot).at(-1)?.countdownPhase).toBe("expired");
		}).pipe(Effect.provide(f.layer));
	},
);
for (const mode of [
	"callback-off",
	"revision",
	"disconnect",
	"inactive",
	"cancel",
] as const) {
	it.effect(`MGMT-138 SCREEN-048: no obsolete completion after ${mode}`, () => {
		let completed = 0,
			alarms = 0;
		const f = fixture(
			{
				...timerDraft,
				actions: [
					...timerDraft.actions.filter((a) => a.type !== "callback"),
					{ type: "callback", value: mode === "callback-off" ? 0 : 1 },
					{ type: "sound", value: "alarm" },
				],
			},
			false,
			0,
			{
				timerCompleted: () =>
					Effect.sync(() => {
						completed++;
					}),
				alarm: () =>
					Effect.sync(() => {
						alarms++;
					}),
			},
		);
		return Effect.gen(function* () {
			const r = yield* KeyRuntime;
			yield* press;
			yield* TestClock.adjust(600);
			if (mode === "revision") f.nextRevision();
			if (mode === "inactive") f.switch();
			if (mode === "disconnect") yield* r.reset("device");
			if (mode === "cancel") yield* press;
			yield* TestClock.adjust(1000);
			expect(completed).toBe(0);
			expect(alarms).toBe(mode === "callback-off" ? 1 : 0);
			if (mode === "inactive") {
				yield* r.navigate("device", 2);
				expect(f.feedback.at(-1)).toMatchObject({
					countdownPhase: "expired",
					alert: 0,
				});
			}
		}).pipe(Effect.provide(f.layer));
	});
}
it.effect(
	"SCREEN-046/047 MGMT-404: typed display timing, zero, -1 and 120 ms suppression",
	() => {
		const f = fixture(timerDraft);
		return Effect.gen(function* () {
			const r = yield* KeyRuntime;
			const event = (time: number) =>
				r.displayEvent({ ...displayTarget, type: "countdown", time });
			yield* event(2000);
			yield* TestClock.adjust(1000);
			expect(f.feedback.at(-1)?.countdown).toBe(1000);
			yield* event(-1);
			expect(f.feedback.at(-1)?.countdownPhase).toBe("hidden");
			yield* r.displayEvent({
				...displayTarget,
				type: "showAlert",
				alertType: 2,
			});
			yield* event(-1);
			expect(f.feedback.at(-1)?.countdownPhase).toBe("expired");
			yield* event(1000);
			expect(f.feedback.at(-1)?.countdownPhase).toBe("hidden");
			yield* TestClock.adjust(119);
			yield* event(1000);
			expect(f.feedback.at(-1)?.countdownPhase).toBe("hidden");
			yield* TestClock.adjust(1);
			yield* event(1000);
			expect(f.feedback.at(-1)?.countdownPhase).toBe("running");
			yield* TestClock.adjust(1);
			yield* event(1000);
			expect(f.feedback.at(-1)?.countdownPhase).toBe("running");
			yield* TestClock.adjust(1000);
			expect(f.feedback.at(-1)?.countdownPhase).toBe("expired");
			yield* r.displayEvent({
				...displayTarget,
				type: "showAlert",
				alertType: 1,
			});
			yield* r.displayEvent({
				...displayTarget,
				type: "progress",
				percent: 33,
			});
			yield* TestClock.adjust(2000);
			expect(f.feedback.at(-1)).toMatchObject({ alert: 0, progress: 33 });
			yield* TestClock.adjust(2999);
			expect(f.feedback.at(-1)?.progress).toBe(33);
			yield* TestClock.adjust(1);
			expect(f.feedback.at(-1)?.progress).toBe(-1);
			yield* r.displayEvent({
				...displayTarget,
				type: "progress",
				percent: 100,
			});
			yield* TestClock.adjust(999);
			expect(f.feedback.at(-1)?.progress).toBe(100);
			yield* TestClock.adjust(1);
			expect(f.feedback.at(-1)?.progress).toBe(-1);
			yield* r.displayEvent({
				...displayTarget,
				type: "showAlert",
				alertType: 3,
			});
			yield* TestClock.adjust(3000);
			expect(f.feedback.at(-1)?.alert).toBe(3);
			yield* r.displayEvent({
				...displayTarget,
				type: "showAlert",
				alertType: 0,
			});
			expect(f.feedback.at(-1)?.alert).toBe(0);
		}).pipe(Effect.provide(f.layer));
	},
);
it.effect(
	"SCREEN-038 MAIN-081: artwork and feedback reject unknown cells, revisions, serials and other profiles",
	() => {
		const f = fixture(timerDraft);
		return Effect.gen(function* () {
			const r = yield* KeyRuntime;
			yield* r.panelMessage("device", {
				...displayTarget,
				type: "showAnimation",
				resourceId: "data:image/png;base64,current",
			});
			expect(f.feedback.at(-1)?.icon).toContain("current");
			for (const patch of [
				{ keyCode: "9,9" },
				{ profileId: "q" },
				{ revision: 1 },
				{ deviceId: "unknown" },
			])
				yield* r.displayEvent({
					...displayTarget,
					...patch,
					type: "showAnimation",
					resourceId: "stale",
				});
			expect(f.feedback).toHaveLength(1);
			f.switch();
			yield* r.displayEvent({
				...displayTarget,
				type: "showAlert",
				alertType: 1,
			});
			expect(f.feedback).toHaveLength(1);
		}).pipe(Effect.provide(f.layer));
	},
);
const pluginSequence = {
	type: "multiActions",
	subActions: [
		{
			config: {
				type: "delay",
				actions: [{ type: "time", value: 200 }],
				gap: 50,
			},
		},
		{
			isPlugin: true,
			pluginId: "example.plugin",
			config: { type: "example.action", actions: [], gap: 100 },
		},
		{
			config: {
				type: "close",
				actions: [
					{ type: "path", value: "/opt/example" },
					{ type: "force", value: "" },
				],
			},
		},
	],
};
it.effect(
	"MAIN-076 MGMT-163: subActions-only sequence awaits nested plugin, gap and feedback",
	() => {
		const log: string[] = [];
		const f = fixture(pluginSequence, false, 0, {
			executePlugin: (step, activation) =>
				Effect.gen(function* () {
					expect(step.pluginId).toBe("example.plugin");
					expect(activation).toMatchObject({ ...displayTarget, stepIndex: 1 });
					log.push("plugin-start");
					yield* Effect.sleep(500);
					log.push("plugin-end");
				}),
		});
		return Effect.gen(function* () {
			yield* press;
			yield* TestClock.adjust(249);
			expect(log).toEqual([]);
			yield* TestClock.adjust(1);
			expect(log).toEqual(["plugin-start"]);
			expect(f.calls).toEqual([]);
			yield* TestClock.adjust(500);
			expect(log).toEqual(["plugin-start", "plugin-end"]);
			expect(f.calls).toEqual([]);
			expect(f.feedback.at(-1)?.progress).toBe(66);
			yield* TestClock.adjust(100);
			expect(f.calls[0]?.type).toBe("close");
			expect(f.feedback.at(-1)?.progress).toBe(100);
		}).pipe(Effect.provide(f.layer));
	},
);
for (const mode of ["unavailable", "failure", "cancel"] as const) {
	it.effect(
		`MAIN-076: nested plugin ${mode} stops following native actions`,
		() => {
			let interrupted = false;
			const f = fixture(
				pluginSequence,
				false,
				0,
				mode === "unavailable"
					? {}
					: {
							executePlugin: () =>
								(mode === "failure"
									? Effect.fail(new HostActionFailed("plugin-failure"))
									: Effect.sleep(10000)
								).pipe(
									Effect.onInterrupt(() =>
										Effect.sync(() => {
											interrupted = true;
										}),
									),
								),
						},
			);
			return Effect.gen(function* () {
				yield* press;
				yield* TestClock.adjust(250);
				if (mode === "cancel") yield* press;
				yield* TestClock.adjust(10000);
				expect(f.calls).toEqual([]);
				expect(interrupted).toBe(mode === "cancel");
				if (mode !== "cancel")
					expect(f.feedback.some((s) => s.alert === 1)).toBe(true);
			}).pipe(Effect.provide(f.layer));
		},
	);
}
it.effect(
	"MAIN-082 SCREEN-108/109: panel messages dispatch known management tabs and leave multi-screen alerts inert",
	() => {
		const f = fixture(timerDraft);
		return Effect.gen(function* () {
			const r = yield* KeyRuntime;
			yield* r.panelMessage("device", {
				type: "functionKeyPressed",
				functionName: "managementCenter",
				tabType: "keys",
			});
			expect(f.calls).toEqual([
				{
					type: "managementCenter",
					actions: [{ type: "tabType", value: "keys" }],
				},
			]);
			for (const serials of [["device"], ["device", "other", "unknown"]])
				yield* r.panelMessage("device", {
					type: "globalAlert",
					alertType: "multi-screen",
					serials,
				});
			yield* r.panelMessage("unknown", {
				type: "functionKeyPressed",
				functionName: "managementCenter",
			});
			expect(
				(yield* Effect.either(
					r.panelMessage("device", {
						type: "functionKeyPressed",
						functionName: "managementCenter",
						tabType: "unknown",
					}),
				))._tag,
			).toBe("Left");
			expect(f.calls).toHaveLength(1);
			expect(f.selection()).toEqual({ profileId: "p", pageId: "one" });
		}).pipe(Effect.provide(f.layer));
	},
);

function savedNavigation(
	type: string,
	actions: readonly { type: string; value: string | number }[] = [],
): typeof ProfileKey.Encoded {
	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey("1,1"));
	return {
		...empty,
		childrenName: type,
		config: { ...empty.config, type, actions },
	};
}
it.effect(
	"MAIN-077 MGMT-142: nested allocated folders and emoji Back restore the saved path; stale return cannot jump",
	() => {
		const f = fixture({
			type: "createFolder",
			actions: [{ type: "folder", value: "folder-a" }],
		});
		const raw = Schema.encodeSync(ProfileEnvelope)(f.read());
		f.set(
			Schema.decodeUnknownSync(ProfileEnvelope)({
				...raw,
				profiles: [
					{
						...raw.profiles[0],
						pages: [
							raw.profiles[0].pages[0],
							{
								id: "folder-a",
								keys: [
									savedNavigation("emojiFolder", [
										{ type: "emojiFolderId", value: "folder-b" },
									]),
								],
							},
							{ id: "folder-b", keys: [savedNavigation("emojiBack")] },
						],
					},
					raw.profiles[1],
				],
			}),
		);
		return Effect.gen(function* () {
			yield* press;
			expect(f.selection()?.pageId).toBe("folder-a");
			yield* press;
			expect(f.selection()?.pageId).toBe("folder-b");
			yield* press;
			expect(f.selection()?.pageId).toBe("folder-a");
			// Replace the current folder entry with Back to return to root.
			const env = f.read();
			f.set({
				...env,
				profiles: EffectArray.map(env.profiles, (p) => ({
					...p,
					pages: EffectArray.map(p.pages, (page) =>
						page.id === "folder-a"
							? {
									...page,
									keys: [
										Schema.decodeUnknownSync(ProfileKey)(
											savedNavigation("back"),
										),
									],
								}
							: page,
					),
				})),
			});
			yield* press;
			expect(f.selection()?.pageId).toBe("one");
			yield* press;
			f.nextRevision();
			const r = yield* KeyRuntime;
			expect(
				(yield* Effect.either(r.activate("device", "1,1", "press")))._tag,
			).toBe("Left");
			yield* r.activate("device", "1,1", "release");
			expect(f.selection()?.pageId).toBe("folder-a");
		}).pipe(Effect.provide(f.layer));
	},
);
for (const ref of ["q", "-1", "-2", "0"]) {
	it.effect(
		`MAIN-078 MGMT-170: saved switchProfile ${ref} respects explicit page and startup default`,
		() => {
			const f = fixture({
				type: "switchProfile",
				actions: [
					{ type: "profile", value: ref },
					{ type: "page", value: 1 },
				],
			});
			f.set({
				...f.read(),
				manager: Option.some({
					...managerState(f.read()),
					startup: Option.some("q"),
				}),
			});
			return Effect.gen(function* () {
				yield* press;
				expect(f.selection()).toEqual({ profileId: "q", pageId: "one" });
			}).pipe(Effect.provide(f.layer));
		},
	);
}
it.effect(
	"MAIN-078: all device slide directions wrap and skip empty groups",
	() => {
		const f = fixture(timerDraft);
		const raw = Schema.encodeSync(ProfileEnvelope)(f.read());
		f.set(
			Schema.decodeUnknownSync(ProfileEnvelope)({
				...raw,
				profiles: [
					...raw.profiles,
					{
						id: "empty",
						name: "1 Empty",
						revision: 0,
						pages: [{ id: "one", keys: [] }],
					},
				],
			}),
		);
		return Effect.gen(function* () {
			const r = yield* KeyRuntime;
			for (const [direction, profileId, pageId] of [
				[0, "p", "two"],
				[1, "p", "one"],
				[2, "q", "one"],
				[3, "p", "one"],
			] as const) {
				yield* r.panelMessage("device", { type: "slide", direction });
				expect(f.selection()).toEqual({ profileId, pageId });
			}
		}).pipe(Effect.provide(f.layer));
	},
);
it.effect(
	"MGMT-206: close and soundboard steps enter the same existing owners in order",
	() => {
		const log: string[] = [];
		const f = fixture(
			{
				type: "multiActions",
				subActions: [
					{
						config: {
							type: "close",
							actions: [
								{ type: "path", value: "/app" },
								{ type: "force", value: "" },
							],
							gap: 0,
						},
					},
					{
						config: {
							type: "playAudioLegacy",
							actions: [{ type: "sound", value: "/sound.wav" }],
							gap: 0,
						},
					},
					{ config: { type: "stopAudio", actions: [], gap: 0 } },
				],
			},
			false,
			0,
			{
				executeOwned: (key) =>
					Effect.sync(() => {
						log.push(key.config.type);
						return true;
					}),
			},
		);
		return Effect.gen(function* () {
			yield* press;
			yield* TestClock.adjust(0);
			expect(f.calls[0]?.type).toBe("close");
			expect(log).toEqual(["playAudioLegacy", "stopAudio"]);
		}).pipe(Effect.provide(f.layer));
	},
);
