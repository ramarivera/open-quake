import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
	ClockFiles,
	ClockRoot,
	ClockStore,
	ClockVideoProbe,
} from "../../../main/clock/clock-store";
import { THEME_IDS } from "../../../shared/clock-style";
import { ClockTile } from "../strip/tiles/clock/ClockTile";
import { mediaOf, themeOf } from "../strip/tiles/clock/useClockSettings";

it("SCREEN-123 migrates per-theme media/music into the renderer and cycles with theme-only writes", async () => {
	const themes = {
		season: { kind: "image", path: "/owned/season.gif" },
		cyber: { kind: "video", path: "/owned/cyber.mkv" },
		anime: { kind: "image", path: "/owned/anime.webp" },
		tactical: { kind: "video", path: "/owned/missing.mov" },
		aurora: { kind: "image", path: "/owned/aurora.bmp" },
	};
	const style = {
		background: { mode: "theme", themeId: "season", themes },
		musicEnabled: true,
		updatedAt: 9,
	};
	let text = JSON.stringify({
		version: 1,
		revision: 7,
		keys: [
			{
				keyCode: "1,1",
				config: {
					type: "dkDesktopClock",
					actions: [
						{ type: "clockStyle", value: style },
						{ type: "hourFormat", value: "12h" },
					],
				},
			},
		],
	});
	const runtime = ManagedRuntime.make(
		ClockStore.Default.pipe(
			Layer.provide(
				Layer.mergeAll(
					Layer.succeed(ClockRoot, "/owned"),
					Layer.succeed(ClockFiles, {
						read: (path) =>
							Effect.succeed(
								path.endsWith("clock.json") ? Option.some(text) : Option.none(),
							),
						writeAtomic: (_path, next) =>
							Effect.sync(() => {
								text = next;
							}),
						exists: (path) => Effect.succeed(!path.includes("missing")),
					}),
					Layer.succeed(ClockVideoProbe, {
						duration: () => Effect.succeed(3000),
					}),
				),
			),
		),
	);
	try {
		for (const theme of THEME_IDS) {
			const outcome = await runtime.runPromise(
				ClockStore.setTheme("1,1", theme),
			);
			expect(outcome.ok).toBe(true);
			const snapshot = await runtime.runPromise(ClockStore.read());
			expect(snapshot.musicEnabled).toBe(true);
			expect(snapshot.hourFormat).toBe("12h");
			const html = renderToStaticMarkup(
				createElement(ClockTile, {
					widthPx: 1920,
					heightPx: 480,
					now: new Date(0),
					theme: themeOf(snapshot),
					media: mediaOf(snapshot),
					reducedMotion: true,
				}),
			);
			expect(html).toContain(
				theme === "tactical" ? 'data-source="builtin"' : 'data-source="custom"',
			);
			if (theme === "tactical") expect(html).toContain('data-theme="tactical"');
			const stored = JSON.parse(text);
			const savedStyle = stored.keys[0].config.actions[0].value;
			expect(savedStyle).toEqual({
				...style,
				background: { ...style.background, themeId: theme },
			});
		}
	} finally {
		await runtime.dispose();
	}
});
