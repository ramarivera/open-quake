import { createHash } from "node:crypto";
import { Effect } from "effect";
import type { KeyActivation } from "../../../../../packages/device/src/actions/key-runtime-service";
import type { ProfileKey } from "../../../../../packages/device/src/profiles/profile-contracts";
import type { JsonStore } from "../../../../../packages/edge/src/channels/channel-contracts";
import { SoundboardConfigInvalid } from "../../../../../packages/edge/src/soundboard/soundboard-errors";
import { importSoundConfig } from "../../../../../packages/edge/src/soundboard/soundboard-invariants";
import type { makeSoundboardService } from "../../../../../packages/edge/src/soundboard/soundboard-service";
import type { LocalPlayerSnapshot } from "../../shared/weather-media-contracts";
import { localResumeRepository } from "../weather-media/local-resume";

/** The committed-key boundary. Playback, fades, looping and output stay in their existing owner. */
export function soundboardKeyActions(
	service: Effect.Effect.Success<typeof makeSoundboardService>,
	store?: JsonStore,
) {
	const resume = localResumeRepository(store);
	let revision = 0;
	const owners = new Map<string, { deviceId: string; profileId: string }>();
	const execute = Effect.fn("SoundboardKeys.execute")(function* (
		key: ProfileKey,
		activation: KeyActivation,
	) {
		if (key.config.type === "stopAudio") {
			yield* service.stopAll();
			return true;
		}
		if (
			key.config.type !== "playAudio" &&
			key.config.type !== "playAudioLegacy"
		)
			return false;
		const sounds = key.config.actions.filter(
			(action) => action.type === "sound",
		);
		const actions = key.config.actions.filter(
			(action) => action.type === "audioAction",
		);
		// Keep the native system-media preset with its owner.
		if (
			key.config.actions.some(
				(a) => a.type === "musicSource" && a.value === "system",
			)
		)
			return false;
		if (
			key.config.type === "playAudio" &&
			sounds.length === 1 &&
			sounds[0]?.value === "" &&
			!key.config.actions.some(
				(a) => a.type === "musicSource" && a.value === "local",
			) &&
			actions.length === 1 &&
			actions[0]?.value === 0
		)
			return false;
		const parsed = yield* importSoundConfig({
			type: key.config.type,
			actions: key.config.actions.filter(
				(a) => a.type !== "musicSource" && a.type !== "playerIntent",
			),
		});
		if (
			!parsed.operation ||
			!parsed.fade ||
			parsed.volume === undefined ||
			parsed.issues.some((issue) => issue !== "unverifiedFiles")
		)
			return yield* new SoundboardConfigInvalid();
		const intent = key.config.actions.find(
			(a) => a.type === "playerIntent",
		)?.value;
		if (parsed.operation === "STOP_ALL" && !intent) {
			yield* service.stopAll(parsed.fade);
			return true;
		}
		const profileId = createHash("sha256")
			.update(JSON.stringify([activation.deviceId, activation.profileId]))
			.digest("hex");
		owners.set(profileId, {
			deviceId: activation.deviceId,
			profileId: activation.profileId,
		});
		const owner = {
			profileId,
			keyCode: createHash("sha256")
				.update(JSON.stringify([activation.pageId, key.keyCode]))
				.digest("hex"),
		};
		const playlist = {
			revision: activation.revision,
			entries: parsed.entries,
			volume: parsed.volume,
			fade: parsed.fade,
		};
		const fingerprint = JSON.stringify([
			parsed.entries.map((e) => e.path),
			parsed.volume,
			parsed.fade,
		]);
		const identity = JSON.stringify(owner);
		const active = (yield* service.snapshot())
			.filter(
				(s) =>
					s.owner.profileId === owner.profileId &&
					s.owner.keyCode === owner.keyCode,
			)
			.at(-1);
		if (
			intent &&
			active &&
			active.playlistRevision !== activation.revision &&
			active.state !== "stopped" &&
			active.state !== "failed"
		)
			return yield* new SoundboardConfigInvalid();
		if (intent === "previous" || intent === "next") {
			if (active?.state !== "playing" || parsed.entries.length < 2) return true;
		}
		if (intent === "stop") {
			if (active) yield* service.stop(active.playbackId);
		} else if (intent === "toggle" && active?.state === "playing")
			yield* service.pause(active.playbackId);
		else if (intent === "toggle" && active?.state === "paused")
			yield* service.resume(active.playbackId);
		else {
			const saved = yield* resume.read(identity);
			if (
				intent === "toggle" &&
				(!active || active.state === "stopped") &&
				saved?.fingerprint === fingerprint
			)
				yield* service.restore(owner, playlist, saved.index, saved.positionMs);
			else yield* service.execute(owner, playlist, parsed.operation);
		}
		const latest = (yield* service.snapshot())
			.filter(
				(s) =>
					s.owner.profileId === owner.profileId &&
					s.owner.keyCode === owner.keyCode &&
					s.playlistRevision === activation.revision,
			)
			.at(-1);
		if (latest && (latest.state === "playing" || latest.state === "paused"))
			yield* resume.save(identity, {
				fingerprint,
				index: latest.trackIndex,
				positionMs: latest.positionMs,
			});

		return true;
	});
	const reset = Effect.fn("SoundboardKeys.reset")(function* (
		deviceId?: string,
	) {
		for (const [owner, identity] of owners)
			if (!deviceId || deviceId === identity.deviceId) {
				yield* service.stopProfile(owner);
				owners.delete(owner);
			}
	});
	const read = Effect.fn("SoundboardKeys.read")(function* (
		key: ProfileKey,
		activation: KeyActivation,
	): Effect.fn.Return<LocalPlayerSnapshot> {
		const profileId = createHash("sha256")
			.update(JSON.stringify([activation.deviceId, activation.profileId]))
			.digest("hex");
		const keyCode = createHash("sha256")
			.update(JSON.stringify([activation.pageId, key.keyCode]))
			.digest("hex");
		const parsed = importSoundConfig({
			type: key.config.type,
			actions: key.config.actions.filter((a) => a.type !== "musicSource"),
		});
		const empty: LocalPlayerSnapshot = {
			revision: ++revision,
			state: "unconfigured",
			title: "",
			trackIndex: 0,
			total: 0,
			positionMs: 0,
			errorCode: null,
		};
		if (
			parsed._tag === "Left" ||
			parsed.right.issues.some((i) => i !== "unverifiedFiles")
		)
			return empty;
		const playlist = parsed.right;
		const active = (yield* service.snapshot())
			.filter(
				(s) =>
					s.owner.profileId === profileId &&
					s.owner.keyCode === keyCode &&
					s.playlistRevision === activation.revision,
			)
			.at(-1);
		const fingerprint = JSON.stringify([
			playlist.entries.map((e) => e.path),
			playlist.volume,
			playlist.fade,
		]);
		const identity = JSON.stringify({ profileId, keyCode });
		const resumable =
			active?.state === "playing" || active?.state === "paused"
				? active
				: undefined;
		if (resumable)
			yield* resume
				.save(identity, {
					fingerprint,
					index: resumable.trackIndex,
					positionMs: resumable.positionMs,
				})
				.pipe(
					Effect.catchTag("SoundboardConfigInvalid", (error) =>
						Effect.logWarning(error),
					),
				);
		const saved = yield* resume
			.read(identity)
			.pipe(
				Effect.catchTag("SoundboardConfigInvalid", () =>
					Effect.succeed(undefined),
				),
			);
		const index =
			resumable?.trackIndex ??
			(saved?.fingerprint === fingerprint ? saved.index : 0);
		const entry = playlist.entries[index];
		return {
			...empty,
			state: active?.state ?? "ready",
			title: entry?.path.split(/[\\/]/).at(-1) ?? "",
			trackIndex: index,
			total: playlist.entries.length,
			positionMs:
				resumable?.positionMs ??
				(saved?.fingerprint === fingerprint ? saved.positionMs : 0),
			errorCode: active?.errorCode ?? null,
		};
	});
	return { execute, reset, read, snapshot: service.snapshot };
}
