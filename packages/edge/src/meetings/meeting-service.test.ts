import { describe, expect, it } from "@effect/vitest";
import {
	Deferred,
	Effect,
	Either,
	Fiber,
	Layer,
	Option,
	Redacted,
	Schema,
	Stream,
	TestClock,
} from "effect";
import {
	AiCompatibleAdapter,
	type CompatibleAdapter,
} from "../ai/adapters/adapter.js";
import { CredentialRef, type NormalizedEvent } from "../ai/ai-contracts.js";
import { AiCredentials } from "../ai/ai-credentials.js";
import { AiUnavailable } from "../ai/ai-errors.js";
import { AiRepository, MOCK_PROFILE } from "../ai/ai-repository.js";
import { AiProviderService } from "../ai/ai-service.js";
import {
	AiMeetingAdapter,
	type MeetingAdapter,
	type MeetingAsrRequest,
} from "../ai/meeting-adapter.js";
import { MeetingStore } from "./meeting-contracts.js";
import { defaultMeetingConfig } from "./meeting-defaults.js";
import { meetingError } from "./meeting-errors.js";
import {
	type CapturePort,
	MeetingCapture,
	MeetingProgress,
	type MeetingProgressEvent,
} from "./meeting-ports.js";
import { MeetingProvider } from "./meeting-provider.js";
import {
	MeetingRepository,
	type MeetingStorage,
} from "./meeting-repository.js";
import { MeetingService } from "./meeting-service.js";

const segments = [
	{
		id: "sentence",
		speaker: "1",
		startMs: 0,
		endMs: 1000,
		text: "Alex will ship on Friday.",
	},
];
const selected = {
	...MOCK_PROFILE,
	adapter: "openai-compatible",
	auth: "apiKey",
	modelId: "qwen3.6-flash",
	credentialRef: CredentialRef.make("00000000-0000-4000-8000-000000000002"),
} satisfies typeof MOCK_PROFILE;
function setup(recoveredDuration = 2500) {
	const progress: MeetingProgressEvent[] = [];
	const calls: string[] = [],
		requests: MeetingAsrRequest[] = [],
		prompts: Parameters<CompatibleAdapter["open"]>[0][] = [];
	let stored: typeof MeetingStore.Encoded = { version: 1, records: [] };
	let failSummary = false,
		pending = 0,
		failSave = false,
		failDelete = false,
		stopDelay = 0;
	let failStop: string | undefined;
	let nextSave: Effect.Effect<void> = Effect.void;
	let nextStop: Effect.Effect<void> = Effect.void;
	let nextStart: Effect.Effect<void> = Effect.void;
	let nextSubmit: Effect.Effect<void> = Effect.void;
	let nextSummary: Effect.Effect<void> = Effect.void;
	let translationStop: Effect.Effect<void> = Effect.void;
	const storage: MeetingStorage = {
		load: () => Effect.succeed(stored),
		save: (next) =>
			Effect.gen(function* () {
				const wait = nextSave;
				nextSave = Effect.void;
				yield* wait;
				if (failSave)
					return yield* Effect.fail(
						meetingError(
							"StorageFailed",
							new Error("private transcript sk-secret"),
						),
					);
				stored = next;
			}),
		remove: (next, ids) =>
			storage.deleteAudio(ids).pipe(Effect.zipRight(storage.save(next))),
		deleteAudio: (ids) =>
			Effect.suspend(() => {
				calls.push(`delete:${ids.length}`);
				return failDelete
					? Effect.fail(meetingError("StorageFailed"))
					: Effect.void;
			}),
	};
	const capture: CapturePort = {
		mic: () => Effect.succeed(Option.some(true)),
		start: (id, _, parent) =>
			Effect.sync(() => {
				calls.push(`start:${parent ? "side" : "main"}:${id}`);
			}).pipe(Effect.zipRight(Effect.suspend(() => nextStart))),
		drain: (id) =>
			Effect.sync(() => {
				calls.push(`drain:${id}`);
			}),
		duration: () => Effect.succeed(recoveredDuration),
		stop: (id) =>
			Effect.sync(() => {
				calls.push(`stop:${id}`);
			}).pipe(
				Effect.zipRight(Effect.suspend(() => nextStop)),
				Effect.zipRight(
					Effect.suspend(() =>
						id === failStop
							? Effect.fail(meetingError("CaptureFailed"))
							: Effect.void,
					),
				),
				Effect.zipRight(
					Effect.suspend(() =>
						stopDelay > 0 ? Effect.sleep(stopDelay) : Effect.void,
					),
				),
				Effect.tap(() =>
					Effect.sync(() => {
						calls.push(`stopped:${id}`);
					}),
				),
			),
		cancel: (id) =>
			Effect.sync(() => {
				calls.push(`cancel:${id}`);
			}),
		toggleMic: () =>
			Effect.sync(() => {
				calls.push("mic");
			}),
		startTranslation: () =>
			Effect.sync(() => {
				calls.push("translate");
			}),
		stopTranslation: () =>
			Effect.sync(() => {
				calls.push("stop-translation");
			}),
	};
	const adapter: MeetingAdapter = {
		submit: (request) =>
			Effect.sync(() => {
				requests.push(request);
				return "task";
			}).pipe(Effect.zipLeft(Effect.suspend(() => nextSubmit))),
		poll: () =>
			Effect.sync(() => {
				calls.push("poll");
				return pending-- > 0
					? { status: "pending" }
					: { status: "complete", segments };
			}),
		cancel: (id) =>
			Effect.sync(() => {
				calls.push(`cancel-task:${id}`);
			}),
		translate: () => Effect.succeed([]),
		stopTranslation: () => Effect.suspend(() => translationStop),
	};
	const ai = AiProviderService.DefaultWithoutDependencies.pipe(
		Layer.provideMerge(AiRepository.Default),
		Layer.provide(
			Layer.mergeAll(
				Layer.succeed(AiMeetingAdapter, adapter),
				Layer.succeed(AiCredentials, {
					resolve: () => Effect.succeed(Redacted.make("test-only")),
					revoked: () => Effect.never,
				}),
				Layer.succeed(AiCompatibleAdapter, {
					open: (input) => {
						prompts.push(input);
						const opened = failSummary
							? Effect.fail(new AiUnavailable(new Error("private prompt")))
							: Effect.succeed(
									Stream.fromIterable<NormalizedEvent>([
										{
											_tag: "textDelta",
											textDelta: `## Saved summary ${prompts.length}`,
											kind: "generation",
										},
										{ _tag: "completed" },
									]),
								);
						return opened.pipe(
							Effect.zipLeft(Effect.suspend(() => nextSummary)),
						);
					},
				}),
			),
		),
	);
	const provider = MeetingProvider.DefaultWithoutDependencies.pipe(
		Layer.provideMerge(ai),
	);
	const layer = MeetingService.DefaultWithoutDependencies.pipe(
		Layer.provideMerge(
			Layer.mergeAll(
				provider,
				MeetingRepository.Default(storage),
				Layer.succeed(MeetingCapture, capture),
				Layer.succeed(MeetingProgress, {
					publish: (event) =>
						Effect.sync(() => {
							progress.push(event);
						}),
				}),
			),
		),
	);
	return {
		layer,
		progress,
		storage,
		capture,
		adapter,
		calls,
		requests,
		prompts,
		saved: () => stored,
		pauseSave: (wait: Effect.Effect<void>) => {
			nextSave = wait;
		},
		pauseStop: (wait: Effect.Effect<void>) => {
			nextStop = wait;
		},
		pauseStart: (wait: Effect.Effect<void>) => {
			nextStart = wait;
		},
		pauseSummary: (wait: Effect.Effect<void>) => {
			nextSummary = wait;
		},
		pauseTranslationStop: (wait: Effect.Effect<void>) => {
			translationStop = wait;
		},
		pauseSubmit: (wait: Effect.Effect<void>) => {
			nextSubmit = wait;
		},
		failStop: (id: string) => {
			failStop = id;
		},
		stopDelay: (ms: number) => {
			stopDelay = ms;
		},
		failDelete: () => {
			failDelete = true;
		},
		failSummary: (value: boolean) => {
			failSummary = value;
		},
		pending: (value: number) => {
			pending = value;
		},
		failSave: () => {
			failSave = true;
		},
	};
}
const configure = Effect.gen(function* () {
	yield* (yield* AiRepository).put(selected);
	yield* MeetingService.configure({
		...defaultMeetingConfig,
		profileId: selected.id,
		minutesModel: selected.modelId,
	});
});
const recordOnce = Effect.gen(function* () {
	yield* configure;
	const state = yield* MeetingService.action("meetingMinutes");
	const record = state.records[0];
	if (!record) return yield* Effect.die("record missing");
	yield* TestClock.adjust(5000);
	yield* MeetingService.action("meetingMinutes");
	return record.id;
});

describe("meeting conductor consumers", () => {
	for (const operation of ["cancel", "delete"] as const) {
		for (const target of ["main", "side"] as const) {
			it.effect(
				`preserves ${operation} of ${target} before delayed source loss`,
				() => {
					const f = setup();
					return Effect.gen(function* () {
						yield* configure;
						const main = (yield* MeetingService.action("meetingMinutes"))
							.records[0];
						const side = (yield* MeetingService.action("tempMeetingMinutes"))
							.records[0];
						if (!main || !side) return yield* Effect.die("Missing records");
						const id = target === "main" ? main.id : side.id;
						yield* TestClock.adjust(5000);
						const entered = yield* Deferred.make<void>();
						const release = yield* Deferred.make<void>();
						f.pauseSave(
							Deferred.succeed(entered, undefined).pipe(
								Effect.zipRight(Deferred.await(release)),
							),
						);
						const intentional = yield* Effect.fork(
							MeetingService[operation](id),
						);
						yield* Deferred.await(entered);
						const losing = yield* Effect.fork(MeetingService.sourceLost(id));
						yield* TestClock.adjust(0);
						yield* Deferred.succeed(release, undefined);
						yield* Fiber.join(intentional);
						yield* Fiber.join(losing);
						// A second delayed callback must remain harmless after the commit too.
						yield* MeetingService.sourceLost(id);
						const durable = yield* Schema.decodeUnknown(MeetingStore)(
							f.saved(),
						);
						const affected = target === "main" ? [main.id, side.id] : [side.id];
						for (const affectedId of affected) {
							expect(
								f.calls.filter((c) => c === `stop:${affectedId}`),
							).toHaveLength(0);
							expect(
								f.calls.filter((c) => c === `drain:${affectedId}`),
							).toHaveLength(0);
							const record = durable.records.find((r) => r.id === affectedId);
							if (operation === "delete") expect(record).toBeUndefined();
							else expect(record?.state).toBe("cancelled");
						}
						if (target === "side")
							expect(durable.records.find((r) => r.id === main.id)?.state).toBe(
								"recording",
							);
						expect(f.requests).toHaveLength(0);
						expect(f.prompts).toHaveLength(0);
						yield* MeetingService.shutdown();
					}).pipe(Effect.provide(f.layer));
				},
			);
		}
		it.effect(
			`waits for source-loss finalization before ${operation} and shutdown`,
			() => {
				const f = setup();
				return Effect.gen(function* () {
					yield* configure;
					const main = (yield* MeetingService.action("meetingMinutes"))
						.records[0];
					if (!main) return yield* Effect.die("Missing record");
					yield* TestClock.adjust(5000);
					const entered = yield* Deferred.make<void>();
					const release = yield* Deferred.make<void>();
					f.pauseStop(
						Deferred.succeed(entered, undefined).pipe(
							Effect.zipRight(Deferred.await(release)),
						),
					);
					const losing = yield* Effect.fork(MeetingService.sourceLost(main.id));
					yield* Deferred.await(entered);
					const intentional = yield* Effect.fork(
						MeetingService[operation](main.id),
					);
					const shutdown = yield* Effect.fork(MeetingService.suspend());
					yield* TestClock.adjust(0);
					expect(f.calls).not.toContain(`cancel:${main.id}`);
					expect(f.calls).not.toContain("delete:1");
					yield* Deferred.succeed(release, undefined);
					yield* Fiber.join(losing);
					yield* Fiber.join(intentional);
					yield* Fiber.join(shutdown);
					yield* MeetingService.sourceLost(main.id);
					const durable = yield* Schema.decodeUnknown(MeetingStore)(f.saved());
					expect(f.calls.filter((c) => c === `stop:${main.id}`)).toHaveLength(
						1,
					);
					expect(f.calls.indexOf(`cancel:${main.id}`)).toBeGreaterThan(
						f.calls.indexOf(`stopped:${main.id}`),
					);
					if (operation === "delete") expect(durable.records).toEqual([]);
					else expect(durable.records[0]?.state).toBe("cancelled");
				}).pipe(Effect.provide(f.layer));
			},
		);
		it.effect(
			`serializes recovery finalization with ${operation} and delayed loss`,
			() => {
				const f = setup();
				return Effect.gen(function* () {
					const id = yield* recordOnce;
					yield* (yield* MeetingRepository).update((records) =>
						records.map((r) => ({
							...r,
							state: "interrupted",
							audio: "interrupted",
							endedAt: Option.none(),
						})),
					);
					const entered = yield* Deferred.make<void>();
					const release = yield* Deferred.make<void>();
					f.pauseStop(
						Deferred.succeed(entered, undefined).pipe(
							Effect.zipRight(Deferred.await(release)),
						),
					);
					const recovery = yield* Effect.fork(
						Effect.either(MeetingService.process(id)),
					);
					yield* Deferred.await(entered);
					const intentional = yield* Effect.fork(MeetingService[operation](id));
					const losing = yield* Effect.fork(MeetingService.sourceLost(id));
					yield* TestClock.adjust(0);
					expect(f.calls).not.toContain(`cancel:${id}`);
					yield* Deferred.succeed(release, undefined);
					yield* Fiber.join(recovery);
					yield* Fiber.join(intentional);
					yield* Fiber.join(losing);
					const durable = yield* Schema.decodeUnknown(MeetingStore)(f.saved());
					if (operation === "delete") expect(durable.records).toEqual([]);
					else expect(durable.records[0]?.state).toBe("cancelled");
					// One original stop and one recovery, never a third finalization from loss.
					expect(f.calls.filter((c) => c === `stop:${id}`)).toHaveLength(2);
				}).pipe(Effect.provide(f.layer));
			},
		);
		it.effect(
			`allows ${operation} and shutdown during ASR without stale completion`,
			() => {
				const f = setup();
				return Effect.gen(function* () {
					const id = yield* recordOnce;
					const entered = yield* Deferred.make<void>();
					const release = yield* Deferred.make<void>();
					f.pauseSubmit(
						Deferred.succeed(entered, undefined).pipe(
							Effect.zipRight(Deferred.await(release)),
						),
					);
					const processing = yield* Effect.fork(
						Effect.either(MeetingService.process(id)),
					);
					yield* Deferred.await(entered);
					yield* MeetingService[operation](id);
					yield* MeetingService.suspend();
					yield* Deferred.succeed(release, undefined);
					yield* Fiber.join(processing);
					yield* MeetingService.sourceLost(id);
					const durable = yield* Schema.decodeUnknown(MeetingStore)(f.saved());
					if (operation === "delete") expect(durable.records).toEqual([]);
					else expect(durable.records[0]?.state).toBe("cancelled");
					expect(f.prompts).toHaveLength(0);
				}).pipe(Effect.provide(f.layer));
			},
		);
		it.effect(
			`allows ${operation} and shutdown during summary without stale completion`,
			() => {
				const f = setup();
				return Effect.gen(function* () {
					const id = yield* recordOnce;
					const entered = yield* Deferred.make<void>();
					const release = yield* Deferred.make<void>();
					f.pauseSummary(
						Deferred.succeed(entered, undefined).pipe(
							Effect.zipRight(Deferred.await(release)),
						),
					);
					const processing = yield* Effect.fork(
						Effect.either(MeetingService.process(id)),
					);
					yield* Deferred.await(entered);
					yield* MeetingService[operation](id);
					yield* MeetingService.suspend();
					yield* Deferred.succeed(release, undefined);
					yield* Fiber.join(processing);
					yield* MeetingService.sourceLost(id);
					const durable = yield* Schema.decodeUnknown(MeetingStore)(f.saved());
					if (operation === "delete") expect(durable.records).toEqual([]);
					else expect(durable.records[0]?.state).toBe("cancelled");
					expect(f.prompts).toHaveLength(1);
				}).pipe(Effect.provide(f.layer));
			},
		);
	}
	it.effect(
		"bounds hung provider translation cleanup so cancellation and shutdown progress",
		() => {
			const f = setup();
			return Effect.gen(function* () {
				yield* configure;
				const main = (yield* MeetingService.action("meetingMinutes"))
					.records[0];
				if (!main) return yield* Effect.die("Missing record");
				yield* MeetingService.action("liveAudioTranslate");
				f.pauseTranslationStop(Effect.never);
				const cancelling = yield* Effect.fork(MeetingService.cancel(main.id));
				yield* TestClock.adjust(2000);
				yield* Fiber.join(cancelling);
				const shutdown = yield* Effect.fork(MeetingService.shutdown());
				yield* TestClock.adjust(2000);
				yield* Fiber.join(shutdown);
				expect((yield* MeetingService.snapshot()).records[0]?.state).toBe(
					"cancelled",
				);
				expect((yield* MeetingService.snapshot()).translating).toBe(false);
			}).pipe(Effect.provide(f.layer));
		},
	);
	it.effect("ignores stale source loss after completed processing", () => {
		const f = setup();
		return Effect.gen(function* () {
			const id = yield* recordOnce;
			yield* MeetingService.process(id);
			const before = f.saved();
			yield* MeetingService.sourceLost(id);
			expect(f.saved()).toEqual(before);
		}).pipe(Effect.provide(f.layer));
	});
	it.effect(
		"anchors main and side marks to capture readiness after delayed startup",
		() => {
			const f = setup();
			return Effect.gen(function* () {
				yield* configure;
				f.pauseStart(Effect.sleep(20000));
				const starting = yield* Effect.fork(
					MeetingService.action("meetingMinutes"),
				);
				yield* TestClock.adjust(20000);
				const main = (yield* Fiber.join(starting)).records[0];
				if (!main) return yield* Effect.die("Missing main");
				expect(main.startedAt).toBe(20000);
				yield* TestClock.adjust(5000);
				const marked = yield* MeetingService.action("meetingRecordMark");
				expect(marked.records[0]?.marks[0]?.startMs).toBe(5000);
				const startingSide = yield* Effect.fork(
					MeetingService.action("tempMeetingMinutes"),
				);
				yield* TestClock.adjust(20000);
				const side = (yield* Fiber.join(startingSide)).records[0];
				expect(side?.startedAt).toBe(45000);
				yield* TestClock.adjust(5000);
				const stopped = yield* MeetingService.action("meetingMinutes");
				expect(stopped.records.find((r) => r.id === main.id)?.endedAt).toEqual(
					Option.some(50000),
				);
				expect(stopped.records.find((r) => r.id === side?.id)?.endedAt).toEqual(
					Option.some(50000),
				);
			}).pipe(Effect.provide(f.layer));
		},
	);
	for (const first of [
		"main-loss",
		"side-loss",
		"main-stop",
		"suspend",
	] as const) {
		it.effect(
			`serializes source loss after a pending ${first} history write`,
			() => {
				const f = setup();
				return Effect.gen(function* () {
					yield* configure;
					const main = (yield* MeetingService.action("meetingMinutes"))
						.records[0];
					const side = (yield* MeetingService.action("tempMeetingMinutes"))
						.records[0];
					if (!main || !side) return yield* Effect.die("Missing records");
					yield* TestClock.adjust(5000);
					const entered = yield* Deferred.make<void>();
					const release = yield* Deferred.make<void>();
					f.pauseSave(
						Deferred.succeed(entered, undefined).pipe(
							Effect.zipRight(Deferred.await(release)),
						),
					);
					const transition =
						first === "suspend"
							? MeetingService.suspend()
							: first === "main-stop"
								? MeetingService.action("meetingMinutes")
								: MeetingService.sourceLost(
										first === "side-loss" ? side.id : main.id,
									);
					const stopping = yield* Effect.fork(transition);
					yield* Deferred.await(entered);
					const lostId =
						first === "side-loss" || first === "suspend" ? main.id : side.id;
					const losing = yield* Effect.fork(MeetingService.sourceLost(lostId));
					// Let the second callback run while history still exposes recording state.
					yield* TestClock.adjust(0);
					yield* Deferred.succeed(release, undefined);
					yield* Fiber.join(stopping);
					yield* Fiber.join(losing);
					for (const id of [main.id, side.id]) {
						expect(
							f.calls.filter((call) => call === `stop:${id}`),
						).toHaveLength(first === "suspend" ? 0 : 1);
						expect(
							f.calls.filter((call) => call === `drain:${id}`),
						).toHaveLength(first === "suspend" ? 0 : 1);
					}
					const durable = yield* Schema.decodeUnknown(MeetingStore)(f.saved());
					const lost = durable.records.find((record) => record.id === lostId);
					expect(lost?.state).toBe("failed");
					expect(lost?.errorCode).toEqual(
						Option.some("QUAKE.MEETING.SOURCE_LOST"),
					);
					expect(
						durable.records.every((record) => Option.isSome(record.endedAt)),
					).toBe(true);
					expect(f.requests).toHaveLength(0);
				}).pipe(Effect.provide(f.layer));
			},
		);
	}

	for (const elapsed of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
		it.effect(
			`rejects unusable recovered duration ${elapsed} before ASR`,
			() => {
				const f = setup(elapsed);
				return Effect.gen(function* () {
					const id = yield* recordOnce;
					yield* (yield* MeetingRepository).update((records) =>
						records.map((record) => ({
							...record,
							state: "interrupted",
							endedAt: Option.none(),
						})),
					);
					const result = yield* Effect.either(MeetingService.process(id));
					expect(Either.isLeft(result) && result.left.code).toBe(
						"QUAKE.MEETING.CAPTURE_FAILED",
					);
					expect(f.requests).toHaveLength(0);
					const durable = yield* Schema.decodeUnknown(MeetingStore)(f.saved());
					expect(durable.records[0]?.endedAt).toEqual(Option.none());
				}).pipe(Effect.provide(f.layer));
			},
		);
	}
	it.effect(
		"drains all recorders before conversion and finalizes main despite side failure",
		() => {
			const f = setup();
			return Effect.gen(function* () {
				yield* configure;
				const main = (yield* MeetingService.action("meetingMinutes"))
					.records[0];
				const side = (yield* MeetingService.action("tempMeetingMinutes"))
					.records[0];
				if (!main || !side) return yield* Effect.die("Missing records");
				f.failStop(side.id);
				yield* TestClock.adjust(5000);
				yield* Effect.either(MeetingService.action("meetingMinutes"));
				const operations = f.calls.filter(
					(c) => c.startsWith("drain:") || c.startsWith("stop:"),
				);
				expect(operations.slice(0, 2)).toEqual([
					`drain:${side.id}`,
					`drain:${main.id}`,
				]);
				expect(operations).toContain(`stop:${main.id}`);
				const records = (yield* MeetingService.snapshot()).records;
				expect(records.find((r) => r.id === main.id)?.state).toBe("recorded");
				expect(records.find((r) => r.id === side.id)?.audio).toBe("failed");
				expect(records.every((r) => r.state !== "recording")).toBe(true);
			}).pipe(Effect.provide(f.layer));
		},
	);
	it.effect(
		"shutdown saves a finite capture end before restart downtime",
		() => {
			const f = setup();
			return Effect.gen(function* () {
				yield* configure;
				const initial = (yield* MeetingService.action("meetingMinutes"))
					.records[0];
				if (!initial) return yield* Effect.die("Missing record");
				yield* TestClock.adjust(2000);
				yield* MeetingService.shutdown();
				const record = (yield* Schema.decodeUnknown(MeetingStore)(f.saved()))
					.records[0];
				expect(record?.endedAt).toEqual(Option.some(initial.startedAt + 2000));
				expect(record?.state).toBe("interrupted");
			}).pipe(Effect.provide(f.layer));
		},
	);
	for (const elapsed of [2500, 2500.499, 2500.501, 0.1]) {
		it.effect(
			`recovers interrupted duration ${elapsed} as integer milliseconds before ASR`,
			() => {
				const f = setup(elapsed);
				return Effect.gen(function* () {
					const id = yield* recordOnce;
					yield* (yield* MeetingRepository).update((records) =>
						records.map((r) => ({
							...r,
							state: "interrupted",
							audio: "interrupted",
							endedAt: Option.none(),
						})),
					);
					yield* TestClock.adjust(86400000);
					yield* MeetingService.process(id);
					expect(f.requests[0]?.durationMs).toBe(Math.round(elapsed));
					const record = (yield* MeetingService.snapshot()).records[0];
					expect(record?.endedAt).toEqual(
						Option.some((record?.startedAt ?? 0) + Math.round(elapsed)),
					);
					const durable = yield* Schema.decodeUnknown(MeetingStore)(f.saved());
					expect(durable.records[0]?.endedAt).toEqual(record?.endedAt);
					expect(durable.records[0]?.state).toBe("completed");
					yield* TestClock.adjust(86400000);
					expect(
						(yield* MeetingService.snapshot()).records[0]?.endedAt,
					).toEqual(record?.endedAt);
				}).pipe(Effect.provide(f.layer));
			},
		);
	}

	it.effect(
		"enforces independent cooldowns, shared side capture, ordered marks and stop once",
		() => {
			const f = setup();
			return Effect.gen(function* () {
				yield* configure;
				const initial = yield* MeetingService.action("meetingMinutes");
				const main = initial.records[0];
				if (!main) return yield* Effect.die("record missing");
				yield* MeetingService.action("meetingMinutes");
				yield* MeetingService.action("tempMeetingMinutes");
				yield* MeetingService.action("meetingRecordMark");
				yield* TestClock.adjust(4999);
				yield* MeetingService.action("meetingMinutes");
				expect(f.calls.filter((c) => c.startsWith("start:"))).toHaveLength(2);
				expect(f.calls.filter((c) => c.startsWith("stop:"))).toHaveLength(0);
				yield* TestClock.adjust(1);
				yield* MeetingService.action("meetingRecordMark");
				yield* MeetingService.action("meetingMinutes");
				yield* MeetingService.action("meetingMinutes");
				const state = yield* MeetingService.snapshot();
				expect(f.calls.filter((c) => c.startsWith("stop:"))).toHaveLength(2);
				expect(f.calls.filter((c) => c.startsWith("stop:")).at(-1)).toBe(
					`stop:${main.id}`,
				);
				expect(
					state.records.every(
						(r) => r.state === "recorded" && r.audio === "complete",
					),
				).toBe(true);
				expect(state.records.find((r) => r.id === main.id)?.marks).toEqual([
					{ startMs: 0, endMs: Option.some(5000) },
				]);
				yield* MeetingService.action("tempMeetingMinutes");
				expect((yield* MeetingService.snapshot()).notice).toBe(
					"No active main meeting detected",
				);
			}).pipe(Effect.provide(f.layer));
		},
	);
	it.effect(
		"persists transcript before summary failure and retries summary only with the chosen language/template",
		() => {
			const f = setup();
			f.failSummary(true);
			return Effect.gen(function* () {
				const id = yield* recordOnce;
				const failed = yield* Effect.either(MeetingService.process(id));
				expect(Either.isLeft(failed) && failed.left._tag).toBe(
					"MeetingGenerationFailed",
				);
				let record = (yield* MeetingService.snapshot()).records[0];
				expect(record?.transcript).toEqual(segments);
				expect(record?.audio).toBe("complete");
				expect(record?.transcription).toBe("complete");
				expect(record?.summary).toBe("failed");
				f.failSummary(false);
				yield* MeetingService.template(id, "executive");
				yield* MeetingService.process(id);
				record = (yield* MeetingService.snapshot()).records[0];
				expect(record?.minutes).toBe("## Saved summary 2");
				expect(record?.appliedTemplate).toEqual(Option.some("executive"));
				expect(f.requests).toHaveLength(1);
				expect(f.calls.filter((c) => c.startsWith("start:"))).toHaveLength(1);
				const prompt = JSON.stringify(f.prompts.at(-1)?.request);
				expect(prompt).toContain("Decision Summary");
				expect(prompt).toContain("in English");
				expect(f.requests[0]).toMatchObject({
					channelIds: [0],
					diarization: true,
					expiresInMs: 172800000,
				});
				const reloaded = yield* Schema.decodeUnknown(MeetingStore)(f.saved());
				expect(reloaded.records[0]?.minutes).toBe("## Saved summary 2");
				yield* MeetingService.regenerate(id, "interview");
				expect((yield* MeetingService.snapshot()).records[0]?.minutes).toBe(
					"## Saved summary 3",
				);
				expect(JSON.stringify(f.prompts.at(-1)?.request)).toContain(
					"Key Quotes",
				);
				expect(f.requests).toHaveLength(1);
			}).pipe(Effect.provide(f.layer));
		},
	);
	it.effect(
		"polls async ASR every ten seconds and cancels an interrupted remote task",
		() => {
			const f = setup();
			f.pending(1000);
			return Effect.gen(function* () {
				const id = yield* recordOnce;
				const task = yield* MeetingService.process(id).pipe(Effect.fork);
				yield* TestClock.adjust(0);
				expect(f.calls.filter((c) => c === "poll")).toHaveLength(1);
				yield* TestClock.adjust(9999);
				expect(f.calls.filter((c) => c === "poll")).toHaveLength(1);
				yield* TestClock.adjust(1);
				expect(f.calls.filter((c) => c === "poll")).toHaveLength(2);
				yield* Fiber.interrupt(task);
				expect(f.calls).toContain("cancel-task:task");
				expect(f.prompts).toHaveLength(0);
			}).pipe(Effect.provide(f.layer));
		},
	);
	it.effect(
		"times out ASR, cancels the remote task, and keeps audio retryable",
		() => {
			const f = setup();
			f.pending(1000);
			return Effect.gen(function* () {
				const id = yield* recordOnce;
				const task = yield* Effect.either(MeetingService.process(id)).pipe(
					Effect.fork,
				);
				yield* TestClock.adjust(180000);
				const result = yield* Fiber.join(task);
				expect(Either.isLeft(result) && result.left.code).toBe(
					"QUAKE.MEETING.TIMEOUT",
				);
				expect(f.calls).toContain("cancel-task:task");
				expect((yield* MeetingService.snapshot()).records[0]?.audio).toBe(
					"complete",
				);
			}).pipe(Effect.provide(f.layer));
		},
	);
	it.effect(
		"retains the committed summary after failed regeneration and rejects failed persistence",
		() => {
			const f = setup();
			return Effect.gen(function* () {
				const id = yield* recordOnce;
				yield* MeetingService.process(id);
				f.failSummary(true);
				yield* Effect.either(MeetingService.regenerate(id, "standard"));
				const record = (yield* MeetingService.snapshot()).records[0];
				expect(record?.minutes).toBe("## Saved summary 1");
				expect(record?.appliedTemplate).toEqual(Option.some("project-weekly"));
				f.failSave();
				const failed = yield* Effect.either(
					MeetingService.rename(id, "Private title"),
				);
				expect(Either.isLeft(failed) && failed.left._tag).toBe(
					"MeetingStorageFailed",
				);
				expect((yield* MeetingService.snapshot()).records[0]?.title).toBe(
					record?.title,
				);
				expect(JSON.stringify(failed)).not.toContain("sk-secret");
			}).pipe(Effect.provide(f.layer));
		},
	);
	it.effect(
		"cancels capture without inference and deletes parent and side records together",
		() => {
			const f = setup();
			return Effect.gen(function* () {
				yield* configure;
				const snapshot = yield* MeetingService.action("meetingMinutes");
				const main = snapshot.records[0];
				if (!main) return yield* Effect.die("missing");
				yield* MeetingService.action("tempMeetingMinutes");
				yield* MeetingService.cancel(main.id);
				expect(f.requests).toHaveLength(0);
				expect(f.prompts).toHaveLength(0);
				expect(f.calls.filter((c) => c.startsWith("cancel:"))).toHaveLength(2);
				yield* MeetingService.delete(main.id);
				expect((yield* MeetingService.snapshot()).records).toEqual([]);
				expect(f.calls).toContain("delete:2");
			}).pipe(Effect.provide(f.layer));
		},
	);
	it.effect("permission failure opens no record or inference", () => {
		const f = setup();
		const denied = Layer.succeed(MeetingCapture, {
			...f.capture,
			start: () =>
				Effect.fail(
					meetingError("CaptureDenied", new Error("private mic name")),
				),
		});
		const layer = MeetingService.DefaultWithoutDependencies.pipe(
			Layer.provide(
				Layer.mergeAll(
					MeetingRepository.Default(f.storage),
					MeetingProvider.Default,
					denied,
				),
			),
		);
		return Effect.gen(function* () {
			const result = yield* Effect.either(
				MeetingService.action("meetingMinutes"),
			);
			expect(Either.isLeft(result) && result.left.code).toBe(
				"QUAKE.MEETING.CAPTURE_DENIED",
			);
			expect((yield* MeetingService.snapshot()).records).toEqual([]);
			expect(f.requests).toHaveLength(0);
		}).pipe(Effect.provide(layer));
	});
	it.effect(
		"finalizes source loss, retries without recapture, and retains history on partial deletion failure",
		() => {
			const f = setup();
			return Effect.gen(function* () {
				yield* configure;
				const started = yield* MeetingService.action("meetingMinutes");
				const record = started.records[0];
				if (!record) return yield* Effect.die("missing");
				yield* TestClock.adjust(2000);
				yield* MeetingService.sourceLost(record.id);
				const failed = (yield* MeetingService.snapshot()).records[0];
				expect(failed?.state).toBe("failed");
				expect(failed?.audio).toBe("complete");
				expect(failed?.endedAt).toEqual(Option.some(record.startedAt + 2000));
				yield* MeetingService.process(record.id);
				expect(
					f.calls.filter((call) => call.startsWith("start:")),
				).toHaveLength(1);
				f.failDelete();
				const deleted = yield* Effect.either(MeetingService.delete(record.id));
				expect(Either.isLeft(deleted)).toBe(true);
				expect((yield* MeetingService.snapshot()).records[0]?.minutes).toBe(
					"## Saved summary 1",
				);
			}).pipe(Effect.provide(f.layer));
		},
	);
	it.effect(
		"fails unavailable translation before acquiring audio and preserves authoritative mic state",
		() => {
			const f = setup();
			const layer = MeetingService.DefaultWithoutDependencies.pipe(
				Layer.provide(
					Layer.mergeAll(
						MeetingRepository.Default(f.storage),
						MeetingProvider.Default,
						Layer.succeed(MeetingCapture, f.capture),
					),
				),
			);
			return Effect.gen(function* () {
				const result = yield* Effect.either(
					MeetingService.action("liveAudioTranslate"),
				);
				expect(Either.isLeft(result) && result.left.code).toBe(
					"QUAKE.MEETING.UNAVAILABLE",
				);
				expect(f.calls).not.toContain("translate");
				const before = yield* MeetingService.snapshot();
				yield* MeetingService.action("mic");
				const after = yield* MeetingService.snapshot();
				expect(before.mic).toEqual(Option.some(true));
				expect(after.mic).toEqual(before.mic);
				expect(after.revision).toBeGreaterThan(before.revision);
			}).pipe(Effect.provide(layer));
		},
	);
	it.effect(
		"drops duplicate actions during slow finalization instead of starting another capture",
		() => {
			const f = setup();
			f.stopDelay(10000);
			return Effect.gen(function* () {
				yield* configure;
				yield* MeetingService.action("meetingMinutes");
				yield* TestClock.adjust(5000);
				const stopping = yield* MeetingService.action("meetingMinutes").pipe(
					Effect.fork,
				);
				yield* TestClock.adjust(0);
				expect(
					(yield* MeetingService.action("meetingMinutes")).records[0]?.state,
				).toBe("processing");
				yield* TestClock.adjust(10000);
				yield* Fiber.join(stopping);
				expect(
					f.calls.filter((call) => call.startsWith("start:")),
				).toHaveLength(1);
				expect(f.calls.filter((call) => call.startsWith("stop:"))).toHaveLength(
					1,
				);
			}).pipe(Effect.provide(f.layer));
		},
	);
});

it.effect(
	"AI-267 publishes every real pipeline stage with the originating strip serial/key and UUID",
	() => {
		const f = setup();
		return Effect.gen(function* () {
			yield* configure;
			const started = yield* MeetingService.action("meetingMinutes", {
				serial: "QK",
				keyCode: "1,7",
			});
			const record = started.records[0];
			if (!record) return yield* Effect.die("missing meeting");
			yield* TestClock.adjust(5000);
			yield* MeetingService.action("meetingMinutes");
			yield* MeetingService.process(record.id);
			expect(f.progress.map((e) => [e.stage, e.status])).toEqual([
				[0, 1],
				[0, 2],
				[1, 1],
				[1, 2],
				[2, 1],
				[2, 2],
				[3, 1],
				[3, 2],
				[4, 1],
				[4, 2],
				[5, 1],
				[5, 2],
			]);
			expect(
				f.progress.every(
					(e) =>
						e.meetingId === record.id &&
						e.origin?.serial === "QK" &&
						e.origin.keyCode === "1,7",
				),
			).toBe(true);
			expect((yield* MeetingService.snapshot()).records[0]?.state).toBe(
				"completed",
			);
		}).pipe(Effect.provide(f.layer));
	},
);

it.effect(
	"AI-267 cancels the current stage and ignores late provider progress and summary completion",
	() => {
		const f = setup();
		return Effect.gen(function* () {
			yield* configure;
			const entered = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			f.pauseSubmit(
				Deferred.succeed(entered, undefined).pipe(
					Effect.zipRight(Deferred.await(release)),
				),
			);
			const started = yield* MeetingService.action("meetingMinutes", {
				serial: "QK",
				keyCode: "1,7",
			});
			const record = started.records[0];
			if (!record) return yield* Effect.die("missing meeting");
			yield* TestClock.adjust(5000);
			yield* MeetingService.action("meetingMinutes");
			const work = yield* MeetingService.process(record.id).pipe(Effect.fork);
			yield* Deferred.await(entered);
			yield* MeetingService.cancel(record.id);
			expect(f.progress.at(-1)).toMatchObject({
				meetingId: record.id,
				stage: 2,
				status: 0,
			});
			const count = f.progress.length;
			yield* Deferred.succeed(release, undefined);
			yield* Fiber.await(work);
			expect(f.progress).toHaveLength(count);
			expect((yield* MeetingService.snapshot()).records[0]?.state).toBe(
				"cancelled",
			);
		}).pipe(Effect.provide(f.layer));
	},
);

it.effect(
	"AI-267 reports a failed summary and can retry its stage, while shutdown cancels active recording",
	() => {
		const f = setup();
		return Effect.gen(function* () {
			yield* configure;
			const started = yield* MeetingService.action("meetingMinutes", {
				serial: "QK",
				keyCode: "1,7",
			});
			const record = started.records[0];
			if (!record) return yield* Effect.die("missing meeting");
			yield* TestClock.adjust(5000);
			yield* MeetingService.action("meetingMinutes");
			f.failSummary(true);
			yield* MeetingService.process(record.id).pipe(Effect.either);
			expect(f.progress.at(-1)).toMatchObject({ stage: 5, status: 0 });
			f.failSummary(false);
			yield* MeetingService.regenerate(record.id, "project-weekly");
			expect(f.progress.at(-1)?.origin).toEqual({
				serial: "QK",
				keyCode: "1,7",
			});
			expect(f.progress.slice(-2).map((e) => [e.stage, e.status])).toEqual([
				[5, 1],
				[5, 2],
			]);
			yield* TestClock.adjust(5000);
			yield* MeetingService.action("meetingMinutes");
			yield* MeetingService.shutdown();
			expect(f.progress.at(-1)).toMatchObject({ stage: 0, status: 0 });
		}).pipe(Effect.provide(f.layer));
	},
);

it.effect(
	"meeting snapshots retain current and terminal stages for late strip mounts",
	() => {
		const f = setup();
		return Effect.gen(function* () {
			yield* configure;
			const started = yield* MeetingService.action("meetingMinutes", {
				serial: "QK",
				keyCode: "1,7",
			});
			const record = started.records[0];
			if (!record) return yield* Effect.die("missing meeting");
			expect(started.progress?.[record.id]).toEqual({ stage: 0, status: 1 });
			yield* TestClock.adjust(5000);
			yield* MeetingService.action("meetingMinutes");
			expect((yield* MeetingService.snapshot()).progress?.[record.id]).toEqual({
				stage: 1,
				status: 2,
			});
			const entered = yield* Deferred.make<void>();
			const release = yield* Deferred.make<void>();
			f.pauseSubmit(
				Deferred.succeed(entered, undefined).pipe(
					Effect.zipRight(Deferred.await(release)),
				),
			);
			const work = yield* MeetingService.process(record.id).pipe(Effect.fork);
			yield* Deferred.await(entered);
			expect((yield* MeetingService.snapshot()).progress?.[record.id]).toEqual({
				stage: 2,
				status: 1,
			});
			yield* Deferred.succeed(release, undefined);
			yield* Fiber.join(work);
			expect((yield* MeetingService.snapshot()).progress?.[record.id]).toEqual({
				stage: 5,
				status: 2,
			});
			yield* TestClock.adjust(5000);
			const next = (yield* MeetingService.action(
				"meetingMinutes",
			)).records.find((r) => r.state === "recording");
			if (!next) return yield* Effect.die("missing next meeting");
			yield* MeetingService.cancel(next.id);
			expect((yield* MeetingService.snapshot()).progress?.[next.id]).toEqual({
				stage: 0,
				status: 0,
			});
		}).pipe(Effect.provide(f.layer));
	},
);
