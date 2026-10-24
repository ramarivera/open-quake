import type { EmojiCommand, EmojiStore } from "./emoji-contracts";
export function weightedLength(text: string): number {
	let n = 0;
	for (let i = 0; i < text.length; i++)
		n += /[\u4e00-\u9fa5]/.test(text.charAt(i)) ? 2 : 1;
	return n;
}
export function emojiCommandRejection(
	store: EmojiStore,
	command: EmojiCommand,
): string | null {
	if (command.type === "create-package" || command.type === "rename-package") {
		if (weightedLength(command.name.trim()) > 20)
			return "Package names must be at most 20 weighted units.";
		if (
			command.type === "create-package" &&
			store.packages.some((p) => p.id === command.id)
		)
			return "Package already exists.";
	}
	if (command.type === "add-drafts") {
		const pack = store.packages.find((p) => p.id === command.packageId);
		if (!pack) return "Package not found.";
		const ids = [...new Set(command.ids)].filter(
			(id) => !pack.emojiIds.includes(id),
		);
		if (pack.emojiIds.length + ids.length > 16)
			return "The package is full (16 emoji).";
		if (
			ids.some(
				(id) =>
					!store.drafts.includes(id) ||
					!store.items.some((item) => item.id === id),
			)
		)
			return "A selected draft no longer exists.";
	}
	return null;
}
export function applyEmojiCommand(
	store: EmojiStore,
	command: EmojiCommand,
): EmojiStore {
	const next = { ...store, revision: store.revision + 1 };
	switch (command.type) {
		case "delete-static":
			return {
				...next,
				staticAssets: store.staticAssets.filter(
					(asset) => asset.hash !== command.hash,
				),
			};
		case "create-package":
			return {
				...next,
				packages: [
					...store.packages,
					{
						id: command.id,
						name: command.name.trim() || "Unnamed Pack",
						emojiIds: [],
						profileId: null,
					},
				],
			};
		case "rename-package":
			return {
				...next,
				packages: store.packages.map((p) =>
					p.id === command.id
						? { ...p, name: command.name.trim() || "Unnamed Pack" }
						: p,
				),
			};
		case "delete-package":
			return {
				...next,
				packages: store.packages.filter((p) => p.id !== command.id),
			};
		case "add-drafts":
			return {
				...next,
				packages: store.packages.map((p) =>
					p.id === command.packageId
						? { ...p, emojiIds: [...new Set([...p.emojiIds, ...command.ids])] }
						: p,
				),
				drafts: store.drafts.filter((id) => !command.ids.includes(id)),
			};
		case "remove-emoji":
			return {
				...next,
				packages: store.packages.map((p) =>
					p.id === command.packageId
						? { ...p, emojiIds: p.emojiIds.filter((id) => id !== command.id) }
						: p,
				),
			};
		case "settings":
			return {
				...next,
				appMatch: command.appMatch,
				globalMode: command.globalMode,
				apps: command.apps.filter(
					(app, index, list) =>
						list.findIndex(
							(other) =>
								(app.identifier !== "" &&
									app.identifier === other.identifier) ||
								app.path.toLowerCase() === other.path.toLowerCase(),
						) === index,
				),
			};
	}
}
