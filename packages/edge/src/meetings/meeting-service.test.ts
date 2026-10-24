import { describe, expect, it } from "@effect/vitest";
import {
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
import { type CapturePort, MeetingCapture } from "./meeting-ports.js";
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
function setup() {
	const calls: string[] = [],
		requests: MeetingAsrRequest[] = [],
		prompts: Parameters<CompatibleAdapter["open"]>[0][] = [];
	let stored: typeof MeetingStore.Encoded = { version: 1, records: [] };
	let failSummary = false,
		pending = 0,
		failSave = false,
		failDelete = false,
		stopDelay = 0;
	const storage: MeetingStorage = {
		load: () => Effect.succeed(stored),
		save: (next) =>
			Effect.suspend(() => {
				if (failSave)
					return Effect.fail(
						meetingError(
							"StorageFailed",
							new Error("private transcript sk-secret"),
						),
					);
				stored = next;
				return Effect.void;
			}),
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
			}),
		stop: (id) =>
			Effect.sync(() => {
				calls.push(`stop:${id}`);
			}).pipe(
				Effect.zipRight(
					Effect.suspend(() =>
						stopDelay > 0 ? Effect.sleep(stopDelay) : Effect.void,
					),
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
			}),
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
		stopTranslation: () => Effect.void,
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
						return failSummary
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
			),
		),
	);
	return {
		layer,
		storage,
		capture,
		adapter,
		calls,
		requests,
		prompts,
		saved: () => stored,
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
