import { Option } from "effect";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { createEmptyProfileKey } from "../../../../../packages/device/src/profiles/profile-contracts";
import { emptyEmojiStore } from "../../../../../packages/edge/src/emoji/emoji-contracts";
import { applyEmojiCommand } from "../../../../../packages/edge/src/emoji/emoji-invariants";
import type { ShortcutLibrary } from "../../../../../packages/edge/src/shortcuts/shortcut-contracts";
import { AppLocaleProvider } from "../../renderer/src/i18n";
import { EmojiPage } from "../../renderer/src/management/emoji/EmojiPage";
import { EmojiTile } from "../../renderer/src/management/emoji/EmojiTile";
import { ShortcutsPage } from "../../renderer/src/management/integrations/ShortcutsPage";
import { stripLayout } from "../../renderer/src/strip/geometry";
import { previewVoiceContext } from "../../renderer/src/strip/overlays/voice/voice-context";
import { themes, toThemeProperties } from "../../renderer/src/theme/tokens";
import type { EmojiReply, EmojiRequest } from "../../shared/emoji";
import { encodeGif } from "../../shared/gif";
import type { IntegrationRequest } from "../../shared/integrations";
import type { LocaleSnapshot } from "../../shared/locale";
import "../../renderer/src/styles.css";
import "../../renderer/src/management/management.css";
import "../../renderer/src/strip/strip.css";

const hash = "a".repeat(64);
const original = "b".repeat(64);
const rendered = "c".repeat(64);
const pixels = (color: number) => {
	const data = new Uint8ClampedArray(80 * 80 * 4);
	for (let y = 0; y < 80; y++)
		for (let x = 0; x < 80; x++) {
			const offset = (y * 80 + x) * 4;
			const face = (x - 40) ** 2 + (y - 40) ** 2 < 36 ** 2;
			const eye =
				y > 24 && y < 33 && (Math.abs(x - 27) < 4 || Math.abs(x - 53) < 4);
			const mouth = y > 48 && y < 54 && x > 25 && x < 55;
			data.set(
				face
					? eye || mouth
						? [25, 25, 25, 255]
						: [255, color, 35, 255]
					: [0, 0, 0, 0],
				offset,
			);
		}
	return data;
};
const gif = encodeGif({
	width: 80,
	height: 80,
	loopCount: 0,
	frames: [
		{ rgba: pixels(210), delayMs: 100 },
		{ rgba: pixels(160), delayMs: 100 },
	],
});
const base64 = btoa(
	Array.from(gif, (value) => String.fromCharCode(value)).join(""),
);
const gifUrl = `data:image/gif;base64,${base64}`;
const canvas = document.createElement("canvas");
canvas.width = 80;
canvas.height = 80;
canvas.getContext("2d")?.putImageData(new ImageData(pixels(210), 80, 80), 0, 0);
const png = canvas.toDataURL();
let store: typeof emptyEmojiStore = {
	...emptyEmojiStore,
	staticAssets: Array.from({ length: 16 }, (_, index) => ({
		hash: index === 0 ? hash : index.toString(16).padStart(64, "0"),
		name: index === 0 ? "Smile.png" : `Template ${index + 1}.png`,
		format: "image/png" as const,
	})),
	items: [],
	drafts: [],
	packages: [],
};
let libraries: readonly ShortcutLibrary[] = [];
let failSave = false;
let assetMissing = false;
let confirmAnswer = false;
const confirmations: string[] = [];
window.confirm = (message) => {
	confirmations.push(message ?? "");
	return confirmAnswer;
};
const emojiRequests: EmojiRequest[] = [];
const integrationRequests: IntegrationRequest[] = [];
let snapshot: LocaleSnapshot = { locale: "en", revision: 0 };
const subscribers = new Set<(value: LocaleSnapshot) => void>();
const ready = (notice = ""): Extract<EmojiReply, { _tag: "ready" }> => ({
	_tag: "ready",
	store,
	assets: {},
	apps: [],
	notice,
});
Object.defineProperty(window, "quakeLocale", {
	value: {
		read: async () => snapshot,
		set: async (locale: "en" | "de") => {
			snapshot = { locale, revision: snapshot.revision + 1 };
			for (const fn of subscribers) fn(snapshot);
			return snapshot;
		},
		subscribe: (fn: (value: LocaleSnapshot) => void) => {
			subscribers.add(fn);
			return () => subscribers.delete(fn);
		},
		dispose: async () => {},
	},
});
Object.defineProperty(window, "quakeEmoji", {
	value: {
		request: async (request: EmojiRequest): Promise<EmojiReply> => {
			emojiRequests.push(request);
			if (request.type === "read") return ready();
			if (request.type === "asset")
				return {
					...ready(),
					assets: assetMissing
						? {}
						: { [request.hash]: request.hash === hash ? png : gifUrl },
				};
			if (request.type === "generate")
				return {
					_tag: "generated",
					base64,
					name: request.name || "Smile",
					caption: request.caption || {
						text: "",
						size: 48,
						color: "0xffffffff",
						position: "bot",
					},
				};
			if (request.type === "suggest-caption")
				return {
					_tag: "caption-suggestion",
					text: snapshot.locale === "de" ? "Na klar!" : "Let's go!",
				};
			if (request.type === "create-result") {
				const id = crypto.randomUUID();
				store = {
					...store,
					revision: store.revision + 1,
					items: [
						...store.items,
						{
							id,
							name: request.name,
							original,
							rendered,
							caption: request.caption || {
								text: "",
								size: 48,
								color: "0xffffffff",
								position: "bot",
							},
						},
					],
					drafts: [id, ...store.drafts],
				};
				return ready("Generated. Select to add to the pack.");
			}
			if (request.type === "caption") {
				store = {
					...store,
					revision: store.revision + 1,
					items: store.items.map((item) =>
						item.id === request.id
							? {
									...item,
									caption: request.caption,
									name: request.name ?? item.name,
									mode: request.mode ?? item.mode,
								}
							: item,
					),
				};
				return ready("Caption saved.");
			}
			if (request.type === "command") {
				store = applyEmojiCommand(store, request.command);
				return ready();
			}
			return ready();
		},
	},
});
Object.defineProperty(window, "quakeKeyLibrary", {
	value: {
		request: async () => ({
			_tag: "success",
			packs: [
				{
					id: "installed",
					name: "Installed",
					icons: [{ id: "figma", name: "Figma", data: png }],
				},
			],
		}),
	},
});
Object.defineProperty(window, "quakeIntegrations", {
	value: {
		request: async (request: IntegrationRequest) => {
			integrationRequests.push(request);
			if (request.type === "shortcuts.generate")
				return {
					type: "draft",
					title: "Design",
					dropped: 0,
					rows: ["a", "b", "c", "d"].map((key, index) => ({
						id: key,
						name: `Action ${index + 1}`,
						app: index === 3 ? "Unknown app" : "Figma",
						chord: `control+${key}`,
					})),
				};
			if (request.type === "shortcuts.save") {
				if (failSave) throw Error("Synthetic disk failure");
				const library = {
					...request.library,
					id: request.library.id || "draft",
					createdAt: "2026-10-26",
					name: request.library.name.trim(),
				};
				libraries = [
					...libraries.filter((item) => item.id !== library.id),
					library,
				];
			}
			if (request.type === "shortcuts.remove")
				libraries = libraries.filter((item) => item.id !== request.id);
			return { type: "libraries", libraries, aiAvailable: true };
		},
	},
});
const element = document.getElementById("root");
if (!element) throw Error("Missing root");
const root = createRoot(element);
function show(page: "emoji" | "shortcuts" | "tile", tileHash = rendered) {
	if (page === "tile") {
		const empty = createEmptyProfileKey("1,1");
		const key: typeof empty = {
			...empty,
			config: {
				...empty.config,
				type: "emoji",
				icon: tileHash === "inline" ? gifUrl : `emoji:${tileHash}`,
				title: {
					...empty.config.title,
					text: "Smile",
					display: true,
					userModifiedStyle: true,
					color: "#ff0000",
					pos: "top",
					style: "bold|italic|underline",
				},
			},
		};
		const layout = stripLayout(
			{ name: "Emoji", compatibility: Option.none() },
			{ keys: [key] },
		);
		const first = layout.tiles[0];
		if (!first) throw Error("No tile");
		const tile = { ...first, box: { x: 0, y: 0, width: 240, height: 160 } };
		root.render(
			createElement(
				"div",
				{ style: { position: "relative", width: 240, height: 160 } },
				createElement(EmojiTile, {
					tile,
					context: {
						now: undefined,
						hourFormat: "24h",
						voice: previewVoiceContext,
					},
				}),
			),
		);
	} else
		root.render(
			createElement(
				AppLocaleProvider,
				null,
				createElement(page === "emoji" ? EmojiPage : ShortcutsPage),
			),
		);
}
Object.defineProperty(window, "laneTest", {
	value: {
		show,
		emojiRequests,
		integrationRequests,
		store: () => store,
		libraries: () => libraries,
		confirm: (value: boolean) => {
			confirmAnswer = value;
		},
		confirmations,
		failSave: (value: boolean) => {
			failSave = value;
		},
		missing: (value: boolean) => {
			assetMissing = value;
		},
	},
});
for (const [name, value] of Object.entries(toThemeProperties(themes.grey)))
	document.documentElement.style.setProperty(name, value);
document.body.style.padding = "24px";
show("emoji");
