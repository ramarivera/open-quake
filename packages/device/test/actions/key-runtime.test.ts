import { expect, it } from "@effect/vitest";
import {
	Effect,
	Array as EffectArray,
	Fiber,
	Layer,
	Schema,
	TestClock,
} from "effect";
import { HostActionFailed } from "../../src/actions/action-errors.js";
import type { ActionConfig } from "../../src/actions/action-registry.js";
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
			expect(f.feedback.at(-1)?.progress).toBe(100);
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
		expect(f.feedback.at(-1)).toMatchObject({ alert: 1, progress: 100 });
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
				expect(f.feedback.at(-1)?.progress).toBe(100);
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
			expect(f.feedback.at(-1)?.progress).toBe(100);
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
