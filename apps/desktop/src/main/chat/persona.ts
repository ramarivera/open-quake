import { Effect, Schema } from "effect";
import {
	AssistantSettings,
	defaultAssistantSettings,
} from "../../../../../packages/device/src/profiles/assistant-contracts";
import { AiConfigInvalid } from "../../../../../packages/edge/src/ai/ai-errors";
import { fileStore } from "../integrations/storage";

/** Host-owned durable desktop persona. Updates cannot alter an admitted turn. */
export function desktopPersona(directory: string) {
	const storage = fileStore(directory, "persona-v1.json", null);
	const lock = Effect.runSync(Effect.makeSemaphore(1));
	const read = Effect.fn("DesktopChat.persona.read")(function* () {
		const raw = yield* Effect.tryPromise({
			try: storage.read,
			catch: (cause) => new AiConfigInvalid(cause),
		});
		if (raw === null) return undefined;
		return yield* Schema.decodeUnknown(AssistantSettings, {
			onExcessProperty: "error",
		})(raw).pipe(Effect.mapError((cause) => new AiConfigInvalid(cause)));
	});
	return {
		read: () =>
			read().pipe(
				Effect.map(
					(value) =>
						value ?? { ...defaultAssistantSettings(), useAgent: false },
				),
			),
		readSaved: read,
		update: (input: AssistantSettings) =>
			lock.withPermits(1)(
				Effect.gen(function* () {
					const value = yield* Schema.decodeUnknown(AssistantSettings, {
						onExcessProperty: "error",
					})(input).pipe(
						Effect.mapError((cause) => new AiConfigInvalid(cause)),
					);
					yield* Effect.tryPromise({
						try: () => storage.write(value),
						catch: (cause) => new AiConfigInvalid(cause),
					});
					return value;
				}),
			),
	};
}
