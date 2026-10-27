import { ProtocolInputInvalid } from "@open-quake/protocol";
import { Either } from "effect";
import type { ToneName } from "./hardware-contracts.js";

export const sliderToVolume = (position: number): number =>
	position === 0 ? 0 : Math.round(32 + ((position - 1) * 96) / 95);
export const volumeToSlider = (volume: number): number =>
	volume === 0
		? 0
		: Math.min(96, Math.max(1, Math.round(((volume - 32) * 95) / 96) + 1));
export const stepLuminance = (value: number, direction: -1 | 1): number =>
	Math.min(255, Math.max(25, value + direction * 26));
export const luminancePercent = (value: number): number =>
	Math.round((100 * value) / 255);

/** Every pair is [level, durationMs]. MAIN-022 / KNOB-066. */
export const buzzerTones: Readonly<
	Record<ToneName, readonly (readonly [number, number])[]>
> = {
	firework: [[80, 50]],
	success: [
		[80, 50],
		[0, 1000],
		[80, 50],
		[0, 1000],
		[80, 50],
		[0, 1000],
		[80, 50],
		[0, 1000],
		[80, 50],
	],
	start: [
		[80, 100],
		[0, 10],
		[80, 100],
	],
	end: [
		[50, 100],
		[0, 1],
		[50, 100],
		[0, 1],
		[50, 100],
	],
	error: [[90, 200]],
	busy: [
		[60, 60],
		[0, 40],
		[60, 60],
		[0, 40],
		[60, 60],
	],
	preview: [
		[84, 80],
		[0, 80],
		[84, 80],
	],
};

const modifiers: Readonly<Record<string, number>> = {
	control: 1,
	ctrl: 1,
	left_control: 1,
	shift: 2,
	left_shift: 2,
	alt: 4,
	left_alt: 4,
	command: 8,
	super: 8,
	meta: 8,
	win: 8,
	windows: 8,
	right_control: 16,
	right_shift: 32,
	right_alt: 64,
	right_command: 128,
	right_super: 128,
};
const usages: Readonly<Record<string, number>> = {
	enter: 40,
	return: 40,
	escape: 41,
	esc: 41,
	backspace: 42,
	tab: 43,
	space: 44,
	minus: 45,
	equal: 46,
	leftbracket: 47,
	rightbracket: 48,
	backslash: 49,
	semicolon: 51,
	quote: 52,
	grave: 53,
	comma: 54,
	period: 55,
	slash: 56,
	capslock: 57,
	printscreen: 70,
	scrolllock: 71,
	pause: 72,
	insert: 73,
	home: 74,
	pageup: 75,
	delete: 76,
	end: 77,
	pagedown: 78,
	right: 79,
	left: 80,
	down: 81,
	up: 82,
	numlock: 83,
	menu: 118,
	"-": 45,
	"=": 46,
	"[": 47,
	"]": 48,
	"\\": 49,
	";": 51,
	"'": 52,
	"`": 53,
	",": 54,
	".": 55,
	"/": 56,
};
function usageFor(token: string): number | undefined {
	if (/^[a-z]$/.test(token)) return token.charCodeAt(0) - 93;
	if (/^[1-9]$/.test(token)) return Number(token) + 29;
	if (token === "0") return 39;
	const fn = /^f(\d{1,2})$/.exec(token);
	if (fn) {
		const n = Number(fn[1]);
		if (n >= 1 && n <= 12) return n + 57;
		if (n >= 13 && n <= 24) return n + 91;
	}
	return usages[token];
}
export const deviceKeyboardTokens: ReadonlySet<string> = new Set([
	...Object.keys(modifiers),
	...Object.keys(usages),
	..."abcdefghijklmnopqrstuvwxyz0123456789",
	...Array.from({ length: 24 }, (_, i) => `f${i + 1}`),
]);

/** MAIN-026: exactly one ordinary usage byte. Never silently drop an extra key. */
export function encodeDeviceChord(chord: string): Either.Either<
	{
		readonly modifiers: number;
		readonly usage: number;
	},
	ProtocolInputInvalid
> {
	let mask = 0;
	let usage = 0;
	for (const raw of chord.split("+")) {
		const token = raw.trim().toLowerCase();
		const modifier = modifiers[token];
		if (modifier !== undefined) mask |= modifier;
		else {
			const key = usageFor(token);
			if (key === undefined || usage !== 0)
				return Either.left(
					new ProtocolInputInvalid("unsupported-device-chord"),
				);
			usage = key;
		}
	}
	return mask || usage
		? Either.right({ modifiers: mask, usage })
		: Either.left(new ProtocolInputInvalid("empty-device-chord"));
}
