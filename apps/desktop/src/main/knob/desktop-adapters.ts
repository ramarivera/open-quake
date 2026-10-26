import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";
import type { MediaActionAdapter } from "../../../../../packages/device/src/actions/action-adapters.js";
import {
	KnobCapabilityUnavailable,
	KnobDispatchFailed,
	type KnobError,
	KnobSessionStale,
} from "../../../../../packages/device/src/knob/knob-errors.js";
import type {
	KnobModelContext,
	KnobVoiceInput,
	VolumeReading,
} from "../../../../../packages/device/src/knob/model/contracts.js";
import { volumeStep } from "../../../../../packages/device/src/knob/model/invariants.js";
import type { KnobModelPort } from "../../../../../packages/device/src/knob/model/ports.js";
import { translateProfile } from "../../../../../packages/device/src/profiles/profile-catalog.js";
import {
	encodeProfileEnvelope,
	type Profile,
	ProfileEnvelope,
	type ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import type { ProfileLocale } from "../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import { visibleProfiles } from "../../../../../packages/device/src/profiles/profile-manager-invariants.js";
import type { ProfileStoragePort } from "../../../../../packages/device/src/profiles/profile-repository.js";
import { createDesktopProfileStorage } from "../profiles/local-profile-storage";
import type { ProfileSelectionScope } from "../profiles/profile-controller";
import { profileThumbnailKey } from "../profiles/profile-thumbnail-key";
import { nativeBrightness } from "./brightness";
import type { BrightnessAdapter } from "./brightness/controller";
import { focusedBrightness } from "./focused-brightness";
import { focusedHotkey } from "./focused-hotkey";
import { committedFocusedKey } from "./focused-key";
import { macVolume, script } from "./native-volume";
import { knobThumbnailReader, sameThumbnail } from "./thumbnail-binding";

/** Other lanes compose their qualified action/voice runtimes here. */
export interface DesktopKnobBindings {
	readonly media?: MediaActionAdapter | undefined;
	readonly deviceId?: () => string;
	readonly locale?: () => ProfileLocale;
	readonly thumbnailBorder?: () => boolean;
	/** Owned by the existing profile manager; never creates a second service. */
	readonly thumbnail?: (
		id: string,
		locale: ProfileLocale,
		signal: AbortSignal,
	) => Promise<string>;
	readonly profiles?: {
		readonly read: Effect.Effect<ProfileEnvelope, KnobError>;
		readonly select: (
			profileId: string,
			scope: ProfileSelectionScope,
		) => Effect.Effect<ProfileEnvelope, KnobError>;
	};
	readonly voice?: (input: KnobVoiceInput) => Effect.Effect<void, KnobError>;
	readonly hardware?: () =>
		| import("@open-quake/device").HardwareSession
		| undefined;
	readonly focusedTurn?: KnobModelPort["focusedTurn"];
	readonly readVolume?: KnobModelPort["readVolume"];
	readonly writeVolume?: KnobModelPort["writeVolume"];
	readonly brightness?: BrightnessAdapter;
	readonly obs?: (
		key: ProfileKey,
		delta: -1 | 1 | undefined,
		signal: AbortSignal,
		beforeWrite: () => Promise<void>,
	) => Promise<void>;
}
const unavailable = Effect.fail(KnobCapabilityUnavailable.fromCause());
const keys = (profile: Profile, pageId: string): KnobModelContext["keys"] =>
	(
		profile.pages.find((page) => page.id === pageId) ?? profile.pages[0]
	).keys.flatMap((key) => {
		const kind = key.config.type;
		return kind === "vol" ||
			kind === "luminance" ||
			kind === "brightness" ||
			kind === "hotkey" ||
			kind === "obsVolume"
			? [
					{
						keyCode: key.keyCode,
						kind,
						visible: key.config.display,
						supportKnob: key.config.supportKnob,
						size: key.config.size,
					},
				]
			: [];
	});
const colorful = (profile: Profile): boolean =>
	profile.id === "1-4" ||
	(Option.isSome(profile.compatibility) &&
		(profile.compatibility.value.type === 0 ||
			(typeof profile.compatibility.value.name === "string" &&
				profile.compatibility.value.name.startsWith("5,")) ||
			profile.compatibility.value.resourceId === "1-4"));

export function desktopKnobAdapters(
	root: string,
	bindings: DesktopKnobBindings = {},
	storage: ProfileStoragePort = createDesktopProfileStorage(
		join(root, "profiles-v1.json"),
	),
): {
	readonly ports: KnobModelPort;
	readonly load: Effect.Effect<KnobModelContext, KnobError>;
	readonly contextVersion: () => string;
} {
	let context: KnobModelContext;
	let version = "";
	let catalog: readonly Profile[] = [];
	let locale: ProfileLocale = "en";
	const thumbnail = knobThumbnailReader(join(root, "profiles"), bindings);
	const deviceId = () => bindings.deviceId?.() ?? "desktop-preview";
	const read =
		bindings.profiles?.read ??
		Effect.tryPromise({
			try: () => storage.read(),
			catch: (cause) => KnobDispatchFailed.fromCause(cause),
		}).pipe(
			Effect.flatMap((raw) => Schema.decodeUnknown(ProfileEnvelope)(raw)),
			Effect.catchTag("ParseError", (cause) =>
				Effect.fail(KnobDispatchFailed.fromCause(cause)),
			),
		);
	const makeContext = (
		envelope: ProfileEnvelope,
		profileId: string,
	): KnobModelContext => {
		const visible = visibleProfiles(envelope);
		const profile =
			visible.find((p) => p.id === profileId) ??
			visible[0] ??
			envelope.profiles[0];
		const serial = deviceId();
		const selection = envelope.activeByDevice[serial];
		const pageId =
			selection?.profileId === profile.id
				? selection.pageId
				: profile.pages[0].id;
		return {
			session: {
				deviceId: serial,
				sessionId: randomUUID(),
				profileId: profile.id,
				revision: profile.revision,
			},
			pageId,
			profiles: visible.map((p) => ({
				id: p.id,
				name: p.name,
				colorful: colorful(p),
				thumbnailKey: profileThumbnailKey(
					translateProfile(p, locale),
					locale,
					bindings.thumbnailBorder?.() ?? true,
				),
				thumbnail: { _tag: "missing" },
			})),
			keys: keys(profile, pageId),
			player: (
				profile.pages.find((page) => page.id === pageId) ?? profile.pages[0]
			).keys.some((k) => k.config.type === "playAudio" && k.config.display),
		};
	};
	const load = Effect.fn("DesktopKnob.load")(function* (): Effect.fn.Return<
		KnobModelContext,
		KnobError
	> {
		const envelope = yield* read;
		catalog = visibleProfiles(envelope);
		locale = bindings.locale?.() ?? "en";
		version = JSON.stringify([
			deviceId(),
			locale,
			catalog.map((p) =>
				profileThumbnailKey(
					translateProfile(p, locale),
					locale,
					bindings.thumbnailBorder?.() ?? true,
				),
			),
		]);
		context = makeContext(
			envelope,
			envelope.activeByDevice[deviceId()]?.profileId ?? envelope.profiles[0].id,
		);
		return context;
	});
	const warmThumbnails: KnobModelPort["warmThumbnails"] = Effect.fn(
		"DesktopKnob.warmThumbnails",
	)((profiles) => {
		const requestedLocale = locale;
		const requestedBorder = bindings.thumbnailBorder?.() ?? true;
		const requestedCatalog = catalog;
		return Effect.forEach(profiles, (profile) => {
			const source = requestedCatalog.find((p) => p.id === profile.id);
			const missing = { ...profile, thumbnail: { _tag: "missing" as const } };
			if (!source) return Effect.succeed(missing);
			return thumbnail(profile, source, requestedLocale).pipe(
				Effect.flatMap((ready) =>
					read.pipe(
						Effect.map((envelope) => {
							const current = visibleProfiles(envelope).find(
								(p) => p.id === profile.id,
							);
							return requestedLocale === (bindings.locale?.() ?? "en") &&
								requestedBorder === (bindings.thumbnailBorder?.() ?? true) &&
								sameThumbnail(source, current, requestedLocale)
								? ready
								: missing;
						}),
					),
				),
				Effect.catchAll((error) =>
					Effect.logWarning(error).pipe(Effect.as(missing)),
				),
			);
		});
	});
	const readVolume = bindings.readVolume ?? macVolume;
	const writeVolume =
		bindings.writeVolume ??
		((reading: VolumeReading) =>
			script(
				`set volume output volume ${reading.level} output muted ${reading.muted ? "true" : "false"}`,
			).pipe(Effect.asVoid));
	const withHardware = (
		action: (
			session: import("@open-quake/device").HardwareSession,
		) => Effect.Effect<void, import("@open-quake/device").HardwareError>,
	): Effect.Effect<void, KnobError> =>
		Effect.suspend((): Effect.Effect<void, KnobError> => {
			const session = bindings.hardware?.();
			return session
				? action(session).pipe(
						Effect.matchEffect({
							onFailure: (cause) =>
								Effect.fail(KnobDispatchFailed.fromCause(cause)),
							onSuccess: () => Effect.void,
						}),
					)
				: unavailable;
		});
	const hotkey = focusedHotkey({
		media: bindings.media,
		read,
		deviceId,
		hardware: () => bindings.hardware?.(),
		context: () => context,
		profiles: () => catalog,
	});
	const brightness = focusedBrightness(
		{ read, deviceId, context: () => context, profiles: () => catalog },
		bindings.brightness ?? nativeBrightness(),
	);
	const resolveObs = committedFocusedKey({
		read,
		deviceId,
		context: () => context,
		profiles: () => catalog,
	});
	const ports: KnobModelPort = {
		alert: () => withHardware((session) => session.playTone("error")),
		selectProfile: Effect.fn("DesktopKnob.selectProfile")(
			function* (profileId): Effect.fn.Return<KnobModelContext, KnobError> {
				const serial = deviceId();
				const hardware = bindings.hardware?.();
				const scope: ProfileSelectionScope = {
					deviceId: serial,
					isCurrent: () =>
						deviceId() === serial && bindings.hardware?.() === hardware,
				};
				if (context.session.deviceId !== serial)
					return yield* Effect.fail(KnobSessionStale.fromCause());
				const envelope = yield* read;
				if (!scope.isCurrent())
					return yield* Effect.fail(KnobSessionStale.fromCause());
				const profile = envelope.profiles.find((p) => p.id === profileId);
				if (!profile) return yield* unavailable;
				let next: ProfileEnvelope = {
					...envelope,
					activeByDevice: {
						...envelope.activeByDevice,
						[serial]: { profileId, pageId: profile.pages[0].id },
					},
				};
				if (bindings.profiles)
					next = yield* bindings.profiles.select(profileId, scope);
				else
					yield* Effect.tryPromise({
						try: () =>
							storage.write(encodeProfileEnvelope(next), () => {
								if (!scope.isCurrent()) throw KnobSessionStale.fromCause();
							}),
						catch: (cause) =>
							!scope.isCurrent()
								? KnobSessionStale.fromCause()
								: KnobDispatchFailed.fromCause(cause),
					});
				if (!scope.isCurrent())
					return yield* Effect.fail(KnobSessionStale.fromCause());
				catalog = visibleProfiles(next);
				locale = bindings.locale?.() ?? "en";
				context = makeContext(next, profileId);
				return context;
			},
		),
		focusedPress: (key, snapshot) =>
			key.kind === "obsVolume" && bindings.obs
				? resolveObs(key, snapshot).pipe(
						Effect.flatMap((committed) =>
							Effect.tryPromise({
								try: (signal) =>
									bindings.obs
										? bindings.obs(committed, undefined, signal, () =>
												Effect.runPromise(
													resolveObs(key, snapshot).pipe(Effect.asVoid),
												),
											)
										: Promise.reject(KnobCapabilityUnavailable.fromCause()),
								catch: (cause) => KnobDispatchFailed.fromCause(cause),
							}),
						),
					)
				: unavailable,
		voice: bindings.voice ?? (() => unavailable),
		focusedTurn:
			bindings.focusedTurn ??
			((key, delta, snapshot) =>
				key.kind === "obsVolume" && bindings.obs
					? resolveObs(key, snapshot).pipe(
							Effect.flatMap((committed) =>
								Effect.tryPromise({
									try: (signal) =>
										bindings.obs
											? bindings.obs(committed, delta, signal, () =>
													Effect.runPromise(
														resolveObs(key, snapshot).pipe(Effect.asVoid),
													),
												)
											: Promise.reject(KnobCapabilityUnavailable.fromCause()),
									catch: (cause) => KnobDispatchFailed.fromCause(cause),
								}),
							),
						)
					: key.kind === "vol"
						? readVolume.pipe(
								Effect.flatMap((reading) => {
									const level = volumeStep(reading.level, delta);
									return writeVolume({ level, muted: level === 0 });
								}),
							)
						: key.kind === "luminance"
							? withHardware((session) => session.stepBrightness(delta))
							: key.kind === "hotkey"
								? hotkey(key, delta, snapshot)
								: key.kind === "brightness"
									? brightness(key, delta, snapshot)
									: unavailable),
		readVolume,
		writeVolume,
		warmThumbnails,
	};
	return { ports, load: load(), contextVersion: () => version };
}
