import { Option } from "effect";
import type { ProfileKey } from "./profile-contracts.js";
import { hasForcedSpan } from "./profile-footprint.js";

/** Only these variable-span functions own a composite layout or meeting workflow. */
const STRUCTURAL_TYPES = new Set([
	"colorfulScreen",
	"liveAudioTranslateDisplay",
	"meetingMinutes",
	"tempMeetingMinutes",
	"meetingRecordMark",
	"liveAudioTranslate",
]);
const UNDELETABLE_TYPES = new Set([
	"back",
	"emojiBack",
	"functionwheel",
	"colorfulScreenSettings",
]);
export const keyEditable = (
	key: ProfileKey,
	field: "title" | "icon" | "allowDelete" | "grid" | "allowDrag",
): boolean => {
	if (field === "title" || field === "icon" || field === "allowDrag")
		return true;
	const type = key.config.type;
	if (field === "allowDelete" && UNDELETABLE_TYPES.has(type)) return false;
	if (type === "colorfulScreen") return false;
	if (field === "grid" && hasForcedSpan(key.config)) return false;
	if (!STRUCTURAL_TYPES.has(type) && !hasForcedSpan(key.config)) return true;
	return Option.match(key.config.basicEditableItems, {
		onNone: () => true,
		onSome: (policy) => policy[field],
	});
};

/** An owner can move this tile, but another key cannot displace or replace it. */
export const keyStructurallyLocked = (key: ProfileKey): boolean =>
	!keyEditable(key, "grid") || !keyEditable(key, "allowDelete");
