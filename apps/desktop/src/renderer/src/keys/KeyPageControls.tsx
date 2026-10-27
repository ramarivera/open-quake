import { useState } from "react";
import { pageIndex } from "../../../../../../packages/device/src/profiles/key-editing-invariants.js";
import type { Profile } from "../../../../../../packages/device/src/profiles/profile-contracts.js";
import type { ProfileLocale } from "../../../../../../packages/device/src/profiles/profile-manager-contracts.js";
import { PROFILE_PAGE_LIMIT } from "../../../../../../packages/device/src/profiles/profile-pages.js";
import { Row } from "../ui/Form";

export function KeyPageControls({
	profile,
	pageId,
	locale,
	select,
	edit,
}: {
	readonly profile: Profile;
	readonly pageId: string;
	readonly locale: ProfileLocale;
	readonly select: (id: string) => void;
	readonly edit: (type: "add-page" | "delete-page", id: string) => void;
}): React.JSX.Element {
	const [deleting, setDeleting] = useState(false);
	const [number, setNumber] = useState("1");
	const de = locale === "de";
	const navigate = (delta: number) => {
		const next =
			profile.pages[
				pageIndex(
					profile.pages.findIndex((p) => p.id === pageId),
					profile.pages.length,
					delta,
				)
			];
		if (next) select(next.id);
	};
	return (
		<Row label={de ? "Seiten verwalten" : "Manage pages"}>
			<button
				type="button"
				id="keys-previous-page"
				onClick={() => navigate(-1)}
			>
				{de ? "Vorherige" : "Previous"}
			</button>
			<button type="button" id="keys-next-page" onClick={() => navigate(1)}>
				{de ? "Nächste" : "Next"}
			</button>
			<input
				id="keys-page-number"
				aria-label={de ? "Gehe zu Seite" : "Go to page"}
				type="number"
				value={number}
				onChange={(e) => setNumber(e.target.value)}
			/>
			<button
				type="button"
				id="keys-go-page"
				disabled={!Number.isInteger(Number(number)) || number === ""}
				onClick={() => {
					const next =
						profile.pages[
							Math.max(
								0,
								Math.min(profile.pages.length - 1, Number(number) - 1),
							)
						];
					if (next) select(next.id);
				}}
			>
				{de ? "Gehe zu" : "Go"}
			</button>
			<button
				type="button"
				id="keys-add-page"
				disabled={profile.pages.length >= PROFILE_PAGE_LIMIT}
				onClick={() => edit("add-page", crypto.randomUUID())}
			>
				{de ? "Seite hinzufügen" : "Add page"}
			</button>
			<button
				type="button"
				id="keys-delete-page"
				disabled={profile.pages.length === 1}
				onClick={() => setDeleting(true)}
			>
				{de ? "Seite löschen" : "Delete page"}
			</button>
			{deleting && (
				<div
					role="alertdialog"
					aria-label={de ? "Seite löschen" : "Delete page"}
				>
					<p>
						{de
							? "Möchten Sie die aktuelle Seitenkonfiguration wirklich löschen?"
							: "Are you sure you want to delete the current page configuration?"}
					</p>
					<button
						type="button"
						id="keys-confirm-delete-page"
						onClick={() => {
							setDeleting(false);
							edit("delete-page", pageId);
						}}
					>
						{de ? "Löschen bestätigen" : "Confirm delete"}
					</button>
					<button type="button" onClick={() => setDeleting(false)}>
						{de ? "Abbrechen" : "Cancel"}
					</button>
				</div>
			)}
		</Row>
	);
}
