import type { FocusKey, KnobModelSnapshot, MenuProfile } from "./contracts.js";

export const wrapIndex = (index: number, length: number): number =>
	length === 0 ? 0 : ((index % length) + length) % length;
export const volumeStep = (level: number, delta: -1 | 1): number =>
	Math.max(0, Math.min(100, Math.round(level) + delta));
export const readyProfiles = (
	profiles: readonly MenuProfile[],
): readonly MenuProfile[] =>
	profiles.filter((p) => p.thumbnail._tag === "ready");
export const selectorProfiles = (
	state: KnobModelSnapshot,
): readonly MenuProfile[] =>
	state.selector.mode === "picker"
		? readyProfiles(state.context.profiles)
		: state.context.profiles;
export const canFocus = (key: FocusKey): boolean =>
	key.visible && key.supportKnob;
