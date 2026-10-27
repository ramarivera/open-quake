import { Effect, Either, Option, Schema } from "effect";
import { KnobVoiceActions } from "../../../../../packages/device/src/knob/knob-contracts.js";
import { committedKnob } from "../../../../../packages/device/src/knob/knob-profile.js";
import { directKnobRouteReferences } from "../../../../../packages/device/src/knob/knob-voice-migration.js";
import type { ProfileEnvelope } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { VoiceKnobRejected } from "../../../../../packages/edge/src/voice/surface/voice-surface-errors.js";
import type { KnobCaptureSnapshot } from "../../../../../packages/edge/src/voice/surface/voice-surface-ports.js";

export const pinKnobProfile = Effect.fn("DesktopKnob.pinProfile")(function* (
	envelope: ProfileEnvelope,
	serial: string,
): Effect.fn.Return<KnobCaptureSnapshot, VoiceKnobRejected> {
	const selection = envelope.activeByDevice[serial];
	const profile = envelope.profiles.find((p) => p.id === selection?.profileId);
	if (!profile) return yield* new VoiceKnobRejected("RouteIncomplete");
	const knob = committedKnob(profile);
	if (Option.isNone(knob))
		return yield* new VoiceKnobRejected("RouteIncomplete");
	const center = knob.value.config.subActions[0];
	if (center.config.type !== "assistant")
		return yield* new VoiceKnobRejected("RouteUnavailable");
	if (center.config.assistantSettings?.enableVoiceInput === false)
		return yield* new VoiceKnobRejected("RouteUnavailable");
	const actions = Schema.decodeUnknownEither(KnobVoiceActions, {
		onExcessProperty: "error",
	})(center.config.actions);
	if (Either.isLeft(actions))
		return yield* new VoiceKnobRejected("RouteIncomplete", actions.left);
	const route = actions.right.find((a) => a.type === "voiceRoute")?.value;
	if (route === "dkclaw") {
		const agentId =
			actions.right.find((a) => a.type === "agentId")?.value || "main";
		const modelId =
			actions.right.find((a) => a.type === "dkclawModel")?.value || "";
		return {
			profileId: profile.id,
			revision: profile.revision,
			route: "dkclaw",
			agentId,
			modelId,
			providerId: "",
		};
	}
	if (route !== "direct")
		return yield* new VoiceKnobRejected("RouteUnavailable");
	const refs = directKnobRouteReferences(actions.right);
	if (Option.isNone(refs))
		return yield* new VoiceKnobRejected("RouteIncomplete");
	return {
		...("assistantSettings" in center.config && center.config.assistantSettings
			? { assistantSettings: center.config.assistantSettings }
			: {}),
		profileId: profile.id,
		revision: profile.revision,
		route: "direct",
		...refs.value,
	};
});
