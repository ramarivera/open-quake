import { createHash } from "node:crypto";
import type { DisplayMedia, WallpaperSettings } from "../../shared/display";
import { defaultWallpaper } from "../../shared/display";
import media from "./factory-media.json";

// Original procedural VP9 animations, five seconds each, no audio track.
// Embedded bytes keep development and packaged builds on the same resource path.
const pack = media.map(({ name, base64 }) => {
	const bytes = Buffer.from(base64, "base64");
	return {
		bytes,
		item: {
			name: `${name}.webm`,
			filePath: `media:${createHash("sha256").update(bytes).digest("hex")}`,
			type: "video",
			format: "video/webm",
			duration: 5000,
		} satisfies DisplayMedia,
	};
});
export const factoryWallpaper: WallpaperSettings = {
	...defaultWallpaper,
	displayMediaList: pack.map(({ item }) => item),
};
export function factoryMedia(reference: string): Buffer | undefined {
	return pack.find(({ item }) => item.filePath === reference)?.bytes;
}
