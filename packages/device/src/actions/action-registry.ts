import { Schema } from "effect";
import * as C from "./action-contracts.js";

const define = <A, const I extends string>(
	id: I,
	inputSchema: Schema.Schema<A>,
	options: {
		readonly submenu:
			| "shortcut"
			| "multiMedia"
			| "navigation"
			| "deviceControl"
			| "decoKeeAI"
			| "display";
		readonly requiredAdapter: string;
		readonly binding:
			| "website"
			| "hotkey"
			| "text"
			| "open"
			| "media"
			| "delegate"
			| "unresolved";
		readonly defaults: Readonly<Record<string, unknown>>;
		readonly aliases?: ReadonlyArray<string>;
		readonly supportKnob?: boolean;
		readonly supportTouchEffect?: boolean;
		readonly permission?: "read" | "write" | "sensitive";
	},
) =>
	({
		id,
		inputSchema,
		decode: Schema.decodeUnknownEither(inputSchema),
		legacyNames: [id],
		configTypeAliases: options.aliases ?? [],
		submenu: options.submenu,
		requiredAdapter: options.requiredAdapter,
		binding: options.binding,
		defaultConfig: { type: id, ...options.defaults },
		supportKnob: options.supportKnob ?? false,
		supportTouchEffect: options.supportTouchEffect ?? true,
		alternateState: false,
		editPolicy: {
			title: true,
			grid: true,
			icon: true,
			allowDelete: true,
			allowDrag: true,
		},
		permission:
			options.permission ??
			(options.binding === "hotkey" || options.binding === "text"
				? "sensitive"
				: "write"),
		autonomy: "never",
		release: options.binding === "unresolved" ? "unresolved" : "first-release",
		gate:
			options.binding === "unresolved"
				? "unresolved"
				: options.binding === "delegate"
					? "owning-runtime"
					: "host-adapter",
	}) as const;
const media = <const I extends string, const Command extends C.MediaCommand>(
	id: I,
	command: Command,
) => ({
	...define(id, C.mediaConfig(id, command), {
		submenu: "multiMedia",
		requiredAdapter: `host.media.${command}`,
		binding: "media",
		defaults: { actions: [{ type: "key", value: command }] },
	}),
	mediaCommand: command,
});

/** The editor, validator and conductor consume these same declarations. */
export const ACTION_REGISTRY = [
	define("website", C.WebsiteConfig, {
		submenu: "shortcut",
		requiredAdapter: "host.website",
		binding: "website",
		defaults: { actions: [{ type: "url", value: "" }] },
	}),
	define("hotkey", C.HotkeyConfig, {
		submenu: "shortcut",
		requiredAdapter: "host.keyboard",
		binding: "hotkey",
		supportKnob: true,
		defaults: { supportKnob: false, actions: [{ type: "key", value: "" }] },
	}),
	define("text", C.TextConfig, {
		submenu: "shortcut",
		requiredAdapter: "host.text",
		binding: "text",
		defaults: { actions: [{ type: "text", value: "" }] },
	}),
	define("open", C.OpenAppConfig, {
		submenu: "shortcut",
		requiredAdapter: "host.application",
		binding: "open",
		defaults: { actions: [{ type: "path", value: "" }] },
	}),
	media("playPause", "audio_play"),
	media("stopPlay", "audio_stop"),
	media("skipBackward", "audio_prev"),
	media("skipForward", "audio_next"),
	media("fastBackward", "audio_rewind"),
	media("fastForward", "audio_forward"),
	media("repeatPlay", "audio_repeat"),
	media("randomPlay", "audio_random"),
	define("goToPage", C.GoToPageConfig, {
		submenu: "navigation",
		requiredAdapter: "profiles.navigation",
		binding: "delegate",
		defaults: { actions: [{ type: "page", value: 1 }] },
	}),
	define("previousPage", C.PreviousPageConfig, {
		submenu: "navigation",
		requiredAdapter: "profiles.navigation",
		binding: "delegate",
		aliases: ["pageUp"],
		defaults: { actions: [] },
	}),
	define("nextPage", C.NextPageConfig, {
		submenu: "navigation",
		requiredAdapter: "profiles.navigation",
		binding: "delegate",
		aliases: ["pageDown"],
		defaults: { actions: [] },
	}),
	define("panelBrightness", C.PanelBrightnessConfig, {
		submenu: "deviceControl",
		requiredAdapter: "knob.panelBrightness",
		binding: "delegate",
		supportKnob: true,
		defaults: { actions: [{ type: "stepPercent", value: 5 }] },
	}),
	define("assistant", C.DirectVoiceConfig, {
		submenu: "decoKeeAI",
		requiredAdapter: "knob.voice.direct",
		binding: "delegate",
		defaults: {
			actions: [
				{ type: "voiceRoute", value: "direct" },
				{ type: "directProvider", value: "" },
				{ type: "directModel", value: "" },
			],
		},
	}),
	define("dkDesktopClock", C.DesktopClockConfig, {
		submenu: "display",
		requiredAdapter: "clock.render",
		permission: "read",
		supportTouchEffect: false,
		binding: "delegate",
		defaults: { actions: [{ type: "hourFormat", value: "24h" }] },
	}),
	define("hotkeySwitch", C.HotkeySwitchCompatibility, {
		submenu: "shortcut",
		requiredAdapter: "hotkeySwitch.dispatch-evidence",
		binding: "unresolved",
		defaults: { actions: [] },
	}),
] as const;
export type ActionEntry = (typeof ACTION_REGISTRY)[number];
export type ActionConfig = ActionEntry["inputSchema"]["Type"];
export type ActionId = ActionEntry["id"];
export type ActionAvailability =
	| "available"
	| "unsupported-on-platform"
	| "later-phase"
	| "unresolved";
export const findAction = (id: string) =>
	ACTION_REGISTRY.find((entry) => entry.id === id);
/** Defaults may be incomplete drafts. They never bypass executable validation. */
export const createActionDraft = (id: ActionId): Record<string, unknown> => {
	const entry = findAction(id);
	return entry ? structuredClone(entry.defaultConfig) : {};
};
