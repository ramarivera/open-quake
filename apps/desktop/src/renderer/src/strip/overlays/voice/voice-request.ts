import { Effect, Either, Schema } from "effect";
import {
	VoiceSurfaceReply as ReplySchema,
	type VoiceBridge,
	type VoiceSurfaceReply,
	type VoiceSurfaceRequest,
	VoiceSurfaceRequestFailed,
} from "../../../../../shared/voice-surface";

const decodeReply = Schema.decodeUnknownEither(ReplySchema);

/** The renderer boundary always settles with a decoded reply, including IPC failure. */
export const requestVoiceSurface = Effect.fn("VoiceSurface.request")(function* (
	bridge: VoiceBridge | undefined,
	request: VoiceSurfaceRequest,
): Effect.fn.Return<VoiceSurfaceReply> {
	if (!bridge)
		return { _tag: "rejected", code: "VOICE.SURFACE.BRIDGE_MISSING" };
	return yield* Effect.tryPromise({
		try: () => bridge.request(request),
		catch: (cause) => new VoiceSurfaceRequestFailed(cause),
	}).pipe(
		Effect.map((raw): VoiceSurfaceReply => {
			const reply = decodeReply(raw);
			return Either.isRight(reply)
				? reply.right
				: { _tag: "rejected", code: "VOICE.SURFACE.REQUEST_INVALID" };
		}),
		Effect.catchTag("VoiceSurfaceRequestFailed", (error) =>
			Effect.succeed<VoiceSurfaceReply>({ _tag: "rejected", code: error.code }),
		),
	);
});
