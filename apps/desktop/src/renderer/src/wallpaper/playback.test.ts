import { isValidElement, type ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { defaultClockTile, defaultWallpaper } from "../../../shared/display";
import { WallpaperCanvas } from "./WallpaperCanvas";

const hooks = vi.hoisted(
	(): {
		video: { currentTime: number } | null;
		effects: Array<() => undefined | (() => void)>;
	} => ({ video: null, effects: [] }),
);

vi.mock("react", async (load) => ({
	...(await load<typeof import("react")>()),
	useRef: () => ({ current: hooks.video }),
	useMemo: (factory: () => unknown) => factory(),
	useEffect: (effect: () => undefined | (() => void)) =>
		hooks.effects.push(effect),
}));

function videoKey(node: ReactNode): string | null | undefined {
	if (Array.isArray(node))
		return node.map(videoKey).find((key) => key !== undefined);
	if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
	return node.type === "video" ? node.key : videoKey(node.props.children);
}
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
it("remounts an unchanged video URL only when playback identity changes", () => {
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

for (const singleton of [false, true]) {
	it(`seeks a late-mounted ${singleton ? "singleton loop" : "playlist video"} after metadata arrives`, () => {
		let now = 50000;
		vi.spyOn(Date, "now").mockImplementation(() => now);
		const listeners = new Map<string, () => void>();
		const first = snapshot.saved.settings.displayMediaList[0];
		if (!first) throw new Error("Video fixture missing");
		const video = {
			currentTime: 0,
			duration: 60,
			readyState: 0,
			play: vi.fn(async () => {}),
			pause: vi.fn(),
			removeAttribute: vi.fn(),
			load: vi.fn(),
			addEventListener: vi.fn((name: string, callback: () => void) =>
				listeners.set(name, callback),
			),
			removeEventListener: vi.fn((name: string) => listeners.delete(name)),
		};
		// A media-element fake exercises the component's mount and cleanup effects.
		hooks.video = video;
		hooks.effects = [];
		WallpaperCanvas({
			snapshot: {
				...snapshot,
				playbackStartedAt: 0,
				saved: {
					...snapshot.saved,
					settings: {
						...snapshot.saved.settings,
						displayMediaList: singleton
							? snapshot.saved.settings.displayMediaList
							: [
									...snapshot.saved.settings.displayMediaList,
									{
										...first,
										filePath: `media:${"b".repeat(64)}`,
									},
								],
					},
				},
			},
		});
		const cleanups = hooks.effects.map((effect) => effect());
		expect(hooks.video?.currentTime).toBe(0);
		now = singleton ? 125000 : 51000;
		listeners.get("loadedmetadata")?.();
		expect(hooks.video?.currentTime).toBe(singleton ? 5 : 51);
		expect(video.play).toHaveBeenCalledOnce();
		for (const cleanup of cleanups) cleanup?.();
		expect(listeners.size).toBe(0);
		expect(video.pause).toHaveBeenCalledOnce();
		hooks.video = null;
	});
}
