import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect, Option, Schema } from "effect";
import {
	KnobCapabilityUnavailable,
	KnobDispatchFailed,
	type KnobError,
} from "../../../../../packages/device/src/knob/knob-errors.js";
import {
	type KnobModelContext,
	type KnobVoiceInput,
	VolumeReading,
} from "../../../../../packages/device/src/knob/model/contracts.js";
import { volumeStep } from "../../../../../packages/device/src/knob/model/invariants.js";
import type { KnobModelPort } from "../../../../../packages/device/src/knob/model/ports.js";
import {
	encodeProfileEnvelope,
	type Profile,
	ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import type { ProfileStoragePort } from "../../../../../packages/device/src/profiles/profile-repository.js";
import { ImageDecoder } from "../media/image-decoder";
import { createDesktopProfileStorage } from "../profiles/local-profile-storage";

/** Other lanes compose their qualified action/voice runtimes here. */
export interface DesktopKnobBindings {
	readonly profiles?: {
		readonly read: Effect.Effect<ProfileEnvelope, KnobError>;
		readonly select: (
			profileId: string,
		) => Effect.Effect<ProfileEnvelope, KnobError>;
	};
	readonly voice?: (input: KnobVoiceInput) => Effect.Effect<void, KnobError>;
	readonly hardware?: () =>
		| import("@open-quake/device").HardwareSession
		| undefined;
	readonly focusedTurn?: KnobModelPort["focusedTurn"];
	readonly readVolume?: KnobModelPort["readVolume"];
	readonly writeVolume?: KnobModelPort["writeVolume"];
}
const unavailable = Effect.fail(KnobCapabilityUnavailable.fromCause());
const script = (source: string): Effect.Effect<string, KnobError> =>
	Effect.async((resume) => {
		if (process.platform !== "darwin") {
			resume(unavailable);
			return;
		}
		const child = execFile(
			"/usr/bin/osascript",
			["-e", source],
			{ timeout: 3000 },
			(cause, stdout) => {
				resume(
					cause
						? Effect.fail(KnobDispatchFailed.fromCause(cause))
						: Effect.succeed(stdout.trim()),
				);
			},
		);
		return Effect.sync(() => {
			child.kill();
		});
	});
const macVolume = script(
	"get {output volume, output muted} of (get volume settings)",
).pipe(
	Effect.flatMap((output) => {
		const [raw, mute] = output.split(", ");
		return Schema.decodeUnknown(VolumeReading)({
			level: Number(raw),
			muted: mute === "true",
		}).pipe(
			Effect.catchTag("ParseError", (cause) =>
				Effect.fail(KnobDispatchFailed.fromCause(cause)),
			),
		);
	}),
);
const keys = (profile: Profile, pageId: string): KnobModelContext["keys"] =>
	(
		profile.pages.find((page) => page.id === pageId) ?? profile.pages[0]
	).keys.flatMap((key) => {
		const kind = key.config.type;
		return kind === "vol" ||
			kind === "luminance" ||
			kind === "brightness" ||
			kind === "hotkey"
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
	Option.isSome(profile.compatibility) &&
	(profile.compatibility.value.type === 0 ||
		(typeof profile.compatibility.value.name === "string" &&
			profile.compatibility.value.name.startsWith("5,")) ||
		profile.compatibility.value.resourceId === "1-4");

export function desktopKnobAdapters(
	root: string,
	bindings: DesktopKnobBindings = {},
	storage: ProfileStoragePort = createDesktopProfileStorage(
		join(root, "profiles-v1.json"),
	),
): {
	readonly ports: KnobModelPort;
	readonly load: Effect.Effect<KnobModelContext, KnobError>;
} {
	let context: KnobModelContext;
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
		const profile =
			envelope.profiles.find((p) => p.id === profileId) ?? envelope.profiles[0];
		const selection = envelope.activeByDevice["desktop-preview"];
		const pageId =
			selection?.profileId === profile.id
				? selection.pageId
				: profile.pages[0].id;
		return {
			session: {
				deviceId: "desktop-preview",
				sessionId: randomUUID(),
				profileId: profile.id,
				revision: profile.revision,
			},
			pageId,
			profiles: envelope.profiles.map((p) => ({
				id: p.id,
				name: p.name,
				colorful: colorful(p),
				thumbnail: { _tag: "missing" },
			})),
			keys: keys(profile, pageId),
			player: (
				profile.pages.find((page) => page.id === pageId) ?? profile.pages[0]
			).keys.some((k) => k.config.type === "playAudio" && k.config.display),
		};
	};
	const load = Effect.gen(function* () {
		const envelope = yield* read;
		context = makeContext(
			envelope,
			envelope.activeByDevice["desktop-preview"]?.profileId ??
				envelope.profiles[0].id,
		);
		return context;
	});
	const warmThumbnails: KnobModelPort["warmThumbnails"] = (profiles) =>
		Effect.forEach(profiles, (profile) =>
			Effect.gen(function* () {
				const hash = createHash("sha256").update(profile.id).digest("hex");
				const bytes = yield* Effect.tryPromise({
					try: () => readFile(join(root, "profile-thumbnails", `${hash}.png`)),
					catch: (cause) => KnobDispatchFailed.fromCause(cause),
				}).pipe(Effect.option);
				if (
					Option.isNone(bytes) ||
					bytes.value.length > 1_000_000 ||
					!bytes.value
						.subarray(0, 8)
						.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
				)
					return profile;
				const decoded = yield* ImageDecoder.decode(bytes.value).pipe(
					Effect.provide(ImageDecoder.Default),
					Effect.option,
				);
				if (Option.isNone(decoded)) return profile;
				return {
					...profile,
					thumbnail: { _tag: "ready" as const, dataUrl: decoded.value.dataUrl },
				};
			}),
		);
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
	const ports: KnobModelPort = {
		alert: () => withHardware((session) => session.playTone("error")),
		selectProfile: (profileId) =>
			Effect.gen(function* () {
				const envelope = yield* read;
				const profile = envelope.profiles.find((p) => p.id === profileId);
				if (!profile) return yield* unavailable;
				let next: ProfileEnvelope = {
					...envelope,
					activeByDevice: {
						...envelope.activeByDevice,
						"desktop-preview": { profileId, pageId: profile.pages[0].id },
					},
				};
				if (bindings.profiles)
					next = yield* bindings.profiles.select(profileId);
				else
					yield* Effect.tryPromise({
						try: () => storage.write(encodeProfileEnvelope(next)),
						catch: (cause) => KnobDispatchFailed.fromCause(cause),
					});
				const previousThumbnails = context.profiles;
				context = makeContext(next, profileId);
				context = {
					...context,
					profiles: context.profiles.map((p) => ({
						...p,
						thumbnail:
							previousThumbnails.find((old) => old.id === p.id)?.thumbnail ??
							p.thumbnail,
					})),
				};
				return context;
			}),
		voice: bindings.voice ?? (() => unavailable),
		focusedTurn:
			bindings.focusedTurn ??
			((key, delta) =>
				key.kind === "vol"
					? readVolume.pipe(
							Effect.flatMap((reading) => {
								const level = volumeStep(reading.level, delta);
								return writeVolume({ level, muted: level === 0 });
							}),
						)
					: key.kind === "luminance"
						? withHardware((session) => session.stepBrightness(delta))
						: unavailable),
		readVolume,
		writeVolume,
		warmThumbnails,
	};
	return { ports, load };
}
