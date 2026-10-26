import { Effect, Layer } from "effect";
import type { KeyActivation } from "../../../../../packages/device/src/actions/key-runtime-service";
import type { ProfileKey } from "../../../../../packages/device/src/profiles/profile-contracts";
import { AiConfigInvalid } from "../../../../../packages/edge/src/ai/ai-errors";
import type { AudioOutputLease } from "../../../../../packages/edge/src/audio/output-service";
import {
	GridVoiceRuntime,
	type VoiceSurface,
} from "../../../../../packages/edge/src/voice/surface";
import type {
	VoiceSurfaceEvent,
	VoiceSurfaceReply,
} from "../../shared/voice-surface";
import type { createAgentHttpVoiceAdapter } from "../agent-http/voice-adapter";
import { createDesktopSpeech, type DesktopSpeechOptions } from "./factory";
import type { SpeechSettingsController } from "./settings";

type HttpVoice = Effect.Effect.Success<
	ReturnType<typeof createAgentHttpVoiceAdapter>
>;
type Speech = Effect.Effect.Success<ReturnType<typeof createDesktopSpeech>>;

/** Owns the circular callbacks at the application boundary. The HTTP decorator
 * receives speech capture, while speech sends only finalized transcripts into
 * the HTTP consumer. Neither callback can reenter its own fallback.
 */
export function createSpeechVoiceBinding(options: {
	readonly speech: Omit<
		DesktopSpeechOptions,
		"sendText" | "sendTranscript" | "cancelText"
	>;
	readonly direct?: (
		fallback: typeof GridVoiceRuntime.Service,
	) => ReturnType<typeof createAgentHttpVoiceAdapter>;
	readonly http?: (
		fallback: typeof GridVoiceRuntime.Service,
		fallbackTranscript?: typeof GridVoiceRuntime.Service.sendText,
	) => ReturnType<typeof createAgentHttpVoiceAdapter>;
	readonly run: <A>(effect: Effect.Effect<A>) => Promise<A>;
}) {
	let speech: Speech | undefined;
	const unavailable = () => new AiConfigInvalid();
	const settings: SpeechSettingsController = {
		profiles: () =>
			Effect.suspend(() =>
				speech
					? speech.settings.profiles()
					: Effect.succeed({ speakAnswers: false }),
			),
		request: (input) =>
			Effect.suspend(() =>
				speech ? speech.settings.request(input) : Effect.fail(unavailable()),
			),
	};
	const decorate = (
		fallback: Layer.Layer<GridVoiceRuntime, never, VoiceSurface>,
	) =>
		Layer.scoped(
			GridVoiceRuntime,
			Effect.gen(function* () {
				const original = yield* GridVoiceRuntime;
				let http: HttpVoice | undefined;
				let direct: HttpVoice | undefined;
				const controller = yield* createDesktopSpeech({
					...options.speech,
					sendText: (request) =>
						direct
							? direct.runtime.sendText(request)
							: original.sendText(request),
					sendTranscript: (request) =>
						http
							? http.sendTranscript(request)
							: direct
								? direct.sendTranscript(request)
								: original.sendText(request),
					cancelText: (serial, keyCode) =>
						Effect.all([
							http ? http.cancelText(serial, keyCode) : Effect.void,
							direct ? direct.cancelText(serial, keyCode) : Effect.void,
						]).pipe(Effect.asVoid),
				});
				speech = controller;
				yield* Effect.addFinalizer(() =>
					Effect.sync(() => {
						speech = undefined;
					}),
				);
				if (options.direct)
					direct = yield* options.direct(controller?.runtime ?? original);
				if (options.http)
					http = yield* options.http(
						direct?.runtime ?? controller?.runtime ?? original,
						direct?.sendTranscript,
					);
				return (
					http?.runtime ?? direct?.runtime ?? controller?.runtime ?? original
				);
			}),
		).pipe(Layer.provide(fallback));
	return {
		decorate,
		acquireWallpaperSound: (
			mute: () => Promise<void>,
		): Promise<AudioOutputLease | undefined> =>
			speech
				? Effect.runPromise(
						speech.audioOutput.acquire("wallpaper", Effect.promise(mute)).pipe(
							Effect.catchTags({
								AudioOutputBusy: () => Effect.succeed(undefined),
								AudioOutputFailed: (error) =>
									Effect.logWarning(error).pipe(Effect.as(undefined)),
							}),
						),
					)
				: Promise.resolve(undefined),
		executeSoundKey: (
			key: ProfileKey,
			signal: AbortSignal,
			activation: KeyActivation,
		): Promise<boolean> =>
			speech
				? Effect.runPromise(speech.soundboardKeys.execute(key, activation), {
						signal,
					})
				: Promise.resolve(false),
		resetSoundKeys: (deviceId?: string): Promise<void> =>
			speech
				? Effect.runPromise(speech.soundboardKeys.reset(deviceId))
				: Promise.resolve(),
		settings,
		stopReadAloud: async (owner: {
			readonly serial: string;
			readonly keyCode: string;
		}): Promise<boolean> =>
			speech ? options.run(speech.stopReadAloud(owner)) : false,
		onEvent: (event: VoiceSurfaceEvent): void => {
			if (speech)
				void options.run(speech.observe(event)).catch(() => undefined);
		},
		readAloud: async (
			text: string,
			owner?: { readonly serial: string; readonly keyCode: string },
		): Promise<VoiceSurfaceReply> => {
			if (!speech) return { _tag: "rejected", code: "VOICE.TTS.UNAVAILABLE" };
			const outcome = await options.run(speech.readAloud(text, owner));
			return outcome._tag === "completed"
				? { _tag: "ok" }
				: {
						_tag: "rejected",
						code:
							outcome._tag === "textOnly"
								? outcome.error.code
								: "VOICE.TTS.CANCELLED",
					};
		},
	};
}
