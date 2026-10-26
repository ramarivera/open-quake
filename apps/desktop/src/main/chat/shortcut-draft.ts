import { Effect, Stream } from "effect";
import type { ModelRow } from "../../../../../packages/edge/src/agents/agents-contracts";
import type { ProviderProfile } from "../../../../../packages/edge/src/ai/ai-contracts";
import {
	AiAuthRequired,
	AiConfigInvalid,
	type AiError,
	AiProtocolInvalid,
	AiUnavailable,
} from "../../../../../packages/edge/src/ai/ai-errors";
import { ChatInference } from "../../../../../packages/edge/src/chat/chat-ports";

const instruction = `Draft keyboard shortcuts for the application and task in the user message.
Return only JSON with this structure:
{"ConfigTitle":"Short descriptive title","ConfigData":[{"title":"Action name","config":{"functionType":"hotkey","actions":[{"type":"key","value":"control+shift+k"}]}}]}
Use at most 32 entries. Each entry must contain exactly one keyboard chord.
Use lowercase key tokens separated by +. Modifiers are control, shift, alt,
command or meta. Use the actual target application's shortcuts and omit anything
you don't know. Never include shell commands, scripts, application launches,
multi-actions or instructions to execute. The output is an editable draft only.`;

/** Stateless generation. The existing ShortcutService validates all returned data. */
export const shortcutDraft = Effect.fn("DesktopChat.draftShortcuts")(
	function* (
		request: string,
		models: (scope: string) => Effect.Effect<readonly ModelRow[], AiError>,
		convert: (row: ModelRow) => ProviderProfile,
	): Effect.fn.Return<string, AiError, ChatInference> {
		if (!request.trim() || request.length > 282)
			return yield* new AiConfigInvalid();
		const row = (yield* models("default")).find(
			(model) => model.role === "default",
		);
		if (!row?.model.trim()) return yield* new AiConfigInvalid();
		if (!row.credentialRef) return yield* new AiAuthRequired();
		const profile = yield* Effect.try({
			try: () => convert(row),
			catch: (cause) => new AiConfigInvalid(cause),
		});
		const inference = yield* ChatInference;
		const generation = yield* inference.open(profile, {
			profileId: profile.id,
			requestedCapabilities: ["text"],
			sampling: { maxOutputTokens: Math.min(row.maxTokens, 4096) },
			messages: [
				{ role: "system", content: [{ _tag: "text", text: instruction }] },
				{ role: "user", content: [{ _tag: "text", text: request }] },
			],
		});
		let text = "";
		let bytes = 0;
		yield* generation.events.pipe(
			Stream.runForEach((event) => {
				if (event._tag !== "textDelta") return Effect.void;
				bytes += Buffer.byteLength(event.textDelta, "utf8");
				if (bytes > 32768) return Effect.fail(new AiProtocolInvalid());
				text += event.textDelta;
				return Effect.void;
			}),
			Effect.ensuring(generation.cancel()),
		);
		if (!text.trim()) return yield* new AiProtocolInvalid();
		return text;
	},
	(effect) =>
		effect.pipe(
			Effect.timeoutFail({
				duration: "60 seconds",
				onTimeout: () => new AiUnavailable(),
			}),
		),
);
