import {
	Context,
	Effect,
	Array as EffectArray,
	Layer,
	Option,
	Schema,
	Stream,
	SubscriptionRef,
} from "effect";
import { profileParseFailure } from "./profile-codec.js";
import {
	type EncodedProfileEnvelope,
	type Profile,
	ProfileEnvelope,
	type ProfileSelection,
} from "./profile-contracts.js";
import {
	ProfileNotFound,
	ProfileReadFailed,
	type ProfileRepositoryError,
	ProfileRevisionConflict,
	ProfileValidationFailed,
	ProfileWriteFailed,
} from "./profile-errors.js";
import { committedProfileSnapshot } from "./profile-snapshots.js";

/** One desktop main-process owner per store. write must replace the whole envelope atomically. */
export interface ProfileStoragePort {
	readonly read: () => Promise<unknown>;
	readonly write: (envelope: EncodedProfileEnvelope) => Promise<void>;
}
export class ProfileStorage extends Context.Tag(
	"@open-quake/device/ProfileStorage",
)<ProfileStorage, ProfileStoragePort>() {}

export interface ProfileLoadResult {
	readonly envelope: ProfileEnvelope;
	readonly repairedSelections: readonly string[];
}
export const repairProfileSelections = (
	envelope: ProfileEnvelope,
): ProfileLoadResult => {
	const fallback = envelope.profiles[0];
	const repairedSelections: string[] = [];
	const activeByDevice: Record<string, ProfileSelection> = {};
	for (const [serial, selection] of Object.entries(envelope.activeByDevice)) {
		const profile = envelope.profiles.find(
			(entry) => entry.id === selection.profileId,
		);
		if (profile?.pages.some((page) => page.id === selection.pageId))
			activeByDevice[serial] = selection;
		else {
			repairedSelections.push(serial);
			activeByDevice[serial] = {
				profileId: fallback.id,
				pageId: fallback.pages[0].id,
			};
		}
	}
	return { envelope: { ...envelope, activeByDevice }, repairedSelections };
};

export class ProfileRepository extends Effect.Service<ProfileRepository>()(
	"@open-quake/device/ProfileRepository",
	{
		accessors: true,
		effect: Effect.gen(function* () {
			const storage = yield* ProfileStorage;
			const mutex = yield* Effect.makeSemaphore(1);
			const committed = yield* SubscriptionRef.make(
				Option.none<ProfileEnvelope>(),
			);
			const loadUnlocked = Effect.fn("ProfileRepository.loadUnlocked")(
				function* (): Effect.fn.Return<
					ProfileLoadResult,
					ProfileReadFailed | ProfileWriteFailed | ProfileValidationFailed
				> {
					const cached = yield* SubscriptionRef.get(committed);
					if (Option.isSome(cached))
						return { envelope: cached.value, repairedSelections: [] };
					const raw = yield* Effect.tryPromise({
						try: storage.read,
						catch: (cause) =>
							cause instanceof ProfileReadFailed
								? cause
								: ProfileReadFailed.fromCause(cause),
					});
					const decoded = yield* Schema.decodeUnknown(ProfileEnvelope)(raw, {
						onExcessProperty: "error",
					}).pipe(
						Effect.catchTag("ParseError", (cause) =>
							Effect.fail(profileParseFailure(cause)),
						),
					);
					const repaired = repairProfileSelections(decoded);
					const snapshot = yield* committedProfileSnapshot(
						repaired.envelope,
					).pipe(
						Effect.catchTag("ParseError", (cause) =>
							Effect.fail(profileParseFailure(cause)),
						),
					);
					if (repaired.repairedSelections.length > 0) yield* write(snapshot);
					yield* SubscriptionRef.set(committed, Option.some(snapshot));
					return { ...repaired, envelope: snapshot };
				},
			);
			const write = Effect.fn("ProfileRepository.write")(
				(
					envelope: ProfileEnvelope,
				): Effect.Effect<void, ProfileWriteFailed | ProfileValidationFailed> =>
					Schema.encode(ProfileEnvelope)(envelope, {
						onExcessProperty: "error",
					}).pipe(
						Effect.catchTag("ParseError", (cause) =>
							Effect.fail(profileParseFailure(cause)),
						),
						Effect.flatMap((encoded) =>
							Effect.tryPromise({
								try: () => storage.write(encoded),
								catch: (cause) =>
									cause instanceof ProfileWriteFailed
										? cause
										: ProfileWriteFailed.fromCause(cause),
							}),
						),
					),
			);
			const load = Effect.fn("ProfileRepository.load")(
				(): Effect.Effect<ProfileLoadResult, ProfileRepositoryError> =>
					loadUnlocked().pipe(mutex.withPermits(1), Effect.uninterruptible),
			);
			const save = Effect.fn("ProfileRepository.save")(
				(
					profile: Profile,
					expectedRevision: number,
				): Effect.Effect<ProfileEnvelope, ProfileRepositoryError> =>
					Effect.gen(function* () {
						const { envelope } = yield* loadUnlocked();
						const previous = envelope.profiles.find(
							(entry) => entry.id === profile.id,
						);
						if (!previous) return yield* ProfileNotFound.fromCause(undefined);
						if (previous.revision !== expectedRevision)
							return yield* ProfileRevisionConflict.forRevisions(
								expectedRevision,
								previous.revision,
							);
						if (profile.revision !== expectedRevision + 1)
							return yield* ProfileValidationFailed.fromCause(undefined, [
								["revision"],
							]);
						const candidate = yield* committedProfileSnapshot({
							...envelope,
							profiles: EffectArray.map(envelope.profiles, (entry) =>
								entry.id === profile.id ? profile : entry,
							),
						}).pipe(
							Effect.catchTag("ParseError", (cause) =>
								Effect.fail(profileParseFailure(cause)),
							),
						);
						const repaired = repairProfileSelections(candidate);
						if (repaired.repairedSelections.length > 0)
							return yield* ProfileValidationFailed.fromCause(undefined, [
								["activeByDevice"],
							]);
						yield* write(candidate);
						// This is the sole publication point. No draft or failed write reaches subscribers.
						yield* SubscriptionRef.set(committed, Option.some(candidate));
						return candidate;
					}).pipe(mutex.withPermits(1), Effect.uninterruptible),
			);
			return {
				load,
				save,
				snapshots: committed.changes.pipe(
					Stream.filterMap((snapshot) => snapshot),
				),
			};
		}),
	},
) {}

export const profileStorageLayer = (
	storage: ProfileStoragePort,
): Layer.Layer<ProfileStorage> => Layer.succeed(ProfileStorage, storage);
