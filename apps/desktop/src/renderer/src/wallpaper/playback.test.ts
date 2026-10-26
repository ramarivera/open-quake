import { isValidElement, type ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { defaultClockTile, defaultWallpaper } from "../../../shared/display";
import { WallpaperCanvas } from "./WallpaperCanvas";

vi.mock("react", async (load) => ({
	...(await load<typeof import("react")>()),
	useRef: () => ({ current: null }),
	useMemo: (factory: () => unknown) => factory(),
	useEffect: () => {},
}));

function videoKey(node: ReactNode): string | null | undefined {
	if (Array.isArray(node))
		return node.map(videoKey).find((key) => key !== undefined);
	if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
	return node.type === "video" ? node.key : videoKey(node.props.children);
}
it("remounts an unchanged video URL only when playback identity changes", () => {
	const snapshot = {
		saved: {
			version: 1 as const,
			serial: "A",
			revision: 0,
			clock: defaultClockTile,
			settings: {
				...defaultWallpaper,
				displayMediaList: [
					{
						name: "a.webm",
						type: "video" as const,
						format: "video/webm" as const,
						filePath: `media:${"a".repeat(64)}`,
						duration: 60000,
					},
				],
			},
		},
		asset: {
			_tag: "ready" as const,
			dataUrl: "data:video/webm;base64,YQ==",
			width: 320,
			height: 80,
		},
		recovered: false,
		normalizedFileUrl: false,
		deviceDelivery: "unverified" as const,
		clock: { epochMillis: 0, hour: 0, minute: 0, second: 0 },
		playbackId: 1,
	};
	const key = videoKey(WallpaperCanvas({ snapshot }));
	expect(key).toBeTruthy();
	expect(
		videoKey(WallpaperCanvas({ snapshot: { ...snapshot, playbackId: 2 } })),
	).not.toBe(key);
	expect(
		videoKey(
			WallpaperCanvas({
				snapshot: { ...snapshot, saved: { ...snapshot.saved, revision: 1 } },
			}),
		),
	).toBe(key);
});
