import { createHash } from "node:crypto";
import { Effect, Array as EffectArray, Option, Schema } from "effect";
import { MultiActionConfig } from "../../../../../packages/device/src/actions/action-contracts.js";
import type { KeyActivation } from "../../../../../packages/device/src/actions/key-runtime-service.js";
import { translateProfile } from "../../../../../packages/device/src/profiles/profile-catalog.js";
import {
	type Profile,
	type ProfileEnvelope,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import {
	ProfileCommandFailed,
	ProfileDeliveryFailed,
	type ProfileDesktopError,
	ProfileThumbnailFailed,
	ProfileThumbnailUnsupported,
	ProfileWriteFailed,
} from "../../../../../packages/device/src/profiles/profile-errors.js";
import type { ProfileLocale } from "../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import { managerState } from "../../../../../packages/device/src/profiles/profile-manager-invariants.js";
import { ProfileManager } from "../../../../../packages/device/src/profiles/profile-manager-service.js";
import { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository.js";
import { ProfileSwitching } from "../../../../../packages/device/src/profiles/profile-switching-service.js";
import type {
	ProfileReply,
	ProfileRequest,
	ProfileView,
	ThumbnailProgress,
} from "../../shared/profile-manager";
import { encodeRendererProfiles } from "./clock-profile-projection";

/** Main-process-only ownership. Never accepted from renderer IPC. */
export interface ProfileSelectionScope {
	readonly deviceId: string;
	readonly isCurrent: () => boolean;
}
export interface ProfileDesktopPort {
	readonly localeChanged?: (locale: ProfileLocale) => void;
	readonly installedApps?: () => Promise<
		readonly {
			readonly name: string;
			readonly path: string;
			readonly identifier: string;
		}[]
	>;
	readonly confirm: (message: string, detail: string) => Promise<boolean>;
	readonly execute: (command: string) => Promise<void>;
	readonly chooseApp: () => Promise<Option.Option<string>>;
	readonly capture: (
		profile: Profile,
		locale: ProfileLocale,
		refresh: boolean,
		showEmptyGridDashedBorder: boolean,
	) => Promise<string>;
	readonly cachedThumbnail: (
		profile: Profile,
		locale: ProfileLocale,
		showEmptyGridDashedBorder: boolean,
	) => Promise<Option.Option<string>>;
	readonly publish: (view: ProfileView) => void;
	readonly progress: (progress: ThumbnailProgress) => void;
}
export { profileThumbnailKey } from "./profile-thumbnail-key";

import { profileThumbnailKey } from "./profile-thumbnail-key";
/** Main boundary supplies only native operations; all commands use repository transactions. */
export const makeProfileController = Effect.fn("ProfileDesktop.controller")(
	function* (port: ProfileDesktopPort) {
		const manager = yield* ProfileManager;
		const repository = yield* ProfileRepository;
		const switching = yield* ProfileSwitching;
		let progress: ThumbnailProgress = {
			running: false,
			done: 0,
			total: 0,
			failed: 0,
		};
		let cancelled = false;
		let locale: ProfileLocale = "en";
		let showEmptyGridDashedBorder = true;
		const thumbnailStyleLock = yield* Effect.makeSemaphore(1);
		const pendingStyleCaptures = new Set<string>();
		const thumbnails = new Map<string, string>();
		const native = <A>(
			operation: () => Promise<A>,
		): Effect.Effect<A, ProfileCommandFailed> =>
			Effect.tryPromise({
				try: operation,
				catch: ProfileCommandFailed.fromCause,
			});
		const thumbnail = <A>(
			operation: () => Promise<A>,
		): Effect.Effect<A, ProfileThumbnailFailed | ProfileThumbnailUnsupported> =>
			Effect.tryPromise({
				try: operation,
				catch: (cause) =>
					cause instanceof ProfileThumbnailUnsupported ||
					cause instanceof ProfileThumbnailFailed
						? cause
						: ProfileThumbnailFailed.fromCause(cause),
			});
		const view = Effect.fn("ProfileDesktop.view")(function* (
			requestedLocale: ProfileLocale = locale,
		): Effect.fn.Return<ProfileView, ProfileDesktopError> {
			const border = showEmptyGridDashedBorder;
			const envelope = yield* manager.read();
			const profiles = EffectArray.map(envelope.profiles, (p) =>
				translateProfile(p, requestedLocale),
			);
			const loaded = yield* Effect.forEach(profiles, (p) =>
				thumbnail(() => port.cachedThumbnail(p, requestedLocale, border)).pipe(
					Effect.map(
						(value) =>
							[
								p.id,
								Option.getOrElse(
									value,
									() =>
										thumbnails.get(
											profileThumbnailKey(p, requestedLocale, border),
										) ?? "",
								),
							] as const,
					),
				),
			);
			return {
				envelope: encodeRendererProfiles({ ...envelope, profiles }),
				serials: yield* switching.connectedSerials(),
				apps: port.installedApps ? yield* native(port.installedApps) : [],
				thumbnails: Object.fromEntries(loaded),
				thumbnailShowEmptyGridDashedBorder: border,
				progress,
			};
		});
		const publish = Effect.fn("ProfileDesktop.publish")(
			function* (): Effect.fn.Return<ProfileView, ProfileDesktopError> {
				const current = yield* view();
				yield* Effect.sync(() => port.publish(current));
				return current;
			},
		);
		const capture = Effect.fn("ProfileDesktop.capture")(function* (
			id: string,
			requestedLocale: ProfileLocale,
		): Effect.fn.Return<void, ProfileDesktopError> {
			const envelope = yield* manager.read();
			const p = envelope.profiles.find((p) => p.id === id);
			if (!p) return;
			const border = showEmptyGridDashedBorder;
			const data = yield* thumbnail(() =>
				port.capture(
					translateProfile(p, requestedLocale),
					requestedLocale,
					true,
					border,
				),
			);
			thumbnails.set(
				profileThumbnailKey(
					translateProfile(p, requestedLocale),
					requestedLocale,
					border,
				),
				data,
			);
		});
		const batch = Effect.fn("ProfileDesktop.batch")(
			function* (): Effect.fn.Return<void, ProfileDesktopError> {
				const envelope = yield* manager.read();
				const ids = envelope.profiles
					.filter((p) => !managerState(envelope).hidden.includes(p.id))
					.map((p) => p.id);
				progress = { running: true, done: 0, total: ids.length, failed: 0 };
				cancelled = false;
				yield* Effect.sync(() => port.progress(progress));
				for (const id of ids) {
					if (cancelled) break;
					const result = yield* capture(id, locale).pipe(Effect.either);
					progress = {
						...progress,
						done: progress.done + 1,
						failed: progress.failed + (result._tag === "Left" ? 1 : 0),
					};
					yield* Effect.sync(() => port.progress(progress));
				}
				progress = { ...progress, running: false };
				yield* Effect.sync(() => port.progress(progress));
				yield* publish();
			},
		);
		const runKeyCommand = Effect.fn("ProfileDesktop.runKeyCommand")(function* (
			key: ProfileKey,
			activation: KeyActivation,
			requireSelection = true,
		): Effect.fn.Return<boolean, ProfileDesktopError> {
			const command = key.config.actions.find((a) => a.type === "text")?.value;
			if (
				key.config.type !== "cmd" ||
				typeof command !== "string" ||
				!command.trim()
			)
				return false;
			const owns = (env: typeof ProfileEnvelope.Type) => {
				const p = env.profiles.find((p) => p.id === activation.profileId);
				const saved = p?.pages
					.find((p) => p.id === activation.pageId)
					?.keys.find((k) => k.keyCode === key.keyCode);
				const selection = env.activeByDevice[activation.deviceId];
				const sameCommand =
					saved?.config.type === "cmd" &&
					saved.config.actions.some(
						(a) => a.type === "text" && a.value === command,
					);
				const nested = Schema.decodeUnknownEither(MultiActionConfig)(
					saved ? Schema.encodeSync(ProfileKey)(saved).config : undefined,
				);
				const nestedCommand =
					nested._tag === "Right" &&
					nested.right.subActions.some(
						(step) =>
							step.isPlugin !== true &&
							step.config.type === "cmd" &&
							step.config.actions.some(
								(a) => a.type === "text" && a.value === command,
							),
					);
				return (
					p?.revision === activation.revision &&
					(sameCommand || nestedCommand) &&
					(!requireSelection ||
						(selection?.profileId === p.id &&
							selection.pageId === activation.pageId))
				);
			};
			const envelope = yield* manager.read();
			if (!owns(envelope)) return false;
			const digest = createHash("sha256")
				.update(
					`${activation.profileId}\0${activation.pageId}\0${key.keyCode}\0${command}`,
				)
				.digest("hex");
			if (!managerState(envelope).approvedCommands.includes(digest)) {
				if (!(yield* native(() => port.confirm("Run command?", command))))
					return false;
				yield* repository.transact((current) => {
					if (!owns(current))
						return Effect.fail(ProfileWriteFailed.fromCause(undefined));
					const state = managerState(current);
					return Effect.succeed({
						...current,
						manager: Option.some({
							...state,
							approvedCommands: [
								...new Set([...state.approvedCommands, digest]),
							],
							revision: state.revision + 1,
						}),
					});
				});
			}
			if (!owns(yield* manager.read())) return false;
			yield* native(() => port.execute(command));
			return true;
		});

		const request = Effect.fn("ProfileDesktop.request")(function* (
			input: ProfileRequest,
			scope?: ProfileSelectionScope,
		): Effect.fn.Return<ProfileReply, ProfileDesktopError> {
			const ownsSession =
				scope && scope.deviceId !== "desktop-preview"
					? yield* switching.sessionOwnership(scope.deviceId)
					: () => true;
			const isCurrent = () => !scope || (scope.isCurrent() && ownsSession());
			const ensureCurrent = Effect.suspend(() =>
				!isCurrent()
					? Effect.fail(ProfileDeliveryFailed.fromCause(undefined))
					: Effect.void,
			);
			const guard = scope
				? () => {
						if (!isCurrent()) throw ProfileDeliveryFailed.fromCause(undefined);
					}
				: undefined;
			switch (input.type) {
				case "thumbnail-style":
					return yield* Effect.gen(function* () {
						if (showEmptyGridDashedBorder !== input.showEmptyGridDashedBorder) {
							const previous = yield* view();
							showEmptyGridDashedBorder = input.showEmptyGridDashedBorder;
							for (const [id, data] of Object.entries(previous.thumbnails))
								if (data) pendingStyleCaptures.add(id);
							yield* Effect.sync(() => port.localeChanged?.(locale));
							yield* publish();
						}
						for (const id of [...pendingStyleCaptures]) {
							const result = yield* capture(id, locale).pipe(Effect.either);
							if (result._tag === "Right") pendingStyleCaptures.delete(id);
							else
								yield* Effect.logWarning(
									"profiles.thumbnail.style.failed",
									result.left,
								);
						}
						return { _tag: "success", view: yield* publish() } as const;
					}).pipe(thumbnailStyleLock.withPermits(1));
				case "read":
					if (!input.preview && locale !== input.locale) {
						locale = input.locale;
						yield* Effect.sync(() => port.localeChanged?.(locale));
					}
					return { _tag: "success", view: yield* view(input.locale) };
				case "manage": {
					const changesSelection =
						input.command.type === "select" ||
						input.command.type === "create" ||
						input.command.type === "duplicate" ||
						input.command.type === "delete" ||
						input.command.type === "visibility";
					const result = yield* manager.command(
						input.command,
						(envelope) =>
							Effect.gen(function* () {
								yield* ensureCurrent;
								if (!changesSelection) return envelope;
								let selections = envelope.activeByDevice;
								const selected = envelope.activeByDevice["desktop-preview"];
								const connected = yield* switching.connectedSerials();
								if (
									scope &&
									scope.deviceId !== "desktop-preview" &&
									!connected.includes(scope.deviceId)
								)
									return yield* ProfileDeliveryFailed.fromCause(undefined);
								const targets = scope
									? connected.filter((serial) => serial === scope.deviceId)
									: connected;
								for (const serial of targets) {
									yield* ensureCurrent;
									const target =
										input.command.type === "delete" ||
										input.command.type === "visibility"
											? envelope.activeByDevice[serial]
											: selected;
									const profile = envelope.profiles.find(
										(p) => p.id === target?.profileId,
									);
									if (profile) {
										yield* switching.deliver(serial, profile, guard);
										yield* ensureCurrent;
										selections = {
											...selections,
											[serial]: {
												profileId: profile.id,
												pageId: profile.pages[0].id,
											},
										};
									}
								}
								return { ...envelope, activeByDevice: selections };
							}),
						guard,
					);
					if (result._tag === "rejected") return result;
					if (input.command.type === "create") {
						const selected = result.envelope.activeByDevice["desktop-preview"];
						if (selected)
							yield* capture(selected.profileId, locale).pipe(
								Effect.catchTags({
									ProfileReadFailed: () => Effect.void,
									ProfileWriteFailed: () => Effect.void,
									ProfileValidationFailed: () => Effect.void,
									ProfileNotFound: () => Effect.void,
									ProfileRevisionConflict: () => Effect.void,
									ProfileCommandFailed: () => Effect.void,
									ProfileThumbnailFailed: () => Effect.void,
									ProfileThumbnailUnsupported: () => Effect.void,
									ProfileForegroundFailed: () => Effect.void,
									ProfileDeliveryFailed: () => Effect.void,
								}),
							);
					}
					break;
				}
				case "thumbnail":
					yield* capture(input.id, input.locale);
					break;
				case "thumbnails":
					if (!progress.running) {
						progress = { ...progress, running: true };
						yield* batch().pipe(
							Effect.ensuring(
								Effect.sync(() => {
									progress = { ...progress, running: false };
									port.progress(progress);
								}),
							),
						);
					}
					break;
				case "cancel-thumbnails":
					cancelled = true;
					break;
				case "choose-app": {
					const path = yield* native(port.chooseApp);
					if (Option.isNone(path)) break;
					const result = yield* manager.command({
						type: "link",
						id: input.id,
						link: {
							profileId: input.id,
							appPath: path.value,
							appIdentifier:
								path.value
									.split(/[\\/]/)
									.pop()
									?.replace(/\.(app|exe|sh|bin)$/i, "") || path.value,
							...(input.device ? { device: input.device } : {}),
						},
					});
					if (result._tag === "rejected") return result;
					break;
				}
				case "run-command": {
					const envelope = yield* manager.read();
					const p = envelope.profiles.find((p) => p.id === input.id);
					const page = p?.pages[0];
					const key = page?.keys.find(
						(k) => k.keyCode === input.keyCode && k.config.type === "cmd",
					);
					if (!p || !page || !key)
						return { _tag: "rejected", reason: "missing" };
					if (
						!(yield* runKeyCommand(
							key,
							{
								deviceId: scope?.deviceId ?? "desktop-preview",
								profileId: p.id,
								pageId: page.id,
								revision: p.revision,
							},
							false,
						))
					)
						return { _tag: "rejected", reason: "cancelled" };
					break;
				}
			}
			return { _tag: "success", view: yield* publish() };
		});
		return {
			runKeyCommand,
			request,
			view,
			publish,
			progress: () => progress,
			currentLocale: (): ProfileLocale => locale,
			currentThumbnailBorder: (): boolean => showEmptyGridDashedBorder,
		};
	},
);
