import { Effect, Array as EffectArray, Option } from "effect";
import type { ProfileEnvelope } from "./profile-contracts.js";
import {
	ProfileNotFound,
	type ProfileRepositoryError,
	ProfileRevisionConflict,
	ProfileValidationFailed,
} from "./profile-errors.js";

export interface PageEdit {
	readonly type: "add-page" | "delete-page";
	readonly profileId: string;
	readonly pageId: string;
	readonly revision: number;
	readonly deviceId: string;
}

/** One revision repairs all selections that referenced a deleted page. */
export const editProfilePages = Effect.fn("ProfileService.editPages")(
	function* (
		envelope: ProfileEnvelope,
		request: PageEdit,
	): Effect.fn.Return<ProfileEnvelope, ProfileRepositoryError> {
		const profile = envelope.profiles.find((p) => p.id === request.profileId);
		if (!profile) return yield* ProfileNotFound.fromCause(undefined);
		if (profile.revision !== request.revision)
			return yield* ProfileRevisionConflict.forRevisions(
				request.revision,
				profile.revision,
			);
		const index = profile.pages.findIndex((p) => p.id === request.pageId);
		if (
			(request.type === "add-page" && index >= 0) ||
			(request.type === "delete-page" &&
				(index < 0 || profile.pages.length === 1))
		)
			return yield* ProfileValidationFailed.fromCause(undefined);
		const first = profile.pages[0];
		const rest = profile.pages.slice(1);
		// Keep the nonempty tuple visible to TypeScript, including deletion of index zero.
		const pages =
			request.type === "add-page"
				? [
						first,
						...rest,
						{ id: request.pageId, keys: [], compatibility: Option.none() },
					]
				: profile.pages.filter((p) => p.id !== request.pageId);
		const nextFirst = pages[0];
		if (!nextFirst) return yield* ProfileValidationFailed.fromCause(undefined);
		const nextPages = [nextFirst, ...pages.slice(1)] as const;
		const fallback =
			nextPages[Math.min(Math.max(index, 0), nextPages.length - 1)] ??
			nextFirst;
		return {
			...envelope,
			profiles: EffectArray.map(envelope.profiles, (p) =>
				p.id === profile.id
					? { ...p, pages: nextPages, revision: p.revision + 1 }
					: p,
			),
			activeByDevice: {
				...Object.fromEntries(
					Object.entries(envelope.activeByDevice).map(([serial, selection]) => [
						serial,
						request.type === "delete-page" &&
						selection.profileId === profile.id &&
						selection.pageId === request.pageId
							? { ...selection, pageId: fallback.id }
							: selection,
					]),
				),
				...(request.type === "add-page"
					? {
							[request.deviceId]: {
								profileId: profile.id,
								pageId: request.pageId,
							},
						}
					: {}),
			},
		};
	},
);
