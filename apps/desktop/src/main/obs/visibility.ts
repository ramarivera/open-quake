import { obsCommandFromKey } from "../../../../../packages/device/src/actions/obs-contracts";
import type { ProfileEnvelope } from "../../../../../packages/device/src/profiles/profile-contracts";
import type { ObsVisible } from "../../../../../packages/edge/src/obs/obs-contracts";

export function visibleObsKeys(
	envelope: ProfileEnvelope,
	deviceId: string,
): readonly ObsVisible[] {
	const selected = envelope.activeByDevice[deviceId];
	if (!selected) return [];
	return (
		envelope.profiles
			.find((profile) => profile.id === selected.profileId)
			?.pages.find((page) => page.id === selected.pageId)
			?.keys.flatMap((key) => {
				if (!key.config.display) return [];
				const command = obsCommandFromKey(key);
				return command._tag === "Right"
					? [{ id: key.keyCode, command: command.right }]
					: [];
			}) ?? []
	);
}
