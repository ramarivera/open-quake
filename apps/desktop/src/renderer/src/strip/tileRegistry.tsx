import type { HourFormat } from "../../../shared/display";
import type { StripTile } from "./geometry";
import type { StripVoiceContext } from "./overlays/voice/voice-context";
import { AiCopilotTile } from "./tiles/aiCopilot/AiCopilotTile";
import { ClockPlaceholder } from "./tiles/ClockPlaceholder";
import { ClawBotTile } from "./tiles/clawBot/ClawBotTile";
import { ClawBotInputTile } from "./tiles/clawBotInput/ClawBotInputTile";
import { GenericTile } from "./tiles/GenericTile";
import { VoiceKeyTile } from "./tiles/voiceKey/VoiceKeyTile";

/** Everything a registered tile may read; tiles never fetch their own data. */
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
 * strip-clock replaces ClockPlaceholder with `ClockTile` from
 * `./tiles/clock/`, which takes the same `{ widthPx, heightPx, now, theme }`.
 * `theme` is the clock theme id; DK's default is "season".
 */
function ClockSlot({
	tile,
	context,
}: StripTileProps): React.JSX.Element | null {
	return context.now ? (
		<ClockPlaceholder
			widthPx={tile.box.width}
			heightPx={tile.box.height}
			now={context.now}
			theme="season"
			hourFormat={context.hourFormat}
		/>
	) : null;
}

/** Per-type renderers. Unregistered types draw DK's generic icon-and-title tile. */
export const stripTileRegistry: ReadonlyMap<string, StripTileComponent> =
	new Map([
		["dkDesktopClock", ClockSlot],
		// strip-voice-ui: AI Copilot 5×2, ClawBotView 4×2, ClawBotInput 2×2, AI keys.
		["aiChatView", AiCopilotTile],
		["quakeBot", ClawBotTile],
		["quakeBotInput", ClawBotInputTile],
		["aiChat", VoiceKeyTile],
		["clawbot", VoiceKeyTile],
	]);

export const stripTileFor = (type: string): StripTileComponent =>
	stripTileRegistry.get(type) ?? GenericTile;
