// Semantic fallbacks from the pinned Apache-2.0 MDI set, not DK resource packs.

import alarm from "@mdi/svg/svg/alarm.svg?raw";
import application from "@mdi/svg/svg/application.svg?raw";
import apps from "@mdi/svg/svg/apps.svg?raw";
import left from "@mdi/svg/svg/arrow-left.svg?raw";
import right from "@mdi/svg/svg/arrow-right.svg?raw";
import bellRing from "@mdi/svg/svg/bell-ring.svg?raw";
import brightness from "@mdi/svg/svg/brightness-7.svg?raw";
import broadcast from "@mdi/svg/svg/broadcast.svg?raw";
import calculator from "@mdi/svg/svg/calculator.svg?raw";
import cameraOff from "@mdi/svg/svg/camera-off.svg?raw";
import chat from "@mdi/svg/svg/chat-processing-outline.svg?raw";
import clipboard from "@mdi/svg/svg/clipboard-text.svg?raw";
import close from "@mdi/svg/svg/close-circle.svg?raw";
import controlPanel from "@mdi/svg/svg/cog.svg?raw";
import console from "@mdi/svg/svg/console.svg?raw";
import desktop from "@mdi/svg/svg/desktop-classic.svg?raw";
import deafen from "@mdi/svg/svg/ear-hearing-off.svg?raw";
import folder from "@mdi/svg/svg/folder.svg?raw";
import list from "@mdi/svg/svg/format-list-numbered.svg?raw";
import text from "@mdi/svg/svg/format-text.svg?raw";
import gamepad from "@mdi/svg/svg/gamepad-variant.svg?raw";
import unknown from "@mdi/svg/svg/help-circle-outline.svg?raw";
import keyboard from "@mdi/svg/svg/keyboard.svg?raw";
import lock from "@mdi/svg/svg/lock.svg?raw";
import magnify from "@mdi/svg/svg/magnify.svg?raw";
import microphone from "@mdi/svg/svg/microphone.svg?raw";
import monitorScreenshot from "@mdi/svg/svg/monitor-screenshot.svg?raw";
import play from "@mdi/svg/svg/play-pause.svg?raw";
import record from "@mdi/svg/svg/record-circle-outline.svg?raw";
import robot from "@mdi/svg/svg/robot-outline.svg?raw";
import rotate from "@mdi/svg/svg/rotate-right.svg?raw";
import share from "@mdi/svg/svg/share-variant.svg?raw";
import shieldCheck from "@mdi/svg/svg/shield-check.svg?raw";
import next from "@mdi/svg/svg/skip-next.svg?raw";
import previous from "@mdi/svg/svg/skip-previous.svg?raw";
import stop from "@mdi/svg/svg/stop.svg?raw";
import subtitles from "@mdi/svg/svg/subtitles-outline.svg?raw";
import textBox from "@mdi/svg/svg/text-box-outline.svg?raw";
import timer from "@mdi/svg/svg/timer-outline.svg?raw";
import translate from "@mdi/svg/svg/translate.svg?raw";
import tune from "@mdi/svg/svg/tune.svg?raw";
import dashboard from "@mdi/svg/svg/view-dashboard.svg?raw";
import volume from "@mdi/svg/svg/volume-high.svg?raw";
import volumeMuted from "@mdi/svg/svg/volume-mute.svg?raw";
import mute from "@mdi/svg/svg/volume-off.svg?raw";
import web from "@mdi/svg/svg/web.svg?raw";
import window from "@mdi/svg/svg/window-maximize.svg?raw";
import { isInlineIcon } from "../strip/tileMetrics";

const defaults: Readonly<Record<string, string>> = {
	brightness,
	luminance: brightness,
	buzzer: bellRing,
	mic: microphone,
	createFolder: folder,
	back: left,
	emojiBack: left,
	website: web,
	cmd: console,
	aiChat: chat,
	aiChatView: chat,
	clawbot: robot,
	quakeBot: robot,
	quakeBotInput: textBox,
	knob: rotate,
	liveAudioTranslate: translate,
	liveAudioTranslateDisplay: subtitles,
	meetingMinutes: text,
	tempMeetingMinutes: text,
	meetingRecordMark: alarm,
	vol: volume,
	colorfulScreen: application,
	dkDesktopClock: timer,
	systemMonitorPanel: application,
	playAudio: play,
	gameMode: application,
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
/** Built-in numeric IDs refer to DecoKee-native PNGs, not renderer assets. */
const builtinArtwork: Readonly<Record<string, string>> = {
	"0-1": brightness,
	"0-11": web,
	"0-39": play,
	"0-50": rotate,
	"0-52": console,
	"0-56": volume,
	"0-57": brightness,
	"0-58": bellRing,
	"0-59": microphone,
	"0-61": text,
	"0-79": monitorScreenshot,
	"0-80": desktop,
	"0-81": list,
	"0-82": lock,
	"0-84": tune,
	"0-85": clipboard,
	"0-87": controlPanel,
	"0-88": apps,
	"0-89": dashboard,
	"0-90": close,
	"0-91": magnify,
	"0-92": window,
	"0-93": web,
	"0-94": web,
	"0-98": translate,
	"0-99": record,
	"0-102": volumeMuted,
	"0-103": volumeMuted,
	"0-104": share,
	"0-105": right,
	"0-106": left,
	"0-107": microphone,
	"0-109": broadcast,
	"0-110": deafen,
	"0-111": cameraOff,
	"0-112": textBox,
	"0-113": translate,
	"0-114": console,
	"0-115": calculator,
	"0-116": magnify,
	"0-117": shieldCheck,
	"0-118": gamepad,
	"0-128": robot,
	"0-129": robot,
	"0-130": textBox,
};
export const hasSemanticKeyArtwork = (icon: string, type: string): boolean =>
	Object.hasOwn(builtinArtwork, icon) || Object.hasOwn(defaults, type);
const cache = new Map<string, string>();
export const keyArtwork = (icon: string, type: string): string => {
	if (isInlineIcon(icon)) return icon;
	if (!icon || !type || type === "empty") return "";
	const cacheKey = `${icon}\u0000${type}`;
	let data = cache.get(cacheKey);
	if (!data) {
		const svg = (builtinArtwork[icon] ?? defaults[type] ?? unknown).replace(
			"<svg ",
			'<svg fill="white" ',
		);
		data = `data:image/svg+xml,${encodeURIComponent(svg)}`;
		cache.set(cacheKey, data);
	}
	return data;
};
