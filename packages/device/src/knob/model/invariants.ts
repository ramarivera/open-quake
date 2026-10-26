import type { FocusKey, KnobModelSnapshot, MenuProfile } from "./contracts.js";

export const wrapIndex = (index: number, length: number): number =>
	length === 0 ? 0 : ((index % length) + length) % length;
export const volumeStep = (level: number, delta: -1 | 1): number =>
	Math.max(0, Math.min(100, Math.round(level) + delta));
export const readyProfiles = (
	profiles: readonly MenuProfile[],
): readonly MenuProfile[] =>
	profiles.filter((p) => p.thumbnail._tag === "ready");
/** Keep committed truth visible even while its thumbnail is unavailable. */
export const pickerProfiles = (
	profiles: readonly MenuProfile[],
	activeProfileId: string,
): readonly MenuProfile[] =>
	profiles.filter(
		(p) => p.thumbnail._tag === "ready" || p.id === activeProfileId,
	);
export const selectorProfiles = (
	state: KnobModelSnapshot,
): readonly MenuProfile[] =>
	state.selector.mode === "picker"
		? pickerProfiles(state.context.profiles, state.context.session.profileId)
		: state.context.profiles;
export const canFocus = (key: FocusKey): boolean =>
	key.visible && key.supportKnob;
