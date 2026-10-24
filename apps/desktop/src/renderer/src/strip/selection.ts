import type {
	Profile,
	ProfileEnvelope,
	ProfilePage,
} from "../../../shared/profiles";

export interface StripSelection {
	readonly profile: Profile;
	readonly page: ProfilePage;
}

/**
 * The device's saved selection, else the first profile's first page
 * (profiles-key-grid "Invalid active reference"). Until device discovery
 * supplies a serial, callers pass the wallpaper session's serial.
 */
export function selectStripPage(
	envelope: ProfileEnvelope,
	serial: string | undefined,
): StripSelection {
	const fallback = {
		profile: envelope.profiles[0],
		page: envelope.profiles[0].pages[0],
	};
	if (serial === undefined || !Object.hasOwn(envelope.activeByDevice, serial))
		return fallback;
	const selection = envelope.activeByDevice[serial];
	const profile = envelope.profiles.find(
		(entry) => entry.id === selection?.profileId,
	);
	const page = profile?.pages.find((entry) => entry.id === selection?.pageId);
	return profile && page ? { profile, page } : fallback;
}
