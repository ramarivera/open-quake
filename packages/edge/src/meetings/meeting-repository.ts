import { Effect, Ref, Schema } from "effect";
import {
	type MeetingRecord,
	MeetingStore,
	type TemplateId,
} from "./meeting-contracts.js";
import { type MeetingError, meetingError } from "./meeting-errors.js";
import { recoverRecord } from "./meeting-invariants.js";

export interface MeetingStorage {
	readonly load: () => Effect.Effect<unknown, MeetingError>;
	readonly save: (
		store: typeof MeetingStore.Encoded,
	) => Effect.Effect<void, MeetingError>;
	readonly remove: (
		store: typeof MeetingStore.Encoded,
		ids: readonly string[],
	) => Effect.Effect<void, MeetingError>;
	readonly deleteAudio: (
		ids: readonly string[],
	) => Effect.Effect<void, MeetingError>;
}
const volatile: MeetingStorage = {
	load: () => Effect.succeed({ version: 1, records: [] }),
	save: () => Effect.void,
	deleteAudio: () => Effect.void,
	remove: () => Effect.void,
};
export class MeetingRepository extends Effect.Service<MeetingRepository>()(
	"@open-quake/edge/MeetingRepository",
	{
		accessors: true,
		effect: (storage: MeetingStorage = volatile) =>
			Effect.gen(function* () {
				const records = yield* Ref.make<readonly MeetingRecord[]>([]);
				const template = yield* Ref.make<TemplateId>("project-weekly");
				const lock = yield* Effect.makeSemaphore(1);
				let initialized = false;
				const initialize = Effect.gen(function* () {
					if (initialized) return;
					const data = yield* storage.load().pipe(
						Effect.flatMap(Schema.decodeUnknown(MeetingStore)),
						Effect.mapError((cause) => meetingError("StorageFailed", cause)),
					);
					yield* Ref.set(records, data.records.map(recoverRecord));
					yield* Ref.set(template, data.summaryTemplate);
					initialized = true;
				});
				const commit = Effect.fn("MeetingRepository.commit")(
					(
						next: readonly MeetingRecord[],
						selected?: TemplateId,
					): Effect.Effect<void, MeetingError> =>
						Effect.gen(function* () {
							const summaryTemplate = selected ?? (yield* Ref.get(template));
							const encoded = yield* Schema.encode(MeetingStore)({
								version: 1,
								records: next,
								summaryTemplate,
							}).pipe(
								Effect.mapError((cause) =>
									meetingError("StorageFailed", cause),
								),
							);
							yield* storage.save(encoded);
							yield* Ref.set(records, next);
							yield* Ref.set(template, summaryTemplate);
						}).pipe(Effect.uninterruptible),
				);
				return {
					defaultTemplate: Effect.fn("MeetingRepository.defaultTemplate")(() =>
						lock.withPermits(1)(
							initialize.pipe(Effect.zipRight(Ref.get(template))),
						),
					),
					selectTemplate: Effect.fn("MeetingRepository.selectTemplate")(
						(
							id: string,
							selected: TemplateId,
						): Effect.Effect<void, MeetingError> =>
							lock.withPermits(1)(
								Effect.gen(function* () {
									yield* initialize;
									const current = yield* Ref.get(records);
									if (!current.some((record) => record.id === id))
										return yield* meetingError("Invalid");
									yield* commit(
										current.map((record) =>
											record.id === id
												? { ...record, template: selected }
												: record,
										),
										selected,
									);
								}),
							),
					),
					list: Effect.fn("MeetingRepository.list")(() =>
						lock.withPermits(1)(
							initialize.pipe(Effect.zipRight(Ref.get(records))),
						),
					),
					update: Effect.fn("MeetingRepository.update")(
						(
							transform: (
								records: readonly MeetingRecord[],
							) => readonly MeetingRecord[],
						): Effect.Effect<void, MeetingError> =>
							lock.withPermits(1)(
								initialize
									.pipe(Effect.zipRight(Ref.get(records)))
									.pipe(
										Effect.flatMap((current) => commit(transform(current))),
									),
							),
					),
					remove: Effect.fn("MeetingRepository.remove")(
						(ids: readonly string[]) =>
							lock.withPermits(1)(
								Effect.gen(function* () {
									yield* initialize;
									const next = (yield* Ref.get(records)).filter(
										(r) => !ids.includes(r.id),
									);
									const encoded = yield* Schema.encode(MeetingStore)({
										version: 1,
										records: next,
										summaryTemplate: yield* Ref.get(template),
									}).pipe(
										Effect.mapError((cause) =>
											meetingError("StorageFailed", cause),
										),
									);
									yield* storage.remove(encoded, ids);
									yield* Ref.set(records, next);
								}).pipe(Effect.uninterruptible),
							),
					),
					deleteAudio: Effect.fn("MeetingRepository.deleteAudio")(
						storage.deleteAudio,
					),
				};
			}),
	},
) {}
