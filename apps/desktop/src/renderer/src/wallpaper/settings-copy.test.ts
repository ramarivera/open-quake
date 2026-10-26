import { GTProvider } from "gt-react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { defaultClockTile, defaultWallpaper } from "../../../shared/display";
import { appDictionaries } from "../i18n";
import { type WallpaperController, WallpaperSettings } from "./WallpaperViews";

it.each([
	{ locale: "en", add: "Add Media…", clear: "Remove All" },
	{ locale: "de", add: "Medien hinzufügen…", clear: "Alle entfernen" },
])(
	"labels playlist actions and describes the active media in $locale",
	({ locale, add, clear }) => {
		const wallpaper: WallpaperController = {
			busy: false,
			notice: "",
			request: async () => {},
			snapshot: {
				saved: {
					version: 1,
					serial: "A",
					revision: 1,
					clock: defaultClockTile,
					settings: {
						...defaultWallpaper,
						displayMediaList: ["first.png", "active.png"].map((name, i) => ({
							name,
							type: "image",
							format: "image/png",
							filePath: `media:${String(i).repeat(64)}`,
							duration: 5000,
						})),
					},
				},
				activeIndex: 1,
				asset: {
					_tag: "ready",
					dataUrl: "data:image/png;base64,YQ==",
					width: 320,
					height: 80,
				},
				recovered: false,
				normalizedFileUrl: false,
				deviceDelivery: "unverified",
				clock: { epochMillis: 0, hour: 0, minute: 0, second: 0 },
			},
		};
		const html = renderToStaticMarkup(
			createElement(
				GTProvider,
				{
					locale,
					translations: { en: {}, de: {} },
					dictionaries: appDictionaries,
					_reload: () => {},
				},
				createElement(WallpaperSettings, { wallpaper }),
			),
		);
		expect(html).toContain(`>${add}</button>`);
		expect(html).toContain(`>${clear}</button>`);
		expect(html).toContain('<span aria-live="polite">active.png</span>');
		expect(html).not.toContain('<span aria-live="polite">first.png</span>');
	},
);
