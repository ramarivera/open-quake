import { Schema } from "effect";
import * as C from "./action-contracts.js";
import { OBS_IDS, obsDraft, obsKeyConfig } from "./obs-contracts.js";

const define = <A, Encoded, const I extends string>(
	id: I,
	inputSchema: Schema.Schema<A, Encoded>,
	options: {
		readonly submenu:
			| "shortcut"
			| "multiMedia"
			| "navigation"
			| "deviceControl"
			| "decoKeeAI"
			| "display"
			| "obsStudio"
			| "system";
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
		readonly alternateState?: boolean;
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
		alternateState: options.alternateState ?? false,
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
	define("close", C.CloseAppConfig, {
		submenu: "shortcut",
		requiredAdapter: "host.application.close",
		binding: "delegate",
		permission: "sensitive",
		defaults: {
			actions: [
				{ type: "path", value: "" },
				{ type: "force", value: 0 },
			],
		},
	}),
	...(["playAudioLegacy", "stopAudio"] as const).map((id) =>
		define(
			id,
			C.SequenceAudioConfig.pipe(Schema.filter((c) => c.type === id)),
			{
				submenu: "shortcut",
				requiredAdapter: "soundboard.runtime",
				binding: "delegate",
				defaults: {
					actions:
						id === "stopAudio"
							? []
							: [
									{ type: "sound", value: "" },
									{ type: "audioAction", value: 0 },
									{ type: "audioFade", value: "0-0" },
									{ type: "volume", value: 100 },
								],
				},
			},
		),
	),
	define("cmd", C.CommandConfig, {
		submenu: "system",
		requiredAdapter: "profiles.command",
		binding: "delegate",
		permission: "sensitive",
		defaults: {
			actions: [{ type: "text", value: "" }],
			basicEditableItems: { grid: false },
		},
	}),
	define("managementCenter", C.ManagementConfig, {
		submenu: "navigation",
		requiredAdapter: "desktop.management",
		binding: "delegate",
		defaults: { actions: [] },
	}),
	define("screenshot", C.ScreenshotConfig, {
		submenu: "system",
		requiredAdapter: "host.screenshot",
		binding: "delegate",
		permission: "sensitive",
		defaults: { actions: [] },
	}),
	define("lock", C.LockConfig, {
		submenu: "system",
		requiredAdapter: "host.lock",
		binding: "delegate",
		permission: "sensitive",
		defaults: { actions: [] },
	}),
	define("switchProfile", C.SwitchProfileConfig, {
		submenu: "navigation",
		requiredAdapter: "profiles.navigation",
		binding: "delegate",
		defaults: {
			actions: [
				{ type: "profile", value: "-1" },
				{ type: "page", value: 1 },
			],
		},
	}),
	define("pageNo", C.PageNumberConfig, {
		submenu: "navigation",
		requiredAdapter: "profiles.page-number",
		binding: "delegate",
		permission: "read",
		supportTouchEffect: false,
		defaults: { actions: [] },
	}),

	define("audioBot", C.AudioBotConfig, {
		submenu: "decoKeeAI",
		requiredAdapter: "speech.runtime",
		binding: "delegate",
		defaults: {
			actions: [
				{ type: "agentId", value: "default" },
				{ type: "ttsEngine", value: "qwen" },
				{ type: "modeltype", value: "qwen-audio-3.1-tts-flash" },
			],
		},
	}),
	...OBS_IDS.map((id) =>
		define(id, obsKeyConfig(id), {
			submenu: "obsStudio",
			requiredAdapter: "obs.runtime",
			binding: "delegate",
			supportKnob: id === "obsVolume",
			permission:
				id === "obsStats" || id === "obsScreenshot" ? "read" : "write",
			defaults: {
				actions: [{ type: "configData", value: obsDraft(id) }],
				supportKnob: id === "obsVolume",
				size: [1, 1],
				basicEditableItems: { title: true, grid: true, icon: true },
				...(id === "obsStats"
					? {
							size: [2, 1],
							basicEditableItems: { title: false, grid: false, icon: false },
						}
					: {}),
				...(id === "obsScreenshot"
					? {
							size: [2, 2],
							basicEditableItems: { title: false, grid: false, icon: false },
						}
					: {}),
			},
		}),
	),
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
	define("vol", C.VolumeConfig, {
		submenu: "deviceControl",
		requiredAdapter: "host.volume",
		binding: "media",
		supportKnob: true,
		defaults: {
			supportKnob: true,
			actions: [
				{ type: "key", value: "audio_vol_down" },
				{ type: "key", value: "audio_vol_up" },
			],
		},
	}),
	define("mute", C.MuteConfig, {
		submenu: "deviceControl",
		requiredAdapter: "host.volume",
		binding: "media",
		alternateState: true,
		defaults: {
			actions: [
				{ type: "key", value: "audio_mute" },
				{ type: "key", value: "audio_mute" },
			],
		},
	}),
	define("brightness", C.BrightnessConfig, {
		submenu: "deviceControl",
		requiredAdapter: "host.brightness",
		binding: "delegate",
		supportKnob: true,
		defaults: {
			supportKnob: true,
			actions: [
				{ type: "level", value: 1 },
				{ type: "level", value: 0 },
			],
		},
	}),
	define("media", C.MediaConfig, {
		submenu: "multiMedia",
		requiredAdapter: "host.media",
		binding: "media",
		defaults: { actions: [{ type: "key", value: "audio_play" }] },
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
	define("emoji", C.EmojiConfig, {
		submenu: "display",
		requiredAdapter: "emoji.press",
		binding: "delegate",
		defaults: {
			actions: [
				{ type: "emojiAction", value: 1 },
				{
					type: "emojiConfig",
					value: { packageId: "", emojiId: "", hash: "" },
				},
			],
		},
	}),
	define("hotkeySwitch", C.HotkeySwitchCompatibility, {
		alternateState: true,
		submenu: "shortcut",
		requiredAdapter: "host.keyboard",
		binding: "hotkey",
		defaults: {
			actions: [
				{ type: "key", value: "" },
				{ type: "key", value: "" },
			],
		},
	}),
	define("timer", C.TimerConfig, {
		submenu: "decoKeeAI",
		requiredAdapter: "keys.runtime",
		binding: "delegate",
		defaults: {
			actions: [
				{ type: "time", value: 10000 },
				{ type: "sound", value: "" },
				{ type: "callback", value: 1 },
			],
		},
	}),
	define("multiActions", C.MultiActionConfig, {
		submenu: "shortcut",
		requiredAdapter: "keys.runtime",
		binding: "delegate",
		defaults: { actions: [], subActions: [] },
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

/** MAIN-066: retained DK-Suite dispatch inventory. Owners reference existing composition,
 * not substitute handlers. Plugin registration is deliberately supplied by the plugins lane. */
export const RETAINED_ACTION_OWNERS = {
	timer: "keys",
	brightness: "hardware",
	multiActions: "keys",
	delay: "sequence",
	folder: "keys",
	emojiFolder: "keys",
	back: "keys",
	emojiBack: "keys",
	switchProfile: "keys",
	pageUp: "keys",
	pageDown: "keys",
	goToPage: "keys",
	pageNo: "display",
	website: "native",
	hotkeySwitch: "keys",
	hotkey: "native",
	open: "native",
	close: "native",
	text: "native",
	media: "media",
	mute: "media",
	playPause: "media",
	stopPlay: "media",
	skipBackward: "media",
	skipForward: "media",
	fastBackward: "media",
	fastForward: "media",
	repeatPlay: "media",
	randomPlay: "media",
	vol: "hardware",
	playAudio: "soundboard",
	playAudioLegacy: "soundboard",
	stopAudio: "soundboard",
	knob: "knob",
	assistant: "voice",
	cmd: "profiles.command",
	homeAssistant: "home-assistant",
	...Object.fromEntries(
		OBS_IDS.filter((id) => id !== "obsStats" && id !== "obsScreenshot").map(
			(id) => [id, "obs"],
		),
	),
	luminance: "hardware",
	buzzer: "hardware",
	mic: "hardware",
	meetingMinutes: "meetings",
	tempMeetingMinutes: "meetings",
	meetingRecordMark: "meetings",
	cpuInfo: "display",
	gpuInfo: "display",
	memInfo: "display",
	diskInfo: "display",
	processInfo: "display",
	networkInfo: "display",
	bluetoothInfo: "display",
	powerInfo: "display",
	emoji: "emoji",
	liveAudioTranslate: "voice",
	aiChat: "assistant",
	aiChatView: "assistant",
	audioBot: "voice",
	clawbot: "agents",
} as const;
export const PLUGIN_ACTION_OWNER = "plugins.port";

export const retainedActionOwner = (type: string): string | undefined =>
	Object.entries(RETAINED_ACTION_OWNERS).find(([id]) => id === type)?.[1];
