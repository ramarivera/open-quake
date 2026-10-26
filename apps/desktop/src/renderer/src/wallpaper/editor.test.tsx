// @vitest-environment happy-dom
import { GTProvider } from "gt-react";
import { expect, it, vi } from "vitest";
import { defaultClockTile, defaultWallpaper } from "../../../shared/display";
import type { WallpaperCommand } from "../../../shared/wallpaper-contracts";
import { button, click, input, mount, query } from "../../test/dom";
import { appDictionaries } from "../i18n";
import { type WallpaperController, WallpaperSettings } from "./WallpaperViews";

it("MGMT-098/250/286 hosts selected-serial wallpaper Save, Cancel and confirmed factory reset independently", async () => {
	const calls: WallpaperCommand[] = [];
	const controller = (serial: string): WallpaperController => ({
		busy: false,
		notice: "",
		request: async (command) => {
			calls.push(command);
		},
		snapshot: {
			saved: {
				version: 1,
				serial,
				revision: 7,
				settings: defaultWallpaper,
				clock: defaultClockTile,
			},
			asset: { _tag: "empty" },
			clock: { epochMillis: 0, hour: 0, minute: 0, second: 0 },
			recovered: false,
			normalizedFileUrl: false,
			deviceDelivery: "unverified",
		},
	});
	const view = (serial: string) => (
		<GTProvider
			locale="en"
			translations={{ en: {}, de: {} }}
			dictionaries={appDictionaries}
			_reload={() => {}}
		>
			<WallpaperSettings wallpaper={controller(serial)} embedded />
		</GTProvider>
	);
	const mounted = await mount(view("A"));
	const method = () =>
		query(
			mounted.host,
			'select[aria-label="Background method"]',
			HTMLSelectElement,
		);
	await input(method(), "transparent");
	expect(calls).toEqual([]);
	await click(button(mounted.host, "Cancel"));
	expect(method().value).toBe("custom");
	await input(method(), "transparent");
	await click(button(mounted.host, "Save"));
	expect(calls).toEqual([
		expect.objectContaining({
			_tag: "save",
			serial: "A",
			revision: 7,
			settings: expect.objectContaining({ isTransparent: true }),
		}),
	]);
	calls.length = 0;
	await input(method(), "transparent");
	await mounted.render(view("B"));
	expect(method().value).toBe("custom");
	await click(button(mounted.host, "Restore factory"));
	expect(calls).toEqual([]);
	expect(mounted.host.querySelector('[role="alertdialog"]')).not.toBeNull();
	const dialog = mounted.host.querySelector('[role="alertdialog"]');
	if (!dialog) throw new Error("Missing confirmation");
	await click(button(dialog, "Cancel"));
	expect(calls).toEqual([]);
	await click(button(mounted.host, "Restore factory"));
	await click(button(mounted.host, "Restore"));
	expect(calls).toEqual([{ _tag: "factory", serial: "B", revision: 7 }]);
	await mounted.close();
	vi.unstubAllGlobals();
});

it("WIDGETS-128 releases picked assets on Cancel and unmount using separate draft identities", async () => {
	const calls: WallpaperCommand[] = [];
	const snapshot = {
		saved: {
			version: 1 as const,
			serial: "A",
			revision: 0,
			clock: defaultClockTile,
			settings: defaultWallpaper,
		},
		asset: { _tag: "empty" as const },
		clock: { epochMillis: 0, hour: 0, minute: 0, second: 0 },
		recovered: false,
		normalizedFileUrl: false,
		deviceDelivery: "unverified" as const,
	};
	window.quakeWallpaper = {
		request: async (command) => {
			calls.push(command);
			return { _tag: "success", snapshot };
		},
		onSnapshot: () => () => {},
		onClock: () => () => {},
	};
	const mounted = await mount(
		<GTProvider
			locale="en"
			translations={{ en: {}, de: {} }}
			dictionaries={appDictionaries}
			_reload={() => {}}
		>
			<WallpaperSettings
				embedded
				wallpaper={{
					snapshot,
					busy: false,
					notice: "",
					request: async () => {},
				}}
			/>
		</GTProvider>,
	);
	try {
		await click(button(mounted.host, "Add Media…"));
		const first = calls[0];
		expect(first).toMatchObject({
			_tag: "pick",
			serial: "A",
			draftId: expect.any(String),
		});
		await click(button(mounted.host, "Cancel"));
		expect(calls[1]).toEqual({ ...first, _tag: "discard" });
		await click(button(mounted.host, "Add Media…"));
		expect(calls[2]).not.toEqual(first);
		await mounted.close();
		expect(calls[3]).toEqual({ ...calls[2], _tag: "discard" });
	} finally {
		delete window.quakeWallpaper;
	}
});
