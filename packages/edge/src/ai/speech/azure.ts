import { Deferred, Effect, type Stream } from "effect";
import { type AiError, AiProtocolInvalid } from "../ai-errors.js";
import { MAX_AUDIO_BYTES, verifiedAudio } from "./speech-audio.js";
import type { SttProfile, TtsProfile } from "./speech-contracts.js";
import { phase, sendFrames } from "./speech-session.js";
import type { Transcript } from "./speech-stt.js";

/** SDK stays inside the main-process facade. Explicit streams preclude device IO. */
export function recognizeAzure(
	profile: SttProfile,
	key: string,
	frames: Stream.Stream<Uint8Array, AiError>,
	onTranscript: (t: Transcript) => Effect.Effect<void>,
) {
	return Effect.scoped(
		Effect.gen(function* () {
			const sdk = yield* Effect.tryPromise({
				try: () => import("microsoft-cognitiveservices-speech-sdk"),
				catch: (cause) => new AiProtocolInvalid(cause),
			});
			const result = yield* Deferred.make<string, AiError>();
			const ready = yield* Deferred.make<void>();
			const config = yield* Effect.acquireRelease(
				Effect.try({
					try: () =>
						sdk.SpeechConfig.fromSubscription(
							key,
							profile.region ?? "eastasia",
						),
					catch: (c) => new AiProtocolInvalid(c),
				}),
				(c) => Effect.sync(() => c.close()),
			);
			config.speechRecognitionLanguage = profile.language ?? "en-US";
			const push = yield* Effect.acquireRelease(
				Effect.sync(() =>
					sdk.AudioInputStream.createPushStream(
						sdk.AudioStreamFormat.getWaveFormatPCM(24000, 16, 1),
					),
				),
				(s) => Effect.sync(() => s.close()),
			);
			const audio = yield* Effect.acquireRelease(
				Effect.sync(() => sdk.AudioConfig.fromStreamInput(push)),
				(a) => Effect.sync(() => a.close()),
			);
			const recognizer = yield* Effect.acquireRelease(
				Effect.try({
					try: () => new sdk.SpeechRecognizer(config, audio),
					catch: (c) => new AiProtocolInvalid(c),
				}),
				(r) => Effect.sync(() => r.close()),
			);
			let active = true;
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					active = false;
				}),
			);
			const recognize = Effect.async<string, AiError>((resume) => {
				recognizer.recognizeOnceAsync(
					(r) => {
						if (!active) return;
						if (
							r.reason === sdk.ResultReason.RecognizedSpeech ||
							r.reason === sdk.ResultReason.NoMatch
						)
							resume(Effect.succeed(r.text ?? ""));
						else resume(Effect.fail(new AiProtocolInvalid()));
					},
					(c) => resume(Effect.fail(new AiProtocolInvalid(c))),
				);
				Deferred.unsafeDone(ready, Effect.void);
			});
			yield* recognize.pipe(Effect.intoDeferred(result), Effect.forkScoped);
			const sender = Effect.gen(function* () {
				yield* phase(Deferred.await(ready), "configure");
				const count = yield* sendFrames(frames, (b) =>
					Effect.try({
						try: () => push.write(Uint8Array.from(b).buffer),
						catch: (c) => new AiProtocolInvalid(c),
					}),
				);
				if (!count) return "";
				push.close();
				return yield* phase(Deferred.await(result), "final");
			});
			const text = yield* Effect.raceFirst(sender, Deferred.await(result));
			if (text.length > 64000) return yield* new AiProtocolInvalid();
			yield* onTranscript({ text, final: true });
			return text;
		}),
	);
}
export function synthesizeAzure(
	profile: TtsProfile,
	key: string,
	text: string,
	onAudio: () => void,
) {
	return Effect.scoped(
		Effect.gen(function* () {
			const sdk = yield* Effect.tryPromise({
				try: () => import("microsoft-cognitiveservices-speech-sdk"),
				catch: (cause) => new AiProtocolInvalid(cause),
			});
			const config = yield* Effect.acquireRelease(
				Effect.try({
					try: () =>
						sdk.SpeechConfig.fromSubscription(
							key,
							profile.region ?? "eastasia",
						),
					catch: (c) => new AiProtocolInvalid(c),
				}),
				(c) => Effect.sync(() => c.close()),
			);
			config.speechSynthesisLanguage = profile.language;
			config.speechSynthesisVoiceName = profile.voice;
			config.speechSynthesisOutputFormat =
				sdk.SpeechSynthesisOutputFormat.Raw24Khz16BitMonoPcm;
			let active = true;
			const chunks: Uint8Array[] = [];
			let length = 0;
			let overflow = false;
			const push = yield* Effect.acquireRelease(
				Effect.sync(() =>
					sdk.PushAudioOutputStream.create({
						write: (buffer) => {
							if (!active) return;
							length += buffer.byteLength;
							if (length > MAX_AUDIO_BYTES) {
								overflow = true;
								return;
							}
							chunks.push(new Uint8Array(buffer).slice());
							if (buffer.byteLength) onAudio();
						},
						close: () => {},
					}),
				),
				(s) => Effect.sync(() => s.close()),
			);
			const audio = yield* Effect.acquireRelease(
				Effect.sync(() => sdk.AudioConfig.fromStreamOutput(push)),
				(a) => Effect.sync(() => a.close()),
			);
			const synthesizer = yield* Effect.acquireRelease(
				Effect.try({
					try: () => new sdk.SpeechSynthesizer(config, audio),
					catch: (c) => new AiProtocolInvalid(c),
				}),
				(s) => Effect.sync(() => s.close()),
			);
			yield* Effect.addFinalizer(() =>
				Effect.sync(() => {
					active = false;
				}),
			);
			yield* Effect.async<void, AiError>((resume) => {
				synthesizer.speakTextAsync(
					text,
					(r) =>
						resume(
							r.reason === sdk.ResultReason.SynthesizingAudioCompleted &&
								!overflow
								? Effect.void
								: Effect.fail(new AiProtocolInvalid()),
						),
					(c) => resume(Effect.fail(new AiProtocolInvalid(c))),
				);
			});
			const bytes = new Uint8Array(length);
			let offset = 0;
			for (const c of chunks) {
				bytes.set(c, offset);
				offset += c.length;
			}
			return yield* verifiedAudio(bytes, "pcm");
		}),
	);
}
