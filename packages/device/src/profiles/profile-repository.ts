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
import { upgradeAssistantTitles } from "./profile-assistant-migration.js";
import { profileParseFailure } from "./profile-codec.js";
import {
	type EncodedProfileEnvelope,
	Profile,
	ProfileEnvelope,
	ProfileRevision,
	type ProfileSelection,
	SaveProfileRequest,
	SelectProfileRequest,
} from "./profile-contracts.js";
import {
	ProfileNotFound,
	ProfileReadFailed,
	type ProfileRepositoryError,
	ProfileRevisionConflict,
	ProfileValidationFailed,
	ProfileWriteFailed,
} from "./profile-errors.js";
import { ProfileFunctionContracts } from "./profile-function-contracts.js";
import { committedProfileSnapshot } from "./profile-snapshots.js";

/** Throws when the originating operation no longer owns its device session. */
export type ProfileCommitGuard = () => void;
/** One owner per store. write replaces atomically and checks the guard before publication. */
export interface ProfileStoragePort {
	readonly read: () => Promise<unknown>;
	readonly write: (
		envelope: EncodedProfileEnvelope,
		guard?: ProfileCommitGuard,
	) => Promise<void>;
}
export class ProfileStorage extends Context.Tag(
	"@open-quake/device/ProfileStorage",
)<ProfileStorage, ProfileStoragePort>() {}

/** Runs after publication while the commit lock is held. Must not reenter the repository. */
export class ProfileSelectionCommit extends Context.Tag(
	"@open-quake/device/ProfileSelectionCommit",
)<
	ProfileSelectionCommit,
	{ readonly changed: (deviceId: string) => Effect.Effect<void> }
>() {}

export interface ProfileLoadResult {
	readonly envelope: ProfileEnvelope;
	readonly repairedSelections: readonly string[];
}
export const repairProfileSelections = (
	envelope: ProfileEnvelope,
): ProfileLoadResult => {
	const fallback = envelope.profiles[0];
	const repairedSelections: string[] = [];
	const activeByDevice = new Map<string, ProfileSelection>();
	for (const [serial, selection] of Object.entries(envelope.activeByDevice)) {
		const profile = envelope.profiles.find(
			(entry) => entry.id === selection.profileId,
		);
		if (profile?.pages.some((page) => page.id === selection.pageId))
			activeByDevice.set(serial, selection);
		else {
			repairedSelections.push(serial);
			activeByDevice.set(serial, {
				profileId: fallback.id,
				pageId: fallback.pages[0].id,
			});
		}
	}
	return {
		envelope: {
			...envelope,
			activeByDevice: Object.fromEntries(activeByDevice),
		},
		repairedSelections,
	};
};

// Only identity is needed before checking the revision. Full draft decoding
// happens inside the same critical section, after conflicts have won.
const SaveIdentity = Schema.Struct({
	expectedRevision: ProfileRevision,
	profile: Schema.Struct({ id: Profile.fields.id }),
});

export class ProfileRepository extends Effect.Service<ProfileRepository>()(
	"@open-quake/device/ProfileRepository",
	{
		accessors: true,
		dependencies: [ProfileFunctionContracts.Default],
		effect: Effect.gen(function* () {
			const storage = yield* ProfileStorage;
			const functions = yield* ProfileFunctionContracts;
			const selectionCommit = yield* Effect.serviceOption(
				ProfileSelectionCommit,
			);
			const mutex = yield* Effect.makeSemaphore(1);
			const committed = yield* SubscriptionRef.make(
				Option.none<ProfileEnvelope>(),
			);
			const publishCommitted = Effect.fn("ProfileRepository.publishCommitted")(
				function* (previous: ProfileEnvelope, next: ProfileEnvelope) {
					yield* SubscriptionRef.set(committed, Option.some(next));
					if (Option.isNone(selectionCommit)) return;
					for (const deviceId of new Set([
						...Object.keys(previous.activeByDevice),
						...Object.keys(next.activeByDevice),
					])) {
						const before = previous.activeByDevice[deviceId];
						const after = next.activeByDevice[deviceId];
						if (
							before?.profileId !== after?.profileId ||
							before?.pageId !== after?.pageId
						)
							yield* selectionCommit.value.changed(deviceId);
					}
				},
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
					const migrated = upgradeAssistantTitles(decoded);
					const repaired = repairProfileSelections(migrated);
					const snapshot = yield* committedProfileSnapshot(
						repaired.envelope,
					).pipe(
						Effect.catchTag("ParseError", (cause) =>
							Effect.fail(profileParseFailure(cause)),
						),
					);
					if (repaired.repairedSelections.length > 0 || migrated !== decoded)
						yield* write(snapshot);
					yield* SubscriptionRef.set(committed, Option.some(snapshot));
					return { ...repaired, envelope: snapshot };
				},
			);
			const write = Effect.fn("ProfileRepository.write")(
				(
					envelope: ProfileEnvelope,
					guard?: ProfileCommitGuard,
				): Effect.Effect<void, ProfileWriteFailed | ProfileValidationFailed> =>
					Schema.encode(ProfileEnvelope)(envelope, {
						onExcessProperty: "error",
					}).pipe(
						Effect.catchTag("ParseError", (cause) =>
							Effect.fail(profileParseFailure(cause)),
						),
						Effect.flatMap((encoded) =>
							Effect.tryPromise({
								try: () => {
									guard?.();
									return storage.write(encoded, guard);
								},
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
					request: unknown,
				): Effect.Effect<ProfileEnvelope, ProfileRepositoryError> =>
					Effect.gen(function* () {
						const identity = yield* Schema.decodeUnknown(SaveIdentity)(
							request,
						).pipe(
							Effect.catchTag("ParseError", (cause) =>
								Effect.fail(profileParseFailure(cause)),
							),
						);
						const { expectedRevision } = identity;
						const { envelope } = yield* loadUnlocked();
						const previous = envelope.profiles.find(
							(entry) => entry.id === identity.profile.id,
						);
						if (!previous) return yield* ProfileNotFound.fromCause(undefined);
						if (previous.revision !== expectedRevision)
							return yield* ProfileRevisionConflict.forRevisions(
								expectedRevision,
								previous.revision,
							);
						const input = yield* Schema.decodeUnknown(SaveProfileRequest)(
							request,
							{
								onExcessProperty: "error",
							},
						).pipe(
							Effect.catchTag("ParseError", (cause) =>
								Effect.fail(profileParseFailure(cause)),
							),
						);
						// Loading may suspend. Do not save a different identity if the
						// caller mutates its request while storage is being read.
						if (
							input.profile.id !== identity.profile.id ||
							input.expectedRevision !== expectedRevision
						)
							return yield* ProfileValidationFailed.fromCause(undefined, [
								["profile", "id"],
								["expectedRevision"],
							]);
						const profile = {
							...input.profile,
							revision: expectedRevision + 1,
						};
						yield* functions.validateProfile(profile);
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
						// No draft or failed write reaches subscribers.
						yield* publishCommitted(envelope, candidate);
						return candidate;
					}).pipe(mutex.withPermits(1), Effect.uninterruptible),
			);
			const select = Effect.fn("ProfileRepository.select")(
				(
					request: unknown,
					guard?: ProfileCommitGuard,
				): Effect.Effect<ProfileEnvelope, ProfileRepositoryError> =>
					Effect.gen(function* () {
						const input = yield* Schema.decodeUnknown(SelectProfileRequest)(
							request,
							{ onExcessProperty: "error" },
						).pipe(
							Effect.catchTag("ParseError", (cause) =>
								Effect.fail(profileParseFailure(cause)),
							),
						);
						const { envelope } = yield* loadUnlocked();
						const profile = envelope.profiles.find(
							(entry) => entry.id === input.profileId,
						);
						const page = input.pageId
							? profile?.pages.find((entry) => entry.id === input.pageId)
							: profile?.pages[0];
						if (!profile || !page)
							return yield* ProfileNotFound.fromCause(undefined);
						const previous = envelope.activeByDevice[input.deviceId];
						if (
							previous?.profileId === profile.id &&
							previous.pageId === page.id
						)
							return envelope;
						const candidate = {
							...envelope,
							activeByDevice: {
								...envelope.activeByDevice,
								[input.deviceId]: { profileId: profile.id, pageId: page.id },
							},
						};
						yield* write(candidate, guard);
						yield* publishCommitted(envelope, candidate);
						return candidate;
					}).pipe(mutex.withPermits(1), Effect.uninterruptible),
			);
			const transact = Effect.fn("ProfileRepository.transact")(
				<E = never>(
					change: (
						envelope: ProfileEnvelope,
					) => Effect.Effect<ProfileEnvelope, ProfileRepositoryError | E>,
					guard?: ProfileCommitGuard,
				): Effect.Effect<ProfileEnvelope, ProfileRepositoryError | E> =>
					Effect.gen(function* () {
						const { envelope } = yield* loadUnlocked();
						const next = yield* change(envelope);
						if (next === envelope) return envelope;
						const snapshot = yield* committedProfileSnapshot(next).pipe(
							Effect.catchTag("ParseError", (cause) =>
								Effect.fail(profileParseFailure(cause)),
							),
						);
						yield* write(snapshot, guard);
						yield* publishCommitted(envelope, snapshot);
						return snapshot;
					}).pipe(mutex.withPermits(1), Effect.uninterruptible),
			);
			return {
				transact,
				load,
				save,
				select,
				snapshots: committed.changes.pipe(
					Stream.filterMap((snapshot) => snapshot),
				),
				dispatchSnapshots: committed.changes.pipe(
					Stream.filterMap((snapshot) => snapshot),
					Stream.mapEffect(functions.dispatchSnapshot),
				),
			};
		}),
	},
) {}

export const profileStorageLayer = (
	storage: ProfileStoragePort,
): Layer.Layer<ProfileStorage> => Layer.succeed(ProfileStorage, storage);
