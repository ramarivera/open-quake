import { Effect, Array as EffectArray, Option, Ref, Schema } from "effect";
import { validateAction } from "../actions/action-invariants.js";
import { findAction } from "../actions/action-registry.js";
import {
	type KeyDraft,
	type KeyTarget,
	keyEditable,
	previewEnvelope,
	replaceProfileKey,
	titleWeight,
} from "./key-editing-invariants.js";
import {
	createEmptyProfileKey,
	Profile,
	ProfileKey,
} from "./profile-contracts.js";
import {
	ProfileNotFound,
	type ProfileRepositoryError,
	ProfileRevisionConflict,
	ProfileValidationFailed,
} from "./profile-errors.js";
import { ProfileRepository } from "./profile-repository.js";
import { ProfileService } from "./profile-service.js";

export class KeyEditing extends Effect.Service<KeyEditing>()(
	"@open-quake/device/KeyEditing",
	{
		accessors: true,
		dependencies: [ProfileService.Default, ProfileRepository.Default],
		effect: Effect.gen(function* () {
			const profiles = yield* ProfileService;
			const repository = yield* ProfileRepository;
			const pending = yield* Ref.make(Option.none<KeyDraft>());
			const lock = yield* Effect.makeSemaphore(1);
			const locate = Effect.fn("KeyEditing.locate")(function* (
				target: KeyTarget,
			): Effect.fn.Return<
				Awaited<ReturnType<typeof replaceProfileKey>>,
				ProfileRepositoryError
			> {
				const profile = yield* profiles.getProfile(target.profileId);
				if (profile.revision !== target.revision)
					return yield* Effect.fail(
						ProfileRevisionConflict.forRevisions(
							target.revision,
							profile.revision,
						),
					);
				if (!profile.pages.some((page) => page.id === target.pageId))
					return yield* Effect.fail(ProfileNotFound.fromCause(undefined));
				return profile;
			});
			const preview = Effect.fn("KeyEditing.preview")(function* (
				target: KeyTarget,
				input: unknown,
			): Effect.fn.Return<void, ProfileRepositoryError> {
				const profile = yield* locate(target);
				const decoded = Schema.decodeUnknownEither(ProfileKey)(input);
				if (decoded._tag === "Left" || decoded.right.keyCode !== target.keyCode)
					return yield* Effect.fail(
						ProfileValidationFailed.fromCause(undefined),
					);
				const key = decoded.right;
				if (
					key.config.userModifiedAlterTitle &&
					Option.isSome(key.config.alterTitle) &&
					titleWeight(key.config.alterTitle.value.text) > 20
				)
					return yield* Effect.fail(
						ProfileValidationFailed.fromCause(undefined),
					);
				const original = profile.pages
					.find((p) => p.id === target.pageId)
					?.keys.find((k) => k.keyCode === target.keyCode);
				if (
					titleWeight(key.config.title.text) > 20 &&
					key.config.userModifiedTitle &&
					key.config.title.text !== original?.config.title.text
				)
					return yield* Effect.fail(
						ProfileValidationFailed.fromCause(undefined),
					);
				if (original) {
					if (
						original.config.type !== key.config.type &&
						!keyEditable(original, "allowDelete")
					)
						return yield* Effect.fail(
							ProfileValidationFailed.fromCause(undefined),
						);
					const titleChanged =
						JSON.stringify(original.config.title) !==
							JSON.stringify(key.config.title) ||
						JSON.stringify(original.config.alterTitle) !==
							JSON.stringify(key.config.alterTitle);
					const iconChanged =
						original.config.icon !== key.config.icon ||
						Option.getOrElse(original.config.alterIcon, () => "") !==
							Option.getOrElse(key.config.alterIcon, () => "");
					if (
						(!keyEditable(original, "title") && titleChanged) ||
						(!keyEditable(original, "icon") && iconChanged)
					)
						return yield* Effect.fail(
							ProfileValidationFailed.fromCause(undefined),
						);
				}

				const valid = Schema.decodeUnknownEither(Schema.typeSchema(Profile))(
					replaceProfileKey(profile, target.pageId, key),
				);
				if (valid._tag === "Left")
					return yield* Effect.fail(
						ProfileValidationFailed.fromCause(valid.left),
					);
				yield* Ref.set(pending, Option.some({ target, key }));
			});
			const revert = Effect.fn("KeyEditing.revert")(
				(token: string): Effect.Effect<void> =>
					Ref.update(pending, (draft) =>
						Option.isSome(draft) && draft.value.target.token === token
							? Option.none()
							: draft,
					),
			);
			const commit = Effect.fn("KeyEditing.commit")(function* (
				target: KeyTarget,
				key: ProfileKey,
			): Effect.fn.Return<void, ProfileRepositoryError> {
				yield* repository.transact((envelope) =>
					Effect.gen(function* () {
						const profile = envelope.profiles.find(
							(p) => p.id === target.profileId,
						);
						if (!profile)
							return yield* Effect.fail(ProfileNotFound.fromCause(undefined));
						if (profile.revision !== target.revision)
							return yield* Effect.fail(
								ProfileRevisionConflict.forRevisions(
									target.revision,
									profile.revision,
								),
							);
						const original = profile.pages
							.find((p) => p.id === target.pageId)
							?.keys.find((k) => k.keyCode === target.keyCode);
						const payloadChanged =
							!original ||
							original.config.type !== key.config.type ||
							JSON.stringify(original.config.actions) !==
								JSON.stringify(key.config.actions) ||
							JSON.stringify(original.config.subActions) !==
								JSON.stringify(key.config.subActions);
						if (
							key.config.type &&
							findAction(key.config.type) &&
							payloadChanged
						) {
							const validated = validateAction(
								key.config.type,
								Schema.encodeSync(ProfileKey)(key).config,
							);
							if (validated._tag === "Left")
								return yield* Effect.fail(
									ProfileValidationFailed.fromCause(validated.left),
								);
						}
						const next = {
							...replaceProfileKey(profile, target.pageId, key),
							revision: profile.revision + 1,
						};
						return {
							...envelope,
							profiles: EffectArray.map(envelope.profiles, (p) =>
								p.id === next.id ? next : p,
							),
						};
					}),
				);
			});
			const save = Effect.fn("KeyEditing.save")(function* (
				token: string,
			): Effect.fn.Return<void, ProfileRepositoryError> {
				const draft = yield* Ref.get(pending);
				if (Option.isNone(draft) || draft.value.target.token !== token)
					return yield* Effect.fail(ProfileNotFound.fromCause(undefined));
				const { target, key } = draft.value;
				yield* commit(target, key);
				yield* Ref.set(pending, Option.none());
			});
			const remove = Effect.fn("KeyEditing.remove")(function* (
				target: KeyTarget,
			): Effect.fn.Return<void, ProfileRepositoryError> {
				const profile = yield* locate(target);
				const key = profile.pages
					.find((p) => p.id === target.pageId)
					?.keys.find((k) => k.keyCode === target.keyCode);
				if (!key || !keyEditable(key, "allowDelete"))
					return yield* Effect.fail(
						ProfileValidationFailed.fromCause(undefined),
					);
				yield* commit(target, createEmptyProfileKey(target.keyCode));
				yield* Ref.set(pending, Option.none());
			});
			return {
				preview: (...args: Parameters<typeof preview>) =>
					preview(...args).pipe(lock.withPermits(1)),
				revert: (token: string) => revert(token).pipe(lock.withPermits(1)),
				save: (token: string) => save(token).pipe(lock.withPermits(1)),
				remove: (target: KeyTarget) => remove(target).pipe(lock.withPermits(1)),
				pending: Ref.get(pending),
				discard: Effect.fn("KeyEditing.discard")(() =>
					Ref.set(pending, Option.none()).pipe(lock.withPermits(1)),
				),
				read: Effect.fn("KeyEditing.read")(function* () {
					const { envelope } = yield* profiles.loadProfiles();
					return previewEnvelope(envelope, yield* Ref.get(pending));
				}),
			};
		}),
	},
) {}
