import { Effect, Ref, Schema } from "effect";
import { type MeetingRecord, MeetingStore } from "./meeting-contracts.js";
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
				const lock = yield* Effect.makeSemaphore(1);
				let initialized = false;
				const initialize = Effect.gen(function* () {
					if (initialized) return;
					const data = yield* storage.load().pipe(
						Effect.flatMap(Schema.decodeUnknown(MeetingStore)),
						Effect.mapError((cause) => meetingError("StorageFailed", cause)),
					);
					yield* Ref.set(records, data.records.map(recoverRecord));
					initialized = true;
				});
				const commit = Effect.fn("MeetingRepository.commit")(
					(next: readonly MeetingRecord[]): Effect.Effect<void, MeetingError> =>
						Schema.encode(MeetingStore)({ version: 1, records: next }).pipe(
							Effect.mapError((cause) => meetingError("StorageFailed", cause)),
							Effect.flatMap(storage.save),
							Effect.zipRight(Ref.set(records, next)),
							Effect.uninterruptible,
						),
				);
				return {
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
