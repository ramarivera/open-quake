import { createHash } from "node:crypto";
import { Schema } from "effect";
import { Profile } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import type { ProfileLocale } from "../../../../../packages/device/src/profiles/profile-manager-contracts.js";
/** Include content so recovered-catalog updates and edits cannot reuse stale captures. */
export const profileThumbnailKey = (
	profile: Profile,
	locale: ProfileLocale,
): string =>
	createHash("sha256")
		.update(
			JSON.stringify([
				"emoji-assets-v2",
				locale,
				Schema.encodeSync(Profile)(profile),
			]),
		)
		.digest("hex");
