import { createContext, useContext } from "react";
import { OBS_IDS } from "../../../../../../packages/device/src/actions/obs-contracts";
import { effectiveMonitoring } from "../../../../../../packages/edge/src/monitor/monitor-config";
import type { ClockTarget } from "../../../shared/clock-contracts";
import {
	activeThemeOf,
	clockWeatherSettings,
	normalizeClockStyle,
} from "../../../shared/clock-style";
import type { HourFormat } from "../../../shared/display";
import type { PanelKeyTarget } from "../keys/panel-key-dispatch";
import { EmojiTile } from "../management/emoji/EmojiTile";
import { ObsTile } from "../obs/ObsTile";
import {
	ClockMusicCard,
	ClockMusicSlot,
	ClockWeatherCard,
	ClockWeatherSlot,
} from "../weather-media/ClockCards";
import { rendererWeatherLocale, useWeatherMedia } from "../weather-media/hooks";
import { LocalPlayerCard } from "../weather-media/LocalPlayerCard";
import { PlayerCard } from "../weather-media/PlayerCard";
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
import { monitorKeySettings } from "./tiles/monitor/key-settings";
import { MetricTile } from "./tiles/monitor/MetricTile";
import { useMonitorKeyMedia } from "./tiles/monitor/MonitorKeySettings";
import { MonitorPanel } from "./tiles/monitor/MonitorPanel";
import { useMonitor } from "./tiles/monitor/useMonitor";
import {
	bare,
	diskView,
	memoryPercent,
	percent,
	previewSnapshot,
	rate,
	sampleOf,
	size,
	temperature,
} from "./tiles/monitor/view-model";
import { SoundboardUnavailableTile } from "./tiles/soundboard/SoundboardUnavailableTile";
import { soundboardOwned } from "./tiles/soundboard/soundboard-state";
import { VoiceKeyTile } from "./tiles/voiceKey/VoiceKeyTile";

/**
 * Everything a registered tile may read; tiles never fetch their own data.
 * Clock configuration comes from the selected profile key; its media URLs come from main.
 */
export interface StripTileContext {
	/** Host clock from main's one-second snapshot; undefined until it arrives. */
	readonly now: Date | undefined;
	/** Legacy context retained for other tile consumers. Clocks read their key. */
	readonly hourFormat: HourFormat;
	readonly clockTarget?: ClockTarget | undefined;
	readonly keyTarget?: PanelKeyTarget | undefined;
	/** Voice and chat state for the AI tiles (strip-voice-ui). */
	readonly voice: StripVoiceContext;
	/** Defaults to live for existing tile consumers outside selection previews. */
	readonly interactive?: boolean;
	readonly clockMode?: "passive" | "edit" | "panel";
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
 * custom media and seconds option belong to the selected profile key. Main
 * projects opaque media URLs through `window.quakeClock`; the tile ticks on
 * wall-clock minute boundaries so the flip lands on the minute, starting from
 * the host clock.
 */
function ClockSlot(props: StripTileProps): React.JSX.Element | null {
	const mode =
		props.context.clockMode ??
		(props.context.interactive === false ? "passive" : "panel");
	return mode === "passive" ? (
		<PassiveClockSlot {...props} />
	) : (
		<LiveClockSlot {...props} />
	);
}

function PassiveClockSlot({
	tile,
	context,
}: StripTileProps): React.JSX.Element {
	const actions = tile.key.config.actions;
	const style = normalizeClockStyle(
		actions.find((a) => a.type === "clockStyle")?.value,
	);
	const settings = clockWeatherSettings(actions);
	const now = useClockNow(false, context.now, false);
	return (
		<ClockTile
			widthPx={tile.box.width}
			heightPx={tile.box.height}
			now={now}
			theme={activeThemeOf(style)}
			hourFormat="24h"
			showSeconds={
				actions.find((a) => a.type === "showSeconds")?.value === true
			}
			weather={
				settings.enabled ? (
					<ClockWeatherCard
						city={settings.city}
						unit={settings.unit}
						state={{ kind: "loading" }}
						loading={false}
					/>
				) : undefined
			}
			nowPlaying={
				settings.musicEnabled ? (
					<ClockMusicCard
						snapshot={{ revision: 0, session: null, error: "SESSION_LOST" }}
						control={async () => false}
					/>
				) : undefined
			}
		/>
	);
}

function LiveClockSlot({
	tile,
	context,
}: StripTileProps): React.JSX.Element | null {
	const clock = useClockSettings(undefined, context.clockTarget);
	const snapshot = clock.snapshot;
	const actions = tile.key.config.actions;
	const settings = snapshot?.weather ?? clockWeatherSettings(actions);
	const showSeconds =
		snapshot?.showSeconds ??
		actions.find((a) => a.type === "showSeconds")?.value === true;
	const hourFormat =
		actions.find((a) => a.type === "hourFormat")?.value === "12h"
			? "12h"
			: "24h";
	const style = normalizeClockStyle(
		actions.find((a) => a.type === "clockStyle")?.value,
	);
	const now = useClockNow(showSeconds, context.now);
	if (!clock.ready) return null;
	return (
		<ClockTile
			widthPx={tile.box.width}
			heightPx={tile.box.height}
			now={now}
			theme={snapshot ? themeOf(snapshot) : activeThemeOf(style)}
			hourFormat={hourFormat}
			showSeconds={showSeconds}
			media={mediaOf(snapshot)}
			onThemeSelect={clock.selectTheme}
			weather={
				settings.enabled ? (
					<ClockWeatherSlot
						settings={settings}
						instanceId={JSON.stringify(context.clockTarget)}
					/>
				) : undefined
			}
			nowPlaying={
				(snapshot?.musicEnabled ?? settings.musicEnabled) ? (
					<ClockMusicSlot enabled />
				) : undefined
			}
		/>
	);
}

function PlayerSlot({
	tile,
	context,
}: StripTileProps): React.JSX.Element | null {
	const { snapshot, client } = useWeatherMedia();
	// Local soundboard execution stays with its owner. A configured local key
	// must never turn into an unrelated OS transport action.
	if (soundboardOwned(tile.key.config))
		return context.keyTarget ? (
			<LocalPlayerCard tile={tile} context={context} />
		) : (
			<SoundboardUnavailableTile tile={tile} context={context} />
		);
	return snapshot ? (
		<PlayerCard
			widthPx={tile.box.width}
			heightPx={tile.box.height}
			snapshot={snapshot.media}
			control={
				context.interactive === false ? async () => false : client.control
			}
			locale={rendererWeatherLocale()}
		/>
	) : null;
}

function MonitorSlot({ tile }: StripTileProps): React.JSX.Element {
	const live =
		new URLSearchParams(window.location.search).get("surface") === "panel";
	const monitor = useMonitor(live);
	const settings = monitorKeySettings(tile.key, monitor.settings);
	const media = useMonitorKeyMedia(
		settings.background === "custom"
			? settings.media[settings.styleId]
			: undefined,
		tile.key.keyCode,
	);
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
					settings={settings}
					snapshot={live ? monitor.snapshot : previewSnapshot()}
					media={media}
					preview={!live}
				/>
			</div>
		</div>
	);
}

const monitorTypes = {
	cpuInfo: "cpu",
	gpuInfo: "gpu",
	memInfo: "memory",
	diskInfo: "disk",
	powerInfo: "power",
	networkInfo: "network",
	bluetoothInfo: "bluetooth",
	processInfo: "process",
} as const;

const MetricContext = createContext<ReturnType<typeof useMonitor> | undefined>(
	undefined,
);
function MetricProvider({
	live,
	children,
}: {
	live: boolean;
	children: React.ReactNode;
}): React.JSX.Element {
	const monitor = useMonitor(live);
	return (
		<MetricContext.Provider value={monitor}>{children}</MetricContext.Provider>
	);
}
/** One watch lease per grid, so removing one cell does not stop its neighbours. */
export function StripTileHost({
	layout,
	live,
	children,
}: {
	layout: { tiles: readonly StripTile[] };
	live: boolean;
	children: React.ReactNode;
}): React.ReactNode {
	return layout.tiles.some((tile) => Object.hasOwn(monitorTypes, tile.type)) ? (
		<MetricProvider live={live}>{children}</MetricProvider>
	) : (
		children
	);
}

/** Individual cells use the same decoded provider and availability as the full panel. */
function MetricSlot({ tile, context }: StripTileProps): React.JSX.Element {
	const live =
		context.interactive !== false && context.voice.surface === "panel";
	const monitor = useContext(MetricContext);
	const module =
		Object.entries(monitorTypes).find(([type]) => type === tile.type)?.[1] ??
		"cpu";
	const sample = sampleOf(
		live
			? (monitor?.snapshot ?? { sampledAt: 0, samples: [] })
			: previewSnapshot(),
		module,
	);
	const values = sample.state === "available" ? sample.values : {};
	const unit = monitor?.settings.temperatureUnit ?? "celsius";
	const readings = (): Readonly<Record<string, string>> => {
		switch (module) {
			case "cpu":
			case "gpu":
				return {
					load: percent(values.load),
					temperature: `${temperature(values.temperature, unit)} ${unit === "fahrenheit" ? "°F" : "°C"}`,
					model: values.model ?? "",
				};
			case "memory":
				return {
					used: percent(memoryPercent(values)),
					capacity: `${size(values.used)} / ${size(values.total)}`,
				};
			case "disk":
				return {
					drives: diskView({ ...sample, values })
						.rows.map((d) => `${d.name} ${d.summary}`)
						.join(" · "),
				};
			case "power":
				return {
					percent:
						values.hasBattery === false ? "AC power" : percent(values.percent),
					state: values.batteryState ?? "",
				};
			case "network":
				return {
					interface: values.iface ?? "--",
					up: `↑ ${rate(values.up)} MB/s`,
					down: `↓ ${rate(values.down)} MB/s`,
				};
			case "process":
				return {
					all: `${bare(values.all)} processes`,
					running: `${bare(values.running)} running`,
					blocked: `${bare(values.blocked)} blocked`,
					sleeping: `${bare(values.sleeping)} sleeping`,
				};
			case "bluetooth":
				return {};
		}
	};
	const rows = Object.entries(readings()).filter(([, value]) => value !== "");
	const off =
		monitor !== undefined &&
		!effectiveMonitoring(monitor.settings).metrics.includes(module);
	return (
		<div
			className="strip-metric"
			data-module={module}
			data-state={off ? "off" : sample.state}
		>
			<p className="strip-metric-title">
				{tile.key.config.title.text || module}
				{!live ? <span className="strip-metric-status"> · Preview</span> : null}
			</p>
			{off || sample.state !== "available" ? (
				<p role="status">{off ? "Off" : `Unavailable · ${sample.state}`}</p>
			) : rows.length ? (
				rows.map(([id, value]) => <p key={id}>{value}</p>)
			) : (
				<p>No data</p>
			)}
		</div>
	);
}

/** Per-type renderers. Unregistered types draw DK's generic icon-and-title tile. */
export const stripTileRegistry: ReadonlyMap<string, StripTileComponent> =
	new Map<string, StripTileComponent>([
		...Object.keys(monitorTypes).map((id): [string, StripTileComponent] => [
			id,
			MetricSlot,
		]),
		...OBS_IDS.map((id): [string, StripTileComponent] => [id, ObsTile]),
		["dkDesktopClock", ClockSlot],
		["playAudio", PlayerSlot],
		["playAudioLegacy", PlayerSlot],
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
		...[
			"cpuInfo",
			"gpuInfo",
			"memInfo",
			"diskInfo",
			"processInfo",
			"networkInfo",
			"powerInfo",
			"bluetoothInfo",
		].map((id): [string, StripTileComponent] => [id, MetricTile]),
		["emoji", EmojiTile],
		["homeAssistant", HomeAssistantTile],
	]);

export const stripTileFor = (type: string): StripTileComponent =>
	stripTileRegistry.get(type) ?? GenericTile;
