import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Resolve a real font on each supported host, with an explicit CI override. Never skip decode. */
export async function smokeFont(
	platform: NodeJS.Platform = process.platform,
	override = process.env.OPEN_QUAKE_SMOKE_FONT,
	read: (path: string) => Promise<Buffer> = readFile,
	windowsRoot = process.env.WINDIR ?? "C:\\Windows",
): Promise<Buffer> {
	const candidates = override
		? [override]
		: platform === "darwin"
			? [
					"/System/Library/Fonts/Supplemental/Arial.ttf",
					"/Library/Fonts/Arial.ttf",
				]
			: platform === "win32"
				? [
						join(windowsRoot, "Fonts", "arial.ttf"),
						join(windowsRoot, "Fonts", "segoeui.ttf"),
					]
				: [
						"/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
						"/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
						"/usr/share/fonts/TTF/DejaVuSans.ttf",
					];
	for (const candidate of candidates) {
		try {
			return await read(candidate);
		} catch {
			/* Try the next installed font. */
		}
	}
	throw new Error(
		"Native font smoke requires an installed TTF. Set OPEN_QUAKE_SMOKE_FONT to an explicit fixture path.",
	);
}
