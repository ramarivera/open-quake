import type { HourFormat } from "../../../shared/display";
import { ClockMusicSlot, ClockWeatherSlot } from "../weather-media/ClockCards";
import { rendererWeatherLocale, useWeatherMedia } from "../weather-media/hooks";
import { PlayerCard } from "../weather-media/PlayerCard";
import type { StripTile } from "./geometry";
import { ClockTile } from "./tiles/clock/ClockTile";
import { useClockNow } from "./tiles/clock/clockHooks";
import {
	mediaOf,
	themeOf,
	useClockSettings,
} from "./tiles/clock/useClockSettings";
import { GenericTile } from "./tiles/GenericTile";

/**
 * Everything a registered tile may read; tiles never fetch their own data.
 * The clock is the one exception until profile keys carry `clockStyle`.
 */
export interface StripTileContext {
	/** Host clock from main's one-second snapshot; undefined until it arrives. */
	readonly now: Date | undefined;
	/** The wallpaper session's saved clock format. */
	readonly hourFormat: HourFormat;
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
	const enrichment = useWeatherMedia();
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
			weather={
				enrichment.snapshot?.settings.enabled ? <ClockWeatherSlot /> : undefined
			}
			nowPlaying={
				enrichment.snapshot?.settings.musicEnabled ? (
					<ClockMusicSlot />
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
	const localSound = tile.key.config.actions.some(
		(action) =>
			action.type === "sound" &&
			(typeof action.value === "string"
				? action.value.trim().length > 0
				: Array.isArray(action.value) && action.value.length > 0),
	);
	if (localSound) return <GenericTile tile={tile} context={context} />;
	return snapshot ? (
		<PlayerCard
			widthPx={tile.box.width}
			heightPx={tile.box.height}
			snapshot={snapshot.media}
			control={client.control}
			locale={rendererWeatherLocale()}
		/>
	) : null;
}

/** Per-type renderers. Unregistered types draw DK's generic icon-and-title tile. */
export const stripTileRegistry: ReadonlyMap<string, StripTileComponent> =
	new Map([
		["dkDesktopClock", ClockSlot],
		["playAudio", PlayerSlot],
	]);

export const stripTileFor = (type: string): StripTileComponent =>
	stripTileRegistry.get(type) ?? GenericTile;
