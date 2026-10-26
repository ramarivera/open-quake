import { Option } from "effect";
import type { Profile, ProfileEnvelope, ProfilePage } from "./profiles";

export interface StripSelection {
	readonly profile: Profile;
	readonly page: ProfilePage;
}

/**
 * The device's visible saved selection, else the first visible profile's first page
 * (profiles-key-grid "Invalid active reference"). Until device discovery
 * supplies a serial, callers pass the wallpaper session's serial.
 */
export function selectStripPage(
	envelope: ProfileEnvelope,
	serial: string | undefined,
): StripSelection {
	const hidden = Option.isSome(envelope.manager)
		? envelope.manager.value.hidden
		: [];
	const visible = envelope.profiles.filter(
		(profile) => !hidden.includes(profile.id),
	);
	// The manager keeps at least one built-in visible. Retain a safe fallback
	// for envelopes that predate or bypass that invariant.
	const first = visible[0] ?? envelope.profiles[0];
	const fallback = {
		profile: first,
		page: first.pages[0],
	};
	if (serial === undefined || !Object.hasOwn(envelope.activeByDevice, serial))
		return fallback;
	const selection = envelope.activeByDevice[serial];
	const profile = visible.find((entry) => entry.id === selection?.profileId);
	const page = profile?.pages.find((entry) => entry.id === selection?.pageId);
	return profile && page ? { profile, page } : fallback;
}

/** The first screen-ready menu selects Colorful Screen without changing preview defaults. */
export function initialStripProfile(envelope: ProfileEnvelope): Profile {
	const hidden = Option.isSome(envelope.manager)
		? envelope.manager.value.hidden
		: [];
	const visible = envelope.profiles.filter(
		(profile) => !hidden.includes(profile.id),
	);
	return (
		visible.find(
			(profile) =>
				profile.id === "1-4" ||
				profile.pages.some((page) =>
					page.keys.some((key) => key.config.type === "colorfulScreen"),
				),
		) ??
		visible[0] ??
		envelope.profiles[0]
	);
}
