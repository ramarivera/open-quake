import { Clock, Effect, Option, PubSub, Ref, Stream } from "effect";
import { defaultMeetingConfig } from "./meeting-defaults.js";

export { defaultMeetingConfig } from "./meeting-defaults.js";

import {
	type MeetingAction,
	type MeetingConfig,
	MeetingId,
	type MeetingRecord,
	type MeetingSnapshot,
	type TemplateId,
	type Translation,
} from "./meeting-contracts.js";
import { type MeetingError, meetingError } from "./meeting-errors.js";
import {
	appendTranslation,
	COOLDOWN_MS,
	duration,
} from "./meeting-invariants.js";
import { MeetingCapture } from "./meeting-ports.js";
import { MeetingProvider } from "./meeting-provider.js";
import { MeetingRepository } from "./meeting-repository.js";

export class MeetingService extends Effect.Service<MeetingService>()(
	"@open-quake/edge/MeetingService",
	{
		accessors: true,
		dependencies: [MeetingRepository.Default(), MeetingProvider.Default],
		effect: Effect.gen(function* () {
			const repo = yield* MeetingRepository;
			const provider = yield* MeetingProvider;
			const capture = yield* MeetingCapture;
			const config = yield* Ref.make(defaultMeetingConfig);
			const ephemeral = yield* Ref.make<
				Omit<MeetingSnapshot, "records" | "revision" | "config" | "mic">
			>({
				cooldowns: {},
				translations: [],
				translating: false,
				tab: "main",
				notice: "",
				mock: false,
			} satisfies Omit<
				MeetingSnapshot,
				"records" | "revision" | "config" | "mic"
			>);
			const revision = yield* Ref.make(0);
			const changes = yield* PubSub.unbounded<MeetingSnapshot>();
			const lock = yield* Effect.makeSemaphore(1);
			const activeActions = yield* Ref.make<ReadonlySet<MeetingAction>>(
				new Set(),
			);
			const snapshot = Effect.fn("MeetingService.snapshot")(
				function* (): Effect.fn.Return<MeetingSnapshot> {
					return {
						...(yield* Ref.get(ephemeral)),
						records: yield* repo.list(),
						mic: yield* capture.mic(),
						config: yield* Ref.get(config),
						revision: yield* Ref.updateAndGet(revision, (n) => n + 1),
					};
				},
			);
			const publish = Effect.fn("MeetingService.publish")(
				function* (): Effect.fn.Return<void> {
					yield* PubSub.publish(changes, yield* snapshot());
				},
			);
			const patch = Effect.fn("MeetingService.patch")(
				(id: MeetingId, transform: (record: MeetingRecord) => MeetingRecord) =>
					repo
						.update((records) =>
							records.map((record) =>
								record.id === id ? transform(record) : record,
							),
						)
						.pipe(Effect.zipRight(publish())),
			);
			// Provider work can finish after cancellation; it must not overwrite intent.
			const patchWork = (
				id: MeetingId,
				transform: (record: MeetingRecord) => MeetingRecord,
			) =>
				patch(id, (record) =>
					record.state === "cancelled" || record.state === "recording"
						? record
						: transform(record),
				);
			const find = Effect.fn("MeetingService.find")(function* (
				id: MeetingId,
			): Effect.fn.Return<MeetingRecord, MeetingError> {
				const record = (yield* repo.list()).find((r) => r.id === id);
				if (!record) return yield* meetingError("Invalid");
				return record;
			});
			const notice = (text: string) =>
				Ref.update(ephemeral, (state) => ({ ...state, notice: text })).pipe(
					Effect.zipRight(publish()),
				);
			const stopTranslation = Effect.fn("MeetingService.stopTranslation")(
				function* (): Effect.fn.Return<void> {
					yield* capture.stopTranslation();
					// A hung provider cleanup must not keep capture/shutdown locked.
					yield* provider
						.stopTranslation()
						.pipe(Effect.timeoutOption("2 seconds"));
					yield* Ref.update(ephemeral, (state) => ({
						...state,
						translating: false,
					}));
				},
			);
			const start = Effect.fn("MeetingService.start")(function* (
				parent: MeetingRecord | undefined,
			): Effect.fn.Return<void, MeetingError> {
				const currentConfig = parent?.config ?? (yield* Ref.get(config));
				const id = MeetingId.make(crypto.randomUUID());
				yield* capture.start(id, currentConfig, parent?.id);
				const now = yield* Clock.currentTimeMillis;
				const record: MeetingRecord = {
					id,
					parentId: Option.fromNullable(parent?.id),
					title: `${parent ? "Temporary record" : "Meeting"} ${new Date(now).toISOString().slice(0, 19).replace("T", " ")}`,
					startedAt: now,
					endedAt: Option.none(),
					state: "recording",
					audio: "processing",
					transcription: "pending",
					summary: "pending",
					marks: [],
					transcript: [],
					minutes: "",
					template: "project-weekly",
					appliedTemplate: Option.none(),
					provenance: Option.none(),
					errorCode: Option.none(),
					config: currentConfig,
				};
				yield* repo
					.update((records) => [record, ...records])
					.pipe(Effect.onError(() => capture.cancel(id)));
				yield* Ref.update(
					ephemeral,
					(
						state,
					): Omit<
						MeetingSnapshot,
						"records" | "revision" | "config" | "mic"
					> => ({
						...state,
						tab: parent ? "temp" : "main",
						notice: "",
					}),
				);
			});
			const stop = Effect.fn("MeetingService.stop")(function* (
				record: MeetingRecord,
			): Effect.fn.Return<void, MeetingError> {
				const now = yield* Clock.currentTimeMillis;
				const affected = [
					...(yield* repo.list()).filter(
						(r) =>
							r.state === "recording" && Option.contains(r.parentId, record.id),
					),
					record,
				];
				const failures = new Map<MeetingId, MeetingError>();
				// Drain every recorder before storage or ffmpeg can delay releasing sources.
				for (const item of affected) {
					const result = yield* Effect.either(capture.drain(item.id));
					if (result._tag === "Left") failures.set(item.id, result.left);
				}
				if (Option.isNone(record.parentId)) yield* stopTranslation();
				yield* repo.update((records) =>
					records.map((r) =>
						affected.some((item) => item.id === r.id)
							? {
									...r,
									state: "processing",
									endedAt: Option.some(now),
									marks: r.marks.map((m) => ({
										...m,
										endMs: Option.orElse(m.endMs, () =>
											Option.some(now - r.startedAt),
										),
									})),
								}
							: r,
					),
				);
				yield* publish();
				for (const item of affected) {
					if (!failures.has(item.id)) {
						const result = yield* Effect.either(capture.stop(item.id));
						if (result._tag === "Left") failures.set(item.id, result.left);
					}
					const error = failures.get(item.id);
					yield* patch(item.id, (r) => ({
						...r,
						state: error ? "failed" : "recorded",
						audio: error ? "failed" : "complete",
						errorCode: error ? Option.some(error.code) : Option.none(),
					}));
				}
				// Individual task health retains child failures; successful siblings remain usable.
				const error = failures.get(record.id);
				if (error) return yield* error;
			});
			const action = Effect.fn("MeetingService.action")(
				(type: MeetingAction): Effect.Effect<MeetingSnapshot, MeetingError> =>
					Effect.gen(function* () {
						const claimed = yield* Ref.modify(activeActions, (actions) =>
							actions.has(type)
								? [false, actions]
								: [true, new Set([...actions, type])],
						);
						if (!claimed) return yield* snapshot();
						return yield* lock
							.withPermits(1)(
								Effect.gen(function* () {
									const now = yield* Clock.currentTimeMillis;
									const state: Omit<
										MeetingSnapshot,
										"records" | "revision" | "config" | "mic"
									> = yield* Ref.get(ephemeral);
									if ((state.cooldowns[type] ?? 0) > now)
										return yield* snapshot();
									const records = yield* repo.list();
									const main = records.find(
										(r) => r.state === "recording" && Option.isNone(r.parentId),
									);
									const side = records.find(
										(r) => r.state === "recording" && Option.isSome(r.parentId),
									);
									if (
										(type === "tempMeetingMinutes" ||
											type === "meetingRecordMark") &&
										!main
									) {
										yield* notice("No active main meeting detected");
										return yield* snapshot();
									}
									if (
										type === "meetingMinutes" &&
										!main &&
										records.some(
											(r) =>
												Option.isNone(r.parentId) && r.state === "processing",
										)
									) {
										yield* notice("Meeting minutes is being processed");
										return yield* snapshot();
									}
									if (
										type === "tempMeetingMinutes" &&
										!side &&
										records.some(
											(r) =>
												Option.isSome(r.parentId) && r.state === "processing",
										)
									) {
										yield* notice("Temporary record is being processed");
										return yield* snapshot();
									}
									if (type !== "mic")
										yield* Ref.update(ephemeral, (s) => ({
											...s,
											cooldowns: { ...s.cooldowns, [type]: now + COOLDOWN_MS },
										}));
									switch (type) {
										case "meetingMinutes":
											if (main) yield* stop(main);
											else yield* start(undefined);
											break;
										case "tempMeetingMinutes":
											if (side) yield* stop(side);
											else yield* start(main);
											break;
										case "meetingRecordMark":
											if (main)
												yield* patch(main.id, (r) => {
													const last = r.marks.at(-1);
													return {
														...r,
														marks:
															last && Option.isNone(last.endMs)
																? r.marks.map((m, index) =>
																		index === r.marks.length - 1
																			? {
																					...m,
																					endMs: Option.some(now - r.startedAt),
																				}
																			: m,
																	)
																: [
																		...r.marks,
																		{
																			startMs: now - r.startedAt,
																			endMs: Option.none(),
																		},
																	],
													};
												});
											break;
										case "liveAudioTranslate":
											if (state.translating) yield* stopTranslation();
											else {
												yield* provider.requireTranslation();
												yield* capture.startTranslation(yield* Ref.get(config));
												yield* Ref.update(
													ephemeral,
													(
														s,
													): Omit<
														MeetingSnapshot,
														"records" | "revision" | "config" | "mic"
													> => ({
														...s,
														translating: true,
														tab: "live",
													}),
												);
											}
											break;
										case "mic":
											yield* capture.toggleMic();
											break;
									}
									yield* publish();
									return yield* snapshot();
								}),
							)
							.pipe(
								Effect.ensuring(
									Ref.update(
										activeActions,
										(actions) =>
											new Set([...actions].filter((action) => action !== type)),
									),
								),
							);
					}),
			);
			const generate = Effect.fn("MeetingService.generate")(function* (
				id: MeetingId,
				template: TemplateId,
			): Effect.fn.Return<void, MeetingError> {
				const record = yield* lock.withPermits(1)(
					Effect.gen(function* () {
						const current = yield* find(id);
						if (
							current.state === "cancelled" ||
							current.state === "recording" ||
							!current.transcript.length
						)
							return yield* meetingError("Invalid");
						yield* patchWork(id, (r) => ({
							...r,
							state: "processing",
							summary: "processing",
							errorCode: Option.none(),
						}));
						return current;
					}),
				);
				const minutes = yield* provider.summarize(
					record.config,
					record.transcript,
					template,
				);
				const generatedAt = yield* Clock.currentTimeMillis;
				yield* patchWork(id, (r) => ({
					...r,
					minutes,
					template,
					appliedTemplate: Option.some(template),
					provenance: Option.some({
						profileId: record.config.profileId,
						model: record.config.minutesModel,
						language: record.config.outputLanguage,
						generatedAt,
					}),
					state: "completed",
					summary: "complete",
					errorCode: Option.none(),
				}));
			});
			const failed = (id: MeetingId, error: MeetingError) =>
				patchWork(id, (r) => ({
					...r,
					state: "failed",
					errorCode: Option.some(error.code),
					audio: r.audio === "processing" ? "failed" : r.audio,
					transcription:
						r.transcription === "processing" ? "failed" : r.transcription,
					summary: r.summary === "processing" ? "failed" : r.summary,
				}));
			const suspendCapture = Effect.fn("MeetingService.suspend")(
				function* (): Effect.fn.Return<void> {
					const now = yield* Clock.currentTimeMillis;
					const active = (yield* repo.list()).filter(
						(r) => r.state === "recording",
					);
					for (const record of [...active].sort(
						(a, b) =>
							Number(Option.isNone(a.parentId)) -
							Number(Option.isNone(b.parentId)),
					))
						yield* capture.cancel(record.id);
					yield* repo
						.update((records) =>
							records.map((r) =>
								active.some((item) => item.id === r.id)
									? {
											...r,
											state: "interrupted",
											audio: "interrupted",
											endedAt: Option.some(now),
											marks: r.marks.map((m) => ({
												...m,
												endMs: Option.orElse(m.endMs, () =>
													Option.some(now - r.startedAt),
												),
											})),
										}
									: r,
							),
						)
						.pipe(Effect.ignore);
					yield* stopTranslation();
				},
				lock.withPermits(1),
			);
			return {
				snapshot,
				subscribe: Effect.fn("MeetingService.subscribe")(() =>
					Effect.succeed(Stream.fromPubSub(changes)),
				),
				action,
				configure: Effect.fn("MeetingService.configure")(
					(next: MeetingConfig, mock = false) =>
						Ref.set(config, next).pipe(
							Effect.zipRight(Ref.update(ephemeral, (s) => ({ ...s, mock }))),
							Effect.zipRight(publish()),
						),
				),
				process: Effect.fn("MeetingService.process")(
					(id: MeetingId): Effect.Effect<void, MeetingError> =>
						Effect.gen(function* () {
							const record = yield* lock.withPermits(1)(
								Effect.gen(function* () {
									let record = yield* find(id);
									if (
										record.state === "recording" ||
										record.state === "cancelled"
									)
										return yield* meetingError("Invalid");
									if (record.audio !== "complete") {
										yield* capture.stop(id);
										yield* patchWork(id, (r) => ({ ...r, audio: "complete" }));
									}
									if (Option.isNone(record.endedAt)) {
										const elapsed = yield* capture.duration(id);
										if (!Number.isFinite(elapsed) || elapsed < 0)
											return yield* meetingError("CaptureFailed");
										yield* patchWork(id, (r) => ({
											...r,
											endedAt: Option.some(r.startedAt + Math.round(elapsed)),
										}));
										record = yield* find(id);
									}
									if (!record.transcript.length) {
										yield* patchWork(id, (r) => ({
											...r,
											state: "processing",
											transcription: "processing",
											errorCode: Option.none(),
										}));
									}
									return record;
								}),
							);
							if (!record.transcript.length) {
								const transcript = yield* provider.transcribe(
									record.config,
									id,
									duration(record, yield* Clock.currentTimeMillis),
								);
								yield* patchWork(id, (r) => ({
									...r,
									transcript,
									transcription: "complete",
								}));
							}
							yield* generate(id, record.template);
						}).pipe(
							Effect.tapError((error) => failed(id, error)),
							Effect.onInterrupt(() =>
								patchWork(id, (r) => ({
									...r,
									state: "interrupted",
									transcription:
										r.transcription === "processing"
											? "interrupted"
											: r.transcription,
									summary:
										r.summary === "processing" ? "interrupted" : r.summary,
								})).pipe(Effect.ignore),
							),
						),
				),
				regenerate: Effect.fn("MeetingService.regenerate")(
					(id: MeetingId, template: TemplateId) =>
						generate(id, template).pipe(
							Effect.tapError((error) => failed(id, error)),
						),
				),
				rename: Effect.fn("MeetingService.rename")(
					(id: MeetingId, title: string) => patch(id, (r) => ({ ...r, title })),
				),
				template: Effect.fn("MeetingService.template")(
					(id: MeetingId, template: TemplateId) =>
						patch(id, (r) => ({ ...r, template })),
				),
				tab: Effect.fn("MeetingService.tab")((tab: MeetingSnapshot["tab"]) =>
					Ref.update(ephemeral, (s) => ({ ...s, tab })).pipe(
						Effect.zipRight(publish()),
					),
				),
				clear: Effect.fn("MeetingService.clear")(() =>
					Ref.update(ephemeral, (s) => ({ ...s, translations: [] })).pipe(
						Effect.zipRight(publish()),
					),
				),
				translate: Effect.fn("MeetingService.translate")(function* (
					pcm: Uint8Array,
				): Effect.fn.Return<void, MeetingError> {
					if (!(yield* Ref.get(ephemeral)).translating) return;
					const updates = yield* provider.translate(
						yield* Ref.get(config),
						pcm,
					);
					for (const update of updates)
						yield* Ref.update(ephemeral, (s) => ({
							...s,
							translations: appendTranslation(s.translations, update),
						}));
					yield* publish();
				}),
				addTranslation: Effect.fn("MeetingService.addTranslation")(
					(update: Translation) =>
						Ref.update(ephemeral, (s) => ({
							...s,
							translations: appendTranslation(s.translations, update),
						})).pipe(Effect.zipRight(publish())),
				),
				cancel: Effect.fn("MeetingService.cancel")(function* (
					id: MeetingId,
				): Effect.fn.Return<void, MeetingError> {
					const now = yield* Clock.currentTimeMillis;
					const children = (yield* repo.list()).filter(
						(r) => r.id === id || Option.contains(r.parentId, id),
					);
					for (const record of children) {
						yield* capture.cancel(record.id);
						yield* patch(record.id, (r) => ({
							...r,
							state: "cancelled",
							endedAt: Option.orElse(r.endedAt, () => Option.some(now)),
							marks: r.marks.map((m) => ({
								...m,
								endMs: Option.orElse(m.endMs, () =>
									Option.some(now - r.startedAt),
								),
							})),
							audio: r.state === "recording" ? "pending" : r.audio,
						}));
					}
					yield* repo.deleteAudio(
						children
							.filter((record) => record.state === "recording")
							.map((record) => record.id),
					);
					if (
						children.some(
							(record) =>
								record.state === "recording" && Option.isNone(record.parentId),
						)
					)
						yield* stopTranslation();
					yield* publish();
				}, lock.withPermits(1)),
				delete: Effect.fn("MeetingService.delete")(function* (
					id: MeetingId,
				): Effect.fn.Return<void, MeetingError> {
					const records = (yield* repo.list()).filter(
						(r) => r.id === id || Option.contains(r.parentId, id),
					);
					for (const record of records) yield* capture.cancel(record.id);
					if (
						records.some(
							(record) =>
								record.state === "recording" && Option.isNone(record.parentId),
						)
					)
						yield* stopTranslation();
					yield* repo.remove(records.map((r) => r.id));
					yield* publish();
				}, lock.withPermits(1)),
				translationLost: Effect.fn("MeetingService.translationLost")(() =>
					stopTranslation().pipe(
						Effect.zipRight(
							notice(
								"Live translation stopped because its source or provider is unavailable",
							),
						),
					),
				),
				sourceLost: Effect.fn("MeetingService.sourceLost")(function* (
					id: MeetingId,
				): Effect.fn.Return<void, MeetingError> {
					const record = (yield* repo.list()).find(
						(record) => record.id === id,
					);
					// Queued callbacks may outlive explicit cancellation/deletion or processing.
					if (
						!record ||
						record.state === "cancelled" ||
						record.state === "completed" ||
						record.state === "processing"
					)
						return;
					if (record.state === "recording") yield* stop(record);
					yield* patch(id, (r) => ({
						...r,
						state: "failed",
						errorCode: Option.some("QUAKE.MEETING.SOURCE_LOST"),
					}));
				}, lock.withPermits(1)),
				suspend: suspendCapture,
				shutdown: Effect.fn("MeetingService.shutdown")(() =>
					suspendCapture().pipe(Effect.zipRight(PubSub.shutdown(changes))),
				),
			};
		}),
	},
) {}
