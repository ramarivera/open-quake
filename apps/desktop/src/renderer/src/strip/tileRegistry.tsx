import type { HourFormat } from "../../../shared/display";
import { EmojiTile } from "../management/emoji/EmojiTile";
import type { StripTile } from "./geometry";
import type { StripVoiceContext } from "./overlays/voice/voice-context";
import { AiCopilotTile } from "./tiles/aiCopilot/AiCopilotTile";
import { ClawBotTile } from "./tiles/clawBot/ClawBotTile";
import { ClawBotInputTile } from "./tiles/clawBotInput/ClawBotInputTile";
import { ClockTile } from "./tiles/clock/ClockTile";
import { useClockNow } from "./tiles/clock/clockHooks";
import {
	mediaOf,
	themeOf,
	useClockSettings,
} from "./tiles/clock/useClockSettings";
import { GenericTile } from "./tiles/GenericTile";
import { HomeAssistantTile } from "./tiles/home-assistant/HomeAssistantTile";
import { MeetingDisplay } from "./tiles/meeting/MeetingDisplay";
import { MeetingKey } from "./tiles/meeting/MeetingKey";
import { MonitorPanel } from "./tiles/monitor/MonitorPanel";
import { useMonitor } from "./tiles/monitor/useMonitor";
import { previewSnapshot } from "./tiles/monitor/view-model";
import { VoiceKeyTile } from "./tiles/voiceKey/VoiceKeyTile";

/**
 * Everything a registered tile may read; tiles never fetch their own data.
 * The clock is the one exception until profile keys carry `clockStyle`.
 */
export interface StripTileContext {
	/** Host clock from main's one-second snapshot; undefined until it arrives. */
	readonly now: Date | undefined;
	/** The wallpaper session's saved clock format. */
	readonly hourFormat: HourFormat;
	/** Voice and chat state for the AI tiles (strip-voice-ui). */
	readonly voice: StripVoiceContext;
}
export interface StripTileProps {
	readonly tile: StripTile;
	readonly context: StripTileContext;
}
export type StripTileComponent = (
	props: StripTileProps,
) => React.JSX.Element | null;

/**
 * DK-Suite 0.4.95's desktop clock (openspec/changes/desktop-clock). Its theme,
 * custom media and seconds option come from the clock store
 * (`window.quakeClock`) until profile keys carry `clockStyle`; it ticks on
 * wall-clock minute boundaries so the flip lands on the minute, starting from
 * the host clock.
 */
function ClockSlot({
	tile,
	context,
}: StripTileProps): React.JSX.Element | null {
	const clock = useClockSettings();
	const snapshot = clock.snapshot;
	const now = useClockNow(snapshot?.showSeconds ?? false, context.now);
	// Wait for the saved theme rather than flashing the default first.
	if (!clock.ready) return null;
	return (
		<ClockTile
			widthPx={tile.box.width}
			heightPx={tile.box.height}
			now={now}
			theme={snapshot ? themeOf(snapshot) : "season"}
			hourFormat={context.hourFormat}
			showSeconds={snapshot?.showSeconds ?? false}
			media={mediaOf(snapshot)}
			onThemeSelect={clock.selectTheme}
		/>
	);
}

function MonitorSlot({ tile }: StripTileProps): React.JSX.Element {
	const live =
		new URLSearchParams(window.location.search).get("surface") === "panel";
	const monitor = useMonitor(live);
	return (
		<div
			style={{
				width: tile.box.width,
				height: tile.box.height,
				overflow: "hidden",
			}}
		>
			<div
				style={{
					width: 1920,
					height: 480,
					transformOrigin: "0 0",
					transform: `scale(${tile.box.width / 1920}, ${tile.box.height / 480})`,
				}}
			>
				<MonitorPanel
					settings={monitor.settings}
					snapshot={live ? monitor.snapshot : previewSnapshot()}
					media={monitor.view?.media[monitor.settings.styleId]}
					preview={!live}
				/>
			</div>
		</div>
	);
}

/** Per-type renderers. Unregistered types draw DK's generic icon-and-title tile. */
export const stripTileRegistry: ReadonlyMap<string, StripTileComponent> =
	new Map<string, StripTileComponent>([
		["dkDesktopClock", ClockSlot],
		["meetingMinutes", MeetingKey],
		["tempMeetingMinutes", MeetingKey],
		["meetingRecordMark", MeetingKey],
		["liveAudioTranslate", MeetingKey],
		["mic", MeetingKey],
		["liveAudioTranslateDisplay", MeetingDisplay],
		// strip-voice-ui: AI Copilot 5×2, ClawBotView 4×2, ClawBotInput 2×2, AI keys.
		["aiChatView", AiCopilotTile],
		["quakeBot", ClawBotTile],
		["quakeBotInput", ClawBotInputTile],
		["aiChat", VoiceKeyTile],
		["clawbot", VoiceKeyTile],
		["systemMonitorPanel", MonitorSlot],
		["emoji", EmojiTile],
		["homeAssistant", HomeAssistantTile],
	]);

export const stripTileFor = (type: string): StripTileComponent =>
	stripTileRegistry.get(type) ?? GenericTile;
