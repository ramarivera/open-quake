import type { ProfileEnvelope } from "../../../../../../packages/device/src/profiles/profile-contracts.js";
import type { ProfileLocale } from "../../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import { visibleProfiles } from "../../../../../../packages/device/src/profiles/profile-manager-invariants.js";
import type {
	ProfileBridge,
	ProfileForegroundGuidance,
	ProfileView,
	ThumbnailProgress,
} from "../../../shared/profile-manager";

export const selectedManagerProfile = (envelope: ProfileEnvelope) => {
	const visible = visibleProfiles(envelope);
	return (
		visible.find(
			(p) => p.id === envelope.activeByDevice["desktop-preview"]?.profileId,
		) ?? visible[0]
	);
};

/** Own the locale read and subscriptions for exactly one mounted effect. */
export const subscribeManagerView = (
	bridge: ProfileBridge,
	locale: ProfileLocale,
	view: (view: ProfileView) => void,
	progress: (progress: ThumbnailProgress) => void,
	status: (reason: string) => void,
	guidance?: (value: ProfileForegroundGuidance) => void,
): (() => void) => {
	let active = true;
	const off = bridge.onSnapshot(view);
	const offProgress = bridge.onProgress(progress);
	const offGuidance = guidance
		? bridge.onForegroundGuidance?.((value) => {
				if (active) guidance(value);
			})
		: undefined;
	void bridge.request({ type: "read", locale }).then((reply) => {
		if (!active) return;
		if (reply._tag === "success") view(reply.view);
		else status(reply.reason);
	});
	return () => {
		active = false;
		off();
		offProgress();
		offGuidance?.();
	};
};
