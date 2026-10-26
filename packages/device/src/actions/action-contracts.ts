import { Schema } from "effect";
import { ProfileAction } from "../profiles/profile-contracts.js";

export const AUDIO_OPERATIONS = [
	"audio_mute",
	"audio_vol_down",
	"audio_vol_up",
	"audio_play",
	"audio_pause",
	"audio_stop",
	"audio_prev",
	"audio_next",
	"audio_rewind",
	"audio_forward",
	"audio_repeat",
	"audio_random",
] as const;

export const HOTKEY_MODIFIERS = [
	"shift",
	"right_shift",
	"control",
	"right_control",
	"alt",
	"right_alt",
	"command",
	"right_command",
	"super",
	"right_super",
] as const;
export const HOTKEY_KEYS = [
	..."abcdefghijklmnopqrstuvwxyz0123456789".split(""),
	"enter",
	"escape",
	"space",
	"tab",
	"backspace",
	"delete",
	"insert",
	"home",
	"end",
	"pageup",
	"pagedown",
	"up",
	"down",
	"left",
	"right",
	"capslock",
	"numlock",
	"scrolllock",
	"printscreen",
	"pause",
	"minus",
	"equal",
	"leftbracket",
	"rightbracket",
	"backslash",
	"semicolon",
	"quote",
	"comma",
	"period",
	"slash",
	"grave",
	...Array.from({ length: 24 }, (_, i) => `f${i + 1}`),
] as const;

/** Grammar is finite; the host must additionally advertise each supported token. */
export function isHotkeyChord(value: string): boolean {
	if (AUDIO_OPERATIONS.some((token) => token === value)) return true;
	const tokens = value.split("+");
	const key = tokens.at(-1);
	return (
		key !== undefined &&
		HOTKEY_KEYS.includes(key) &&
		new Set(tokens).size === tokens.length &&
		tokens
			.slice(0, -1)
			.every((token) => HOTKEY_MODIFIERS.some((modifier) => modifier === token))
	);
}
export const HotkeyChord = Schema.String.pipe(Schema.filter(isHotkeyChord));
const Nonblank = Schema.String.pipe(
	Schema.filter((s) => s.trim().length > 0 && !s.includes("\0")),
);
export const WebsiteUrl = Nonblank.pipe(
	Schema.filter((s) => {
		if (!/^https?:\/\//i.test(s) || s !== s.trim() || !URL.canParse(s))
			return false;
		const url = new URL(s);
		return (
			(url.protocol === "http:" || url.protocol === "https:") &&
			url.hostname.length > 0
		);
	}),
);
export const InsertedText = Schema.String.pipe(
	Schema.filter((s) => [...s].length > 0 && [...s].length <= 500),
);
const KeyAction = Schema.Struct({
	type: Schema.Literal("key"),
	value: HotkeyChord,
});
const Enter = Schema.Struct({
	type: Schema.Literal("key"),
	value: Schema.Literal("enter"),
});
export const WebsiteConfig = Schema.Struct({
	type: Schema.Literal("website"),
	actions: Schema.Tuple(
		Schema.Struct({ type: Schema.Literal("url"), value: WebsiteUrl }),
	),
});
export const HotkeyConfig = Schema.Union(
	Schema.Struct({
		type: Schema.Literal("hotkey"),
		supportKnob: Schema.optionalWith(Schema.Literal(false), { exact: true }),
		actions: Schema.Tuple(KeyAction),
	}),
	Schema.Struct({
		type: Schema.Literal("hotkey"),
		supportKnob: Schema.Literal(true),
		actions: Schema.Tuple(KeyAction, KeyAction),
	}),
);
export const TextConfig = Schema.Struct({
	type: Schema.Literal("text"),
	actions: Schema.Union(
		Schema.Tuple(
			Schema.Struct({ type: Schema.Literal("text"), value: InsertedText }),
		),
		Schema.Tuple(
			Schema.Struct({ type: Schema.Literal("text"), value: InsertedText }),
			Enter,
		),
	),
});
/** Absolute POSIX/drive/UNC path or a selected app:<bundle-id> reference. */
export const ApplicationReference = Nonblank.pipe(
	Schema.filter(
		(value) =>
			value.startsWith("/") ||
			/^[a-z]:[\\/]/i.test(value) ||
			/^\\\\[^\\]+\\[^\\]+(?:\\|$)/.test(value) ||
			/^app:[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(value),
	),
);
export const OpenAppConfig = Schema.Struct({
	type: Schema.Literal("open"),
	actions: Schema.Tuple(
		Schema.Struct({
			type: Schema.Literal("path"),
			value: ApplicationReference,
		}),
	),
});
export const MediaCommand = Schema.Literal(
	"audio_mute",
	"audio_vol_down",
	"audio_vol_up",
	"audio_pause",
	"audio_play",
	"audio_stop",
	"audio_prev",
	"audio_next",
	"audio_rewind",
	"audio_forward",
	"audio_repeat",
	"audio_random",
);
export type MediaCommand = typeof MediaCommand.Type;
export const mediaConfig = <
	const I extends string,
	const C extends MediaCommand,
>(
	id: I,
	command: C,
) =>
	Schema.Struct({
		type: Schema.Literal(id),
		actions: Schema.Tuple(
			Schema.Struct({
				type: Schema.Literal("key"),
				value: Schema.Literal(command),
			}),
		),
	});

export const VolumeConfig = Schema.Struct({
	type: Schema.Literal("vol"),
	supportKnob: Schema.Literal(true),
	actions: Schema.Tuple(
		Schema.Struct({
			type: Schema.Literal("key"),
			value: Schema.Literal("audio_vol_down"),
		}),
		Schema.Struct({
			type: Schema.Literal("key"),
			value: Schema.Literal("audio_vol_up"),
		}),
	),
});
export const MuteConfig = Schema.Struct({
	type: Schema.Literal("mute"),
	actions: Schema.Tuple(
		Schema.Struct({
			type: Schema.Literal("key"),
			value: Schema.Literal("audio_mute"),
		}),
		Schema.Struct({
			type: Schema.Literal("key"),
			value: Schema.Literal("audio_mute"),
		}),
	),
});
export const BrightnessConfig = Schema.Struct({
	type: Schema.Literal("brightness"),
	supportKnob: Schema.Literal(true),
	actions: Schema.Tuple(
		Schema.Struct({ type: Schema.Literal("level"), value: Schema.Literal(1) }),
		Schema.Struct({ type: Schema.Literal("level"), value: Schema.Literal(0) }),
	),
});
export const MediaConfig = Schema.Struct({
	type: Schema.Literal("media"),
	actions: Schema.Tuple(
		Schema.Struct({ type: Schema.Literal("key"), value: MediaCommand }),
	),
});

/** Schemas at the integration seam, execution remains with the owning domain. */
export const GoToPageConfig = Schema.Struct({
	type: Schema.Literal("goToPage"),
	actions: Schema.Tuple(
		Schema.Struct({
			type: Schema.Literal("page"),
			value: Schema.Int.pipe(Schema.positive()),
		}),
	),
});
export const PreviousPageConfig = Schema.Struct({
	type: Schema.Literal("previousPage"),
	actions: Schema.Tuple(),
});
export const NextPageConfig = Schema.Struct({
	type: Schema.Literal("nextPage"),
	actions: Schema.Tuple(),
});
export const PanelBrightnessConfig = Schema.Struct({
	type: Schema.Literal("panelBrightness"),
	actions: Schema.Tuple(
		Schema.Struct({
			type: Schema.Literal("stepPercent"),
			value: Schema.Int.pipe(Schema.between(1, 100)),
		}),
	),
});
export const DirectVoiceConfig = Schema.Struct({
	type: Schema.Literal("assistant"),
	actions: Schema.Array(
		Schema.Union(
			Schema.Struct({
				type: Schema.Literal("voiceRoute"),
				value: Schema.Literal("direct"),
			}),
			Schema.Struct({
				type: Schema.Literal("directProvider"),
				value: Nonblank,
			}),
			Schema.Struct({ type: Schema.Literal("directModel"), value: Nonblank }),
		),
	).pipe(
		Schema.filter(
			(actions) =>
				actions.length === 3 &&
				new Set(actions.map((action) => action.type)).size === 3,
		),
	),
});
export const DesktopClockConfig = Schema.Struct({
	type: Schema.Literal("dkDesktopClock"),
	actions: Schema.Array(ProfileAction).pipe(
		Schema.filter((actions) => {
			const formats = actions.filter((action) => action.type === "hourFormat");
			return (
				formats.length === 1 &&
				(formats[0]?.value === "12h" || formats[0]?.value === "24h") &&
				new Set(actions.map((action) => action.type)).size === actions.length
			);
		}),
	),
});
export const HotkeySwitchConfig = Schema.Struct({
	type: Schema.Literal("hotkeySwitch"),
	actions: Schema.Tuple(KeyAction, KeyAction),
});
export const HotkeySwitchCompatibility = HotkeySwitchConfig;
export const TimerConfig = Schema.Struct({
	type: Schema.Literal("timer"),
	actions: Schema.Array(
		Schema.Union(
			Schema.Struct({
				type: Schema.Literal("time"),
				value: Schema.Int.pipe(Schema.between(1, 86400000)),
			}),
			Schema.Struct({ type: Schema.Literal("sound"), value: Schema.String }),
			Schema.Struct({
				type: Schema.Literal("callback"),
				value: Schema.Literal(0, 1),
			}),
		),
	).pipe(
		Schema.filter(
			(a) =>
				a.filter((v) => v.type === "time").length === 1 &&
				new Set(a.map((v) => v.type)).size === a.length,
		),
	),
});
export const SequenceLeaf = Schema.Union(
	MuteConfig,
	MediaConfig,
	mediaConfig("playPause", "audio_play"),
	mediaConfig("stopPlay", "audio_stop"),
	mediaConfig("skipBackward", "audio_prev"),
	mediaConfig("skipForward", "audio_next"),
	mediaConfig("fastBackward", "audio_rewind"),
	mediaConfig("fastForward", "audio_forward"),
	mediaConfig("repeatPlay", "audio_repeat"),
	mediaConfig("randomPlay", "audio_random"),
	WebsiteConfig,
	HotkeyConfig,
	TextConfig,
	OpenAppConfig,
	Schema.Struct({
		type: Schema.Literal("delay"),
		actions: Schema.Tuple(
			Schema.Struct({
				type: Schema.Literal("time"),
				value: Schema.Int.pipe(Schema.between(0, 86400000)),
			}),
		),
	}),
);
export const MAX_SEQUENCE_OPERATIONS = 100;

export const MultiActionConfig = Schema.Struct({
	type: Schema.Literal("multiActions"),
	actions: Schema.Array(Schema.Unknown),
	subActions: Schema.Array(
		Schema.Struct({
			config: Schema.extend(
				SequenceLeaf,
				Schema.Struct({
					gap: Schema.optional(Schema.Int.pipe(Schema.between(0, 60000))),
				}),
			),
		}),
	).pipe(Schema.minItems(1), Schema.maxItems(MAX_SEQUENCE_OPERATIONS)),
});

export const ActionActivation = Schema.Struct({
	deviceId: Nonblank,
	sessionId: Nonblank,
	profileId: Nonblank,
	pageId: Nonblank,
	revision: Schema.Int.pipe(Schema.nonNegative()),
	keyCode: Nonblank,
	/** Strictly increasing per device/control within a session, across profile revisions. Duplicates retain their sequence. */
	sequence: Schema.Int.pipe(Schema.nonNegative()),
	origin: Schema.Literal("logical", "mapped-physical"),
	kind: Schema.Literal("press", "release", "repeat", "hold"),
});
export type ActionActivation = typeof ActionActivation.Type;

/** Supplied by the profile owner, never by an editor draft or preview. */
export interface CommittedActionSnapshot {
	readonly deviceId: string;
	readonly sessionId: string;
	readonly profileId: string;
	readonly pageId: string;
	readonly revision: number;
	readonly keys: ReadonlyArray<{
		readonly keyCode: string;
		readonly childrenName: string;
		readonly display: boolean;
		readonly config: unknown;
	}>;
}

/** CENTER-018/090. The emoji runtime resolves this reference from committed profiles. */
export const EmojiConfig = Schema.Struct({
	type: Schema.Literal("emoji"),
	supportKnob: Schema.optionalWith(Schema.Literal(false), { exact: true }),
	actions: Schema.Tuple(
		Schema.Struct({
			type: Schema.Literal("emojiAction"),
			value: Schema.Literal(0, 1, 2),
		}),
		Schema.Struct({
			type: Schema.Literal("emojiConfig"),
			value: Schema.Struct({
				packageId: Nonblank,
				emojiId: Nonblank,
				hash: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
			}),
		}),
	),
});
