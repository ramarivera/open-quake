/**
 * Data contracts for the clock's right-hand cards. The cards themselves
 * (weather: open-meteo/wttr.in; now playing: system media session) belong to
 * open-quake-lih.7. `ClockTile` only places them: an absent card renders
 * nothing, with no placeholder data and no reserved width.
 */

/** DK-Suite `ClockWeatherDisplay`: 564×153, WMO-coded icon, today's range. */
export interface ClockWeatherCardProps {
	readonly city: string;
	readonly unit: "celsius" | "fahrenheit";
	readonly state:
		| { readonly kind: "loading" }
		| { readonly kind: "unconfigured" }
		| {
				readonly kind: "ready";
				readonly temperature: number;
				/** WMO `weather_code`; null draws the generic cloud. */
				readonly weatherCode: number | null;
				readonly description: string;
				readonly high: number;
				readonly low: number;
				/** Served from cache after a failed refresh. */
				readonly stale: boolean;
		  }
		| {
				readonly kind: "error";
				readonly reason: "city-not-found" | "unavailable";
		  };
}

/** DK-Suite `DkMusicCard`: 564 wide, cover, title/artist, prev/play/next. */
export interface ClockNowPlayingCardProps {
	readonly available: boolean;
	readonly title: string;
	readonly artist: string;
	/** Data or app URL; absent draws DK's gradient cover with ♪. */
	readonly coverUrl?: string | undefined;
	readonly playing: boolean;
	readonly canPrevious: boolean;
	readonly canNext: boolean;
	readonly onPrevious?: (() => void) | undefined;
	readonly onToggle?: (() => void) | undefined;
	readonly onNext?: (() => void) | undefined;
}
