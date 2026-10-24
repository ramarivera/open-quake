import { Schema } from "effect";
import { ProfileLocale } from "../../../../../../packages/device/src/profiles/profile-manager-contracts.js";

export const KEY_LOCALE_STORAGE = "open-quake-key-locale";
/** Editor and live strip share one validated preference across management remounts. */
export function storedKeyLocale(): ProfileLocale {
	if (typeof localStorage === "undefined") return "en";
	const decoded = Schema.decodeUnknownEither(ProfileLocale)(
		localStorage.getItem(KEY_LOCALE_STORAGE) ?? "en",
	);
	return decoded._tag === "Right" ? decoded.right : "en";
}
