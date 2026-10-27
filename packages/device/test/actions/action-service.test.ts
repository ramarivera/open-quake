import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Either, Fiber, Option } from "effect";
import {
	ACTION_REGISTRY,
	ActionPermissionDenied,
	ActionService,
	AUDIO_OPERATIONS,
	normalizeActionImport,
} from "../../src/actions/index.js";
import { nextTrackFixture, switchFixture } from "./action-fixtures.js";
import { config, harness, press } from "./action-harness.js";

describe("action conductor via committed snapshots and fake host consumers", () => {
	it.effect("MAIN-067 alternates committed shortcuts once per press", () => {
		const h = harness("hotkeySwitch", switchFixture.config);
		return Effect.gen(function* () {
			const service = yield* ActionService;
			yield* service.activate(press);
			yield* service.activate({ ...press, sequence: 2 });
			yield* service.activate({ ...press, kind: "release", sequence: 3 });
			yield* service.activate({ ...press, sequence: 4 });
			yield* service.activate({ ...press, kind: "release", sequence: 5 });
			yield* service.activate({ ...press, sequence: 6 });
			expect(h.calls).toEqual([
				["key", "control+a"],
				["key", "control+b"],
				["key", "control+a"],
			]);
		}).pipe(Effect.provide(h.layer()));
	});

	it.effect(
		"executes one press, suppresses held presses, duplicates, repeats, holds and release",
		() => {
			const h = harness();
			return Effect.gen(function* () {
				const service = yield* ActionService;
				expect(yield* service.activate(press)).toBe("executed");
				for (const event of [
					press,
					{ ...press, sequence: 2 },
					{ ...press, kind: "repeat", sequence: 3 },
					{ ...press, kind: "hold", sequence: 4 },
					{ ...press, kind: "release", sequence: 5 },
					press,
				])
					expect(yield* service.activate(event)).toBe("ignored");
				expect(h.calls).toEqual([["website", "https://example.org"]]);
				expect(yield* service.activate({ ...press, sequence: 6 })).toBe(
					"executed",
				);
				expect(h.calls).toHaveLength(2);
			}).pipe(Effect.provide(h.layer()));
		},
	);
	it.effect(
		"does not execute previews, malformed input, stale revisions, pages or sessions",
		() => {
			const h = harness();
			return Effect.gen(function* () {
				const service = yield* ActionService;
				normalizeActionImport(nextTrackFixture);
				yield* Effect.yieldNow();
				expect(h.calls).toEqual([]);
				for (const event of [
					{ ...press, revision: 3 },
					{ ...press, pageId: "old-page" },
					{ ...press, profileId: "old-profile" },
					{ ...press, sessionId: "old-session" },
					{ ...press, deviceId: "other-device" },
					{ ...press, keyCode: "2,8" },
				])
					expect(yield* service.activate(event)).toBe("ignored");
				for (const event of [
					{ ...press, kind: "preview" },
					{ ...press, sequence: -1 },
					{ ...press, origin: "raw-hid" },
				]) {
					const result = yield* Effect.either(service.activate(event));
					expect(result._tag).toBe("Left");
					if (Either.isLeft(result))
						expect(result.left._tag).toBe("InvalidKeyAction");
				}
				expect(h.calls).toEqual([]);
			}).pipe(Effect.provide(h.layer()));
		},
	);
	it.effect(
		"is inert with absent or hidden committed keys and with the fail-closed default layer",
		() => {
			const hidden = harness();
			return Effect.gen(function* () {
				expect(
					yield* ActionService.activate(press).pipe(
						Effect.provide(ActionService.Default),
					),
				).toBe("ignored");
				expect(
					yield* ActionService.activate(press).pipe(
						Effect.provide(
							hidden.layer(hidden.adapters, {
								readCommitted: () => Effect.succeed(Option.none()),
							}),
						),
					),
				).toBe("ignored");
				expect(
					yield* ActionService.activate(press).pipe(
						Effect.provide(
							hidden.layer(hidden.adapters, {
								readCommitted: () =>
									Effect.succeed(
										Option.some({
											...hidden.snapshot,
											keys: hidden.snapshot.keys.map((key) => ({
												...key,
												display: false,
											})),
										}),
									),
							}),
						),
					),
				).toBe("ignored");
				expect(hidden.calls).toEqual([]);
			});
		},
	);
	it.effect(
		"inserts exact newline text once and only explicit enter after success",
		() => {
			const plain = harness("text", config("text", "first\n😀second", "text"));
			const submit = harness("text", {
				type: "text",
				actions: [
					{ type: "text", value: "first\n😀second" },
					{ type: "key", value: "enter" },
				],
			});
			return Effect.gen(function* () {
				yield* ActionService.activate(press).pipe(
					Effect.provide(plain.layer()),
				);
				expect(plain.calls).toEqual([["text", "first\n😀second"]]);
				yield* ActionService.activate(press).pipe(
					Effect.provide(submit.layer()),
				);
				expect(submit.calls).toEqual([
					["text", "first\n😀second"],
					["key", "enter"],
				]);
			});
		},
	);
	it.effect(
		"checks enter capability before insertion and never sends enter after failed insertion",
		() => {
			const h = harness("text", {
				type: "text",
				actions: [
					{ type: "text", value: "do not submit" },
					{ type: "key", value: "enter" },
				],
			});
			const denied = new ActionPermissionDenied(new Error("private text"));
			let insertions = 0;
			return Effect.gen(function* () {
				const missing = yield* Effect.either(
					ActionService.activate(press).pipe(
						Effect.provide(h.layer({ ...h.adapters, keyboard: Option.none() })),
					),
				);
				expect(missing._tag).toBe("Left");
				expect(h.calls).toEqual([]);
				const failed = yield* Effect.either(
					ActionService.activate(press).pipe(
						Effect.provide(
							h.layer({
								...h.adapters,
								text: Option.some({
									insertText: () =>
										Effect.suspend(() => {
											insertions++;
											return Effect.fail(denied);
										}),
								}),
							}),
						),
					),
				);
				if (Either.isLeft(failed))
					expect(failed.left._tag).toBe("ActionPermissionDenied");
				expect(insertions).toBe(1);
				expect(h.calls).toEqual([]);
			});
		},
	);
	it.effect(
		"dispatches supported hotkeys and app references without conversion",
		() => {
			const hotkey = harness(
				"hotkey",
				config("hotkey", "control+right_shift+a"),
			);
			const app = harness(
				"open",
				config("open", "/Applications/Independent Fixture.app", "path"),
			);
			return Effect.gen(function* () {
				yield* ActionService.activate(press).pipe(
					Effect.provide(hotkey.layer()),
				);
				yield* ActionService.activate(press).pipe(Effect.provide(app.layer()));
				expect(hotkey.calls).toEqual([["key", "control+right_shift+a"]]);
				expect(app.calls).toEqual([
					["app", "/Applications/Independent Fixture.app"],
				]);
			});
		},
	);
	for (const entry of ACTION_REGISTRY) {
		if (!("mediaCommand" in entry)) continue;
		it.effect(`dispatches ${entry.id} only as ${entry.mediaCommand}`, () => {
			const h = harness(entry.id, entry.defaultConfig);
			return Effect.gen(function* () {
				yield* ActionService.activate(press);
				yield* ActionService.activate({
					...press,
					kind: "release",
					sequence: 2,
				});
				expect(h.calls).toEqual([["media", entry.mediaCommand]]);
			}).pipe(Effect.provide(h.layer()));
		});
	}
	it.effect(
		"consumes the normalized recovered next-track fixture without previous-track fallback",
		() => {
			const imported = normalizeActionImport(nextTrackFixture).normalized;
			const h = harness(
				"skipForward",
				typeof imported === "object" &&
					imported !== null &&
					"config" in imported
					? imported.config
					: {},
			);
			return Effect.gen(function* () {
				yield* ActionService.activate(press);
				expect(h.calls).toEqual([["media", "audio_next"]]);
			}).pipe(Effect.provide(h.layer()));
		},
	);
	for (const [id, action, expected] of [
		[
			"website",
			config("website", "javascript:private-token", "url"),
			"InvalidKeyAction",
		],
		[
			"hotkey",
			config("hotkey", "Please enter hotkeys for matching"),
			"InvalidKeyAction",
		],
		["open", config("open", "", "path"), "InvalidKeyAction"],
		["open", config("open", "./private-Editor", "path"), "InvalidKeyAction"],
		["unregistered-private-value", {}, "KeyFunctionUnavailable"],
		["nextPage", { type: "nextPage", actions: [] }, "KeyFunctionUnavailable"],
		[
			"dkDesktopClock",
			{
				type: "dkDesktopClock",
				actions: [{ type: "hourFormat", value: "24h" }],
			},
			"KeyFunctionUnavailable",
		],
		[
			"panelBrightness",
			{ type: "panelBrightness", actions: [{ type: "stepPercent", value: 5 }] },
			"KeyFunctionUnavailable",
		],
		[
			"hotkey",
			{
				type: "hotkey",
				supportKnob: true,
				actions: [
					{ type: "key", value: "a" },
					{ type: "key", value: "b" },
				],
			},
			"KeyFunctionUnavailable",
		],
	] as const) {
		it.effect(
			`rejects ${id} as ${expected} without adapter calls or payload diagnostics`,
			() => {
				const h = harness(id, action);
				return Effect.gen(function* () {
					const result = yield* Effect.either(ActionService.activate(press));
					expect(result._tag).toBe("Left");
					if (Either.isLeft(result)) {
						expect(result.left._tag).toBe(expected);
						expect(result.left.code).toBe(
							expected === "InvalidKeyAction"
								? "QUAKE.ACTION.INVALID"
								: "QUAKE.ACTION.UNAVAILABLE",
						);
						expect(JSON.stringify(result.left)).not.toContain("private");
					}
					expect(h.calls).toEqual([]);
				}).pipe(Effect.provide(h.layer()));
			},
		);
	}
	it.effect(
		"rejects unsupported host tokens and individual media commands with no fallback",
		() => {
			const hotkey = harness("hotkey", config("hotkey", "right_control+a"));
			const media = harness("randomPlay", config("randomPlay", "audio_random"));
			return Effect.gen(function* () {
				const chord = yield* Effect.either(
					ActionService.activate(press).pipe(Effect.provide(hotkey.layer())),
				);
				const random = yield* Effect.either(
					ActionService.activate(press).pipe(
						Effect.provide(
							media.layer({
								...media.adapters,
								media: Option.some({
									supportedCommands: new Set(["audio_play"]),
									sendMedia: () => Effect.die("fallback called"),
								}),
							}),
						),
					),
				);
				for (const result of [chord, random]) {
					expect(result._tag).toBe("Left");
					if (Either.isLeft(result))
						expect(result.left._tag).toBe("KeyFunctionUnavailable");
				}
				expect(hotkey.calls).toEqual([]);
				expect(media.calls).toEqual([]);
			});
		},
	);
	it.effect(
		"reserves a press before starting IO, suppressing concurrent publications",
		() => {
			const h = harness();
			return Effect.gen(function* () {
				const started = yield* Deferred.make<void>();
				const finish = yield* Deferred.make<void>();
				yield* Effect.gen(function* () {
					const service = yield* ActionService;
					const first = yield* service.activate(press).pipe(Effect.fork);
					yield* Deferred.await(started);
					expect(yield* service.activate(press)).toBe("ignored");
					yield* Deferred.succeed(finish, undefined);
					expect(yield* Fiber.join(first)).toBe("executed");
				}).pipe(
					Effect.provide(
						h.layer({
							...h.adapters,
							website: Option.some({
								openUrl: () =>
									Effect.gen(function* () {
										h.calls.push(["website", "started"]);
										yield* Deferred.succeed(started, undefined);
										yield* Deferred.await(finish);
									}),
							}),
						}),
					),
				);
				expect(h.calls).toHaveLength(1);
			});
		},
	);
	it.effect(
		"remembers a release whose snapshot read finishes before the preceding press",
		() => {
			const h = harness();
			return Effect.gen(function* () {
				const started = yield* Deferred.make<void>();
				const finish = yield* Deferred.make<void>();
				let reads = 0;
				yield* Effect.gen(function* () {
					const service = yield* ActionService;
					const first = yield* service.activate(press).pipe(Effect.fork);
					yield* Deferred.await(started);
					expect(
						yield* service.activate({ ...press, kind: "release", sequence: 2 }),
					).toBe("ignored");
					expect(h.calls).toEqual([]);
					yield* Deferred.succeed(finish, undefined);
					const firstResult = yield* Fiber.join(first);
					expect(yield* service.activate({ ...press, sequence: 3 })).toBe(
						"executed",
					);
					expect(firstResult).toBe("ignored");
					expect(h.calls).toEqual([["website", "https://example.org"]]);
				}).pipe(
					Effect.provide(
						h.layer(h.adapters, {
							readCommitted: () =>
								Effect.gen(function* () {
									if (++reads === 1) {
										yield* Deferred.succeed(started, undefined);
										yield* Deferred.await(finish);
									}
									return Option.some(h.snapshot);
								}),
						}),
					),
				);
			});
		},
	);
});

it.effect(
	"cleans up an old-revision release and permits a fresh new-profile press",
	() => {
		const h = harness();
		let snapshot = h.snapshot;
		return Effect.gen(function* () {
			const service = yield* ActionService;
			yield* service.activate(press);
			snapshot = {
				...h.snapshot,
				profileId: "profile-b",
				pageId: "page-b",
				revision: 7,
			};
			expect(
				yield* service.activate({ ...press, kind: "release", sequence: 2 }),
			).toBe("ignored");
			expect(
				yield* service.activate({
					...press,
					profileId: "profile-b",
					pageId: "page-b",
					revision: 7,
					sequence: 3,
				}),
			).toBe("executed");
			expect(h.calls).toHaveLength(2);
		}).pipe(
			Effect.provide(
				h.layer(h.adapters, {
					readCommitted: () => Effect.sync(() => Option.some(snapshot)),
				}),
			),
		);
	},
);
it.effect(
	"a changed connection session rejects old events and permits one new-session press",
	() => {
		const h = harness();
		let snapshot = h.snapshot;
		return Effect.gen(function* () {
			const service = yield* ActionService;
			yield* service.activate(press);
			snapshot = { ...h.snapshot, sessionId: "reconnected" };
			expect(yield* service.activate({ ...press, sequence: 2 })).toBe(
				"ignored",
			);
			expect(
				yield* service.activate({ ...press, sessionId: "reconnected" }),
			).toBe("executed");
			expect(h.calls).toHaveLength(2);
		}).pipe(
			Effect.provide(
				h.layer(h.adapters, {
					readCommitted: () => Effect.sync(() => Option.some(snapshot)),
				}),
			),
		);
	},
);
it.effect("a repeat without a press stays inert until release", () => {
	const h = harness();
	return Effect.gen(function* () {
		const service = yield* ActionService;
		expect(yield* service.activate({ ...press, kind: "repeat" })).toBe(
			"ignored",
		);
		expect(yield* service.activate({ ...press, sequence: 2 })).toBe("ignored");
		yield* service.activate({ ...press, kind: "release", sequence: 3 });
		expect(
			yield* service.activate({
				...press,
				sequence: 4,
				origin: "mapped-physical",
			}),
		).toBe("executed");
		expect(h.calls).toHaveLength(1);
	}).pipe(Effect.provide(h.layer()));
});

for (const command of AUDIO_OPERATIONS) {
	it.effect(
		`review: text sends ${command} through media after insertion without a keyboard adapter`,
		() => {
			const h = harness("text", {
				type: "text",
				actions: [
					{ type: "text", value: "first\nsecond" },
					{ type: "key", value: command },
				],
			});
			return Effect.gen(function* () {
				yield* ActionService.activate(press);
				expect(h.calls).toEqual([
					["text", "first\nsecond"],
					["media", command],
				]);
			}).pipe(
				Effect.provide(
					h.layer({
						...h.adapters,
						keyboard: Option.none(),
						media: Option.some({
							supportedCommands: new Set([command]),
							sendMedia: (value) =>
								Effect.sync(() => {
									h.calls.push(["media", value]);
								}),
						}),
					}),
				),
			);
		},
	);
}
for (const mode of ["missing", "unsupported", "insert-failed"] as const) {
	it.effect(
		`review: text media follow-up ${mode} preserves failure and ordering`,
		() => {
			const h = harness("text", {
				type: "text",
				actions: [
					{ type: "text", value: "must not submit" },
					{ type: "key", value: "audio_play" },
				],
			});
			const denied = new ActionPermissionDenied(new Error("synthetic"));
			return Effect.gen(function* () {
				const result = yield* Effect.either(ActionService.activate(press));
				expect(result._tag).toBe("Left");
				if (result._tag === "Left") {
					if (mode === "insert-failed")
						expect(result.left).toMatchObject({
							_tag: "ActionPermissionDenied",
							code: denied.code,
						});
					else
						expect(result.left).toMatchObject({
							_tag: "KeyFunctionUnavailable",
							reason: "unsupported-command",
						});
				}
				expect(h.calls).toEqual([]);
			}).pipe(
				Effect.provide(
					h.layer({
						...h.adapters,
						media:
							mode === "missing"
								? Option.none()
								: mode === "unsupported"
									? Option.some({
											supportedCommands: new Set(),
											sendMedia: () => Effect.die("unexpected media"),
										})
									: h.adapters.media,
						...(mode === "insert-failed"
							? { text: Option.some({ insertText: () => Effect.fail(denied) }) }
							: {}),
					}),
				),
			);
		},
	);
}
