import { Option } from "effect";
import {
	initialStripProfile,
	type Profile,
	type ProfileEnvelope,
	type ProfilePage,
} from "./profiles";

export { initialStripProfile } from "./profiles";

export interface StripSelection {
	readonly profile: Profile;
	readonly page: ProfilePage;
}

/**
 * The device's visible saved selection, else its colorful initial profile.
 * Desktop preview without a serial and invalid saved references use the first visible page
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
	const first =
		serial !== undefined && !Object.hasOwn(envelope.activeByDevice, serial)
			? initialStripProfile(envelope)
			: (visible[0] ?? envelope.profiles[0]);
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

/** Emoji folder screens are temporary; reconnect restores the committed page. */
export function isTransientStripPage(
	profile: Profile,
	pageId?: string,
): boolean {
	const page =
		profile.pages.find((page) => page.id === pageId) ?? profile.pages[0];
	return page.keys.some((key) => key.config.type === "emojiBack");
}
