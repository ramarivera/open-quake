// Semantic tile artwork from the pinned MIT-licensed Phosphor regular set.

import alarm from "@phosphor-icons/core/assets/regular/alarm.svg?raw";
import application from "@phosphor-icons/core/assets/regular/app-window.svg?raw";
import left from "@phosphor-icons/core/assets/regular/arrow-left.svg?raw";
import right from "@phosphor-icons/core/assets/regular/arrow-right.svg?raw";
import rotate from "@phosphor-icons/core/assets/regular/arrows-clockwise.svg?raw";
import textBox from "@phosphor-icons/core/assets/regular/article.svg?raw";
import bellRing from "@phosphor-icons/core/assets/regular/bell-ringing.svg?raw";
import bellOff from "@phosphor-icons/core/assets/regular/bell-slash.svg?raw";
import broadcast from "@phosphor-icons/core/assets/regular/broadcast.svg?raw";
import window from "@phosphor-icons/core/assets/regular/browsers.svg?raw";
import calculator from "@phosphor-icons/core/assets/regular/calculator.svg?raw";
import chat from "@phosphor-icons/core/assets/regular/chat-circle-dots.svg?raw";
import clipboard from "@phosphor-icons/core/assets/regular/clipboard-text.svg?raw";
import desktop from "@phosphor-icons/core/assets/regular/desktop.svg?raw";
import deafen from "@phosphor-icons/core/assets/regular/ear-slash.svg?raw";
import folder from "@phosphor-icons/core/assets/regular/folder.svg?raw";
import gamepad from "@phosphor-icons/core/assets/regular/game-controller.svg?raw";
import controlPanel from "@phosphor-icons/core/assets/regular/gear.svg?raw";
import web from "@phosphor-icons/core/assets/regular/globe.svg?raw";
import keyboard from "@phosphor-icons/core/assets/regular/keyboard.svg?raw";
import list from "@phosphor-icons/core/assets/regular/list-numbers.svg?raw";
import lock from "@phosphor-icons/core/assets/regular/lock.svg?raw";
import magnify from "@phosphor-icons/core/assets/regular/magnifying-glass.svg?raw";
import microphone from "@phosphor-icons/core/assets/regular/microphone.svg?raw";
import microphoneOff from "@phosphor-icons/core/assets/regular/microphone-slash.svg?raw";
import play from "@phosphor-icons/core/assets/regular/play-pause.svg?raw";
import unknown from "@phosphor-icons/core/assets/regular/question.svg?raw";
import record from "@phosphor-icons/core/assets/regular/record.svg?raw";
import robot from "@phosphor-icons/core/assets/regular/robot.svg?raw";
import monitorScreenshot from "@phosphor-icons/core/assets/regular/selection-background.svg?raw";
import share from "@phosphor-icons/core/assets/regular/share-network.svg?raw";
import shieldCheck from "@phosphor-icons/core/assets/regular/shield-check.svg?raw";
import previous from "@phosphor-icons/core/assets/regular/skip-back.svg?raw";
import next from "@phosphor-icons/core/assets/regular/skip-forward.svg?raw";
import tune from "@phosphor-icons/core/assets/regular/sliders-horizontal.svg?raw";
import volume from "@phosphor-icons/core/assets/regular/speaker-high.svg?raw";
import volumeMuted from "@phosphor-icons/core/assets/regular/speaker-slash.svg?raw";
import mute from "@phosphor-icons/core/assets/regular/speaker-slash.svg?raw";
import apps from "@phosphor-icons/core/assets/regular/squares-four.svg?raw";
import dashboard from "@phosphor-icons/core/assets/regular/squares-four.svg?raw";
import stop from "@phosphor-icons/core/assets/regular/stop.svg?raw";
import subtitles from "@phosphor-icons/core/assets/regular/subtitles.svg?raw";
import brightness from "@phosphor-icons/core/assets/regular/sun.svg?raw";
import console from "@phosphor-icons/core/assets/regular/terminal.svg?raw";
import text from "@phosphor-icons/core/assets/regular/text-aa.svg?raw";
import timer from "@phosphor-icons/core/assets/regular/timer.svg?raw";
import translate from "@phosphor-icons/core/assets/regular/translate.svg?raw";
import cameraOff from "@phosphor-icons/core/assets/regular/video-camera-slash.svg?raw";
import close from "@phosphor-icons/core/assets/regular/x-circle.svg?raw";
import { isInlineIcon } from "../strip/tileMetrics";

const defaults: Readonly<Record<string, string>> = {
	brightness,
	luminance: brightness,
	panelBrightness: brightness,
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
/** Legacy numeric IDs retain their meaning using bundled Phosphor artwork. */
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
	// Toggled states (alterIcon) of the built-in mic and buzzer keys.
	"0-100": microphoneOff,
	"0-101": bellOff,
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
	"0-103": microphoneOff,
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
		const source = Object.hasOwn(builtinArtwork, icon)
			? builtinArtwork[icon]
			: Object.hasOwn(defaults, type)
				? defaults[type]
				: unknown;
		const svg = (source ?? unknown).replace(
			'fill="currentColor"',
			'fill="white"',
		);
		data = `data:image/svg+xml,${encodeURIComponent(svg)}`;
		cache.set(cacheKey, data);
	}
	return data;
};
