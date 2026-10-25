import { Effect, Option } from "effect";
import type { KnobError } from "../../../../../packages/device/src/knob/knob-errors.js";
import type { MenuProfile } from "../../../../../packages/device/src/knob/model/contracts.js";
import { translateProfile } from "../../../../../packages/device/src/profiles/profile-catalog.js";
import type { Profile } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import type { ProfileLocale } from "../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import { profileThumbnailKey } from "../profiles/profile-thumbnail-key";
import { createProfileThumbnailStore } from "../profiles/profile-thumbnails";
import type { DesktopKnobBindings } from "./desktop-adapters";
import { knobBoundaryFailure } from "./profile-binding";

export function knobThumbnailReader(
	root: string,
	bindings: DesktopKnobBindings,
) {
	const thumbnails = createProfileThumbnailStore(root);
	return Effect.fn("DesktopKnob.thumbnail")(function* (
		menu: MenuProfile,
		source: Profile,
		locale: ProfileLocale,
	): Effect.fn.Return<MenuProfile, KnobError> {
		const profile = translateProfile(source, locale);
		const data = yield* Effect.tryPromise({
			try: async (signal) => {
				const cached = await thumbnails.read(profile, locale);
				if (Option.isSome(cached)) return cached.value;
				await bindings.thumbnail?.(menu.id, locale, signal);
				return Option.getOrUndefined(await thumbnails.read(profile, locale));
			},
			catch: knobBoundaryFailure,
		});
		return {
			...menu,
			thumbnail: data ? { _tag: "ready", dataUrl: data } : { _tag: "missing" },
		};
	});
}

export const sameThumbnail = (
	left: Profile | undefined,
	right: Profile | undefined,
	locale: ProfileLocale,
): boolean =>
	left !== undefined &&
	right !== undefined &&
	profileThumbnailKey(translateProfile(left, locale), locale) ===
		profileThumbnailKey(translateProfile(right, locale), locale);
