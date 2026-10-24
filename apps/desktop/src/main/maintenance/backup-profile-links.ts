import { Option } from "effect";
import type { ProfileEnvelope } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { managerState } from "../../../../../packages/device/src/profiles/profile-manager-invariants.js";
import { normalizeAppPath } from "../../../../../packages/device/src/profiles/profile-switching-invariants.js";

/** Only persistent same-platform associations cross the backup boundary. Destination choices win. */
export function mergeProfileLinks(
	destination: ProfileEnvelope,
	source: ProfileEnvelope,
	ids: ReadonlyMap<string, string>,
	sourcePlatform: string,
): ProfileEnvelope["manager"] {
	if (sourcePlatform !== process.platform) return destination.manager;
	const state = managerState(destination);
	const links = [...state.links];
	for (const link of managerState(source).links) {
		const profileId = ids.get(link.profileId);
		if (
			!profileId ||
			links.some(
				(current) =>
					current.profileId === profileId ||
					(normalizeAppPath(current.appPath) ===
						normalizeAppPath(link.appPath) &&
						(Option.isNone(current.device) ||
							Option.isNone(link.device) ||
							current.device.value === link.device.value)),
			)
		)
			continue;
		links.push({ ...link, profileId });
	}
	return links.length === state.links.length
		? destination.manager
		: Option.some({ ...state, links, revision: state.revision + 1 });
}
