// Semantic fallbacks from the pinned Apache-2.0 MDI set, not DK resource packs.
import alarm from "@mdi/svg/svg/alarm.svg?raw";
import application from "@mdi/svg/svg/application.svg?raw";
import left from "@mdi/svg/svg/arrow-left.svg?raw";
import right from "@mdi/svg/svg/arrow-right.svg?raw";
import list from "@mdi/svg/svg/format-list-numbered.svg?raw";
import text from "@mdi/svg/svg/format-text.svg?raw";
import unknown from "@mdi/svg/svg/help-circle-outline.svg?raw";
import keyboard from "@mdi/svg/svg/keyboard.svg?raw";
import microphone from "@mdi/svg/svg/microphone.svg?raw";
import play from "@mdi/svg/svg/play-pause.svg?raw";
import next from "@mdi/svg/svg/skip-next.svg?raw";
import previous from "@mdi/svg/svg/skip-previous.svg?raw";
import stop from "@mdi/svg/svg/stop.svg?raw";
import timer from "@mdi/svg/svg/timer-outline.svg?raw";
import volume from "@mdi/svg/svg/volume-high.svg?raw";
import mute from "@mdi/svg/svg/volume-off.svg?raw";
import web from "@mdi/svg/svg/web.svg?raw";
import { isInlineIcon } from "../strip/tileMetrics";

const defaults: Readonly<Record<string, string>> = {
	website: web,
	hotkey: keyboard,
	hotkeySwitch: keyboard,
	text,
	open: application,
	goToPage: right,
	nextPage: right,
	previousPage: left,
	multiActions: list,
	timer,
	countdown: timer,
	alarm,
	playPause: play,
	stopPlay: stop,
	skipBackward: previous,
	fastBackward: previous,
	skipForward: next,
	fastForward: next,
	volumeUp: volume,
	volumeDown: volume,
	mute: mute,
	microphone: microphone,
};
const cache = new Map<string, string>();
export const keyArtwork = (icon: string, type: string): string => {
	if (isInlineIcon(icon)) return icon;
	if (!type || type === "empty") return "";
	let data = cache.get(type);
	if (!data) {
		const svg = (defaults[type] ?? unknown).replace(
			"<svg ",
			'<svg fill="white" ',
		);
		data = `data:image/svg+xml,${encodeURIComponent(svg)}`;
		cache.set(type, data);
	}
	return data;
};
