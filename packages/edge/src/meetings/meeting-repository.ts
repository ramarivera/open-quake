import { Effect, Ref, Schema } from "effect";
import { type MeetingRecord, MeetingStore } from "./meeting-contracts.js";
import { type MeetingError, meetingError } from "./meeting-errors.js";
import { recoverRecord } from "./meeting-invariants.js";

export interface MeetingStorage {
	readonly load: () => Effect.Effect<unknown, MeetingError>;
	readonly save: (
		store: typeof MeetingStore.Encoded,
	) => Effect.Effect<void, MeetingError>;
	readonly deleteAudio: (
		ids: readonly string[],
	) => Effect.Effect<void, MeetingError>;
}
const volatile: MeetingStorage = {
	load: () => Effect.succeed({ version: 1, records: [] }),
	save: () => Effect.void,
	deleteAudio: () => Effect.void,
};
export class MeetingRepository extends Effect.Service<MeetingRepository>()(
	"@open-quake/edge/MeetingRepository",
	{
		accessors: true,
		effect: (storage: MeetingStorage = volatile) =>
			Effect.gen(function* () {
				const data = yield* storage.load().pipe(
					Effect.flatMap(Schema.decodeUnknown(MeetingStore)),
					Effect.mapError((cause) => meetingError("StorageFailed", cause)),
				);
				const records = yield* Ref.make<readonly MeetingRecord[]>(
					data.records.map(recoverRecord),
				);
				const lock = yield* Effect.makeSemaphore(1);
				const commit = Effect.fn("MeetingRepository.commit")(
					(next: readonly MeetingRecord[]): Effect.Effect<void, MeetingError> =>
						Schema.encode(MeetingStore)({ version: 1, records: next }).pipe(
							Effect.mapError((cause) => meetingError("StorageFailed", cause)),
							Effect.flatMap(storage.save),
							Effect.zipRight(Ref.set(records, next)),
						),
				);
				return {
					list: Effect.fn("MeetingRepository.list")(() => Ref.get(records)),
					update: Effect.fn("MeetingRepository.update")(
						(
							transform: (
								records: readonly MeetingRecord[],
							) => readonly MeetingRecord[],
						): Effect.Effect<void, MeetingError> =>
							lock.withPermits(1)(
								Ref.get(records).pipe(
									Effect.flatMap((current) => commit(transform(current))),
								),
							),
					),
					deleteAudio: Effect.fn("MeetingRepository.deleteAudio")(
						storage.deleteAudio,
					),
				};
			}),
	},
) {}
