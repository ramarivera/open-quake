import { Effect, Array as EffectArray, Option, Ref, Schema } from "effect";
import { validateAction } from "../actions/action-invariants.js";
import { createActionDraft, findAction } from "../actions/action-registry.js";
import {
	type KeyDraft,
	type KeyTarget,
	keyEditable,
	previewEnvelope,
	replaceProfileKey,
	sequencePayload,
	titleWeight,
} from "./key-editing-invariants.js";
import {
	editKeyLayout,
	type KeyGeometry,
	type KeyLayoutResult,
} from "./key-geometry.js";
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
import { PROFILE_PAGE_LIMIT } from "./profile-pages.js";
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
				geometry: KeyGeometry = {},
			): Effect.fn.Return<KeyLayoutResult, ProfileRepositoryError> {
				// A rejected edit must never leave an earlier draft available to Save.
				yield* Ref.set(pending, Option.none());
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
				if (
					original &&
					!geometry.placement &&
					original.config.type !== key.config.type &&
					!keyEditable(original, "allowDelete")
				)
					return yield* Effect.fail(
						ProfileValidationFailed.fromCause(undefined),
					);

				const result = editKeyLayout(
					profile.pages.find((p) => p.id === target.pageId)?.keys ?? [],
					key,
					geometry,
				);
				if (result._tag !== "ready") {
					yield* Ref.set(pending, Option.none());
					return result;
				}
				const next = {
					...profile,
					pages: EffectArray.map(profile.pages, (page) =>
						page.id === target.pageId ? { ...page, keys: result.keys } : page,
					),
				};
				const valid = Schema.decodeUnknownEither(Schema.typeSchema(Profile))(
					next,
				);
				if (valid._tag === "Left")
					return yield* Effect.fail(
						ProfileValidationFailed.fromCause(valid.left),
					);
				yield* Ref.set(
					pending,
					Option.some({ target, key, pageKeys: result.keys }),
				);
				return result;
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
				pageKeys?: readonly ProfileKey[],
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
							sequencePayload(original.config.subActions) !==
								sequencePayload(key.config.subActions);
						if (
							key.config.type &&
							findAction(key.config.type) &&
							payloadChanged
						) {
							const validated = validateAction(
								key.config.type,
								Schema.encodeSync(ProfileKey)(key).config,
							);
							const entry = findAction(key.config.type);
							const defaults = entry ? createActionDraft(entry.id) : undefined;
							const unconfiguredTemplate =
								Option.isSome(key.config.compatibility) &&
								key.config.compatibility.value.pendingConfiguration === true &&
								defaults &&
								JSON.stringify(key.config.actions) ===
									JSON.stringify(defaults.actions) &&
								JSON.stringify(Option.getOrUndefined(key.config.subActions)) ===
									JSON.stringify(defaults.subActions);
							if (validated._tag === "Left" && !unconfiguredTemplate)
								return yield* Effect.fail(
									ProfileValidationFailed.fromCause(validated.left),
								);
						}
						const next = {
							...(pageKeys
								? {
										...profile,
										pages: EffectArray.map(profile.pages, (page) =>
											page.id === target.pageId
												? { ...page, keys: pageKeys }
												: page,
										),
									}
								: replaceProfileKey(profile, target.pageId, key)),
							revision: profile.revision + 1,
						};
						// Folder placement and its return key are one persisted revision.
						const folder =
							key.config.type === "createFolder"
								? key.config.actions.find((action) => action.type === "folder")
										?.value
								: undefined;
						if (
							typeof folder === "string" &&
							folder &&
							!next.pages.some((page) => page.id === folder) &&
							next.pages.length >= PROFILE_PAGE_LIMIT
						)
							return yield* ProfileValidationFailed.fromCause(undefined);
						const back = createEmptyProfileKey("1,1");
						const complete =
							typeof folder === "string" &&
							folder &&
							!next.pages.some((page) => page.id === folder)
								? {
										...next,
										pages: [
											next.pages[0],
											...next.pages.slice(1),
											{
												id: folder,
												compatibility: Option.none(),
												keys: [
													{
														...back,
														childrenName: Option.some("back"),
														config: {
															...back.config,
															type: "back",
															icon: "0-5",
															title: { ...back.config.title, text: "Back" },
															actions: [
																{ type: "parentFolder", value: target.pageId },
															],
															basicEditableItems: Option.some({
																title: true,
																grid: false,
																icon: true,
																allowDelete: false,
																allowDrag: false,
															}),
														},
													},
												],
											},
										] as const,
									}
								: next;
						return {
							...envelope,
							profiles: EffectArray.map(envelope.profiles, (p) =>
								p.id === complete.id ? complete : p,
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
				const { target, key, pageKeys } = draft.value;
				yield* commit(target, key, pageKeys);
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
