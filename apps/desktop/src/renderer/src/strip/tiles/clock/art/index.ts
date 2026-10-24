import type { ThemeId } from "../../../../../../shared/clock-style";
import { animeArt } from "./anime";
import { auroraArt } from "./aurora";
import { cyberArt } from "./cyber";
import { seasonArt } from "./season";
import { tacticalArt } from "./tactical";

/**
 * open-quake's own built-in clock backgrounds. DK-Suite's five JPEGs
 * (`app-resources/clock-bg/theme-*.jpg`) ship in a proprietary bundle without
 * a licence grant, so these scenes follow the same composition notes instead.
 */
const SCENES: Readonly<Record<ThemeId, () => string>> = {
	season: seasonArt,
	cyber: cyberArt,
	anime: animeArt,
	tactical: tacticalArt,
	aurora: auroraArt,
};

export function themeArtSvg(themeId: ThemeId): string {
	return SCENES[themeId]();
}

const urls = new Map<ThemeId, string>();

/** Built once per theme and reused by the strip, the preview and thumbnails. */
export function themeArtUrl(themeId: ThemeId): string {
	let url = urls.get(themeId);
	if (!url) {
		url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(themeArtSvg(themeId))}`;
		urls.set(themeId, url);
	}
	return url;
}
