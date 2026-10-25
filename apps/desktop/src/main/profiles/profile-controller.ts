import { createHash } from "node:crypto";
import { Effect, Array as EffectArray, Option } from "effect";
import { translateProfile } from "../../../../../packages/device/src/profiles/profile-catalog.js";
import {
	encodeProfileEnvelope,
	type Profile,
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
	) => Promise<string>;
	readonly cachedThumbnail: (
		profile: Profile,
		locale: ProfileLocale,
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
			const envelope = yield* manager.read();
			const profiles = EffectArray.map(envelope.profiles, (p) =>
				translateProfile(p, requestedLocale),
			);
			const loaded = yield* Effect.forEach(profiles, (p) =>
				thumbnail(() => port.cachedThumbnail(p, requestedLocale)).pipe(
					Effect.map(
						(value) =>
							[
								p.id,
								Option.getOrElse(
									value,
									() =>
										thumbnails.get(profileThumbnailKey(p, requestedLocale)) ??
										"",
								),
							] as const,
					),
				),
			);
			return {
				envelope: encodeProfileEnvelope({ ...envelope, profiles }),
				serials: yield* switching.connectedSerials(),
				apps: port.installedApps ? yield* native(port.installedApps) : [],
				thumbnails: Object.fromEntries(loaded),
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
			const data = yield* thumbnail(() =>
				port.capture(
					translateProfile(p, requestedLocale),
					requestedLocale,
					true,
				),
			);
			thumbnails.set(
				profileThumbnailKey(
					translateProfile(p, requestedLocale),
					requestedLocale,
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
					const getCommand = (p: Profile | undefined): Option.Option<string> =>
						Option.fromNullable(
							p?.pages[0].keys
								.find(
									(k) => k.keyCode === input.keyCode && k.config.type === "cmd",
								)
								?.config.actions.find(
									(a) => a.type === "text" && typeof a.value === "string",
								)?.value,
						).pipe(
							Option.filter(
								(value): value is string => typeof value === "string",
							),
						);
					const envelope = yield* manager.read();
					const command = getCommand(
						envelope.profiles.find((p) => p.id === input.id),
					);
					if (Option.isNone(command))
						return { _tag: "rejected", reason: "missing" };
					const digest = createHash("sha256")
						.update(`${input.id}\0${input.keyCode}\0${command.value}`)
						.digest("hex");
					if (!managerState(envelope).approvedCommands.includes(digest)) {
						const approved = yield* native(() =>
							port.confirm("Run command?", command.value),
						);
						if (!approved) return { _tag: "rejected", reason: "cancelled" };
						yield* repository.transact((current) => {
							const actual = getCommand(
								current.profiles.find((p) => p.id === input.id),
							);
							if (Option.isNone(actual) || actual.value !== command.value)
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
					yield* native(() => port.execute(command.value));
					break;
				}
			}
			return { _tag: "success", view: yield* publish() };
		});
		return {
			request,
			view,
			publish,
			progress: () => progress,
			currentLocale: (): ProfileLocale => locale,
		};
	},
);
