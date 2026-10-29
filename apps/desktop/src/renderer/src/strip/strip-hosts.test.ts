// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Option, Schema } from "effect";
import { act, createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { builtinProfiles } from "../../../../../../packages/device/src/profiles/profile-catalog";
import { type Profile, ProfileEnvelope } from "../../../shared/profiles";
import { KeyEditor } from "../keys/KeyEditor";
import { ProfilePreview } from "../profiles/ProfileViews";
import { mount, required } from "../test/mount";
import { TestResizeObserver } from "../test/resize-observer";
import { DeviceScreen } from "../ui/DeviceScreen";
import { StripScreen, StripViewport } from "./StripScreen";

const artwork = "data:image/png;base64,AA==";
const catalog = builtinProfiles("linux");
function profile(id: string): Profile {
	const source = catalog.find((p) => p.id === id);
	if (!source) throw new Error(`Missing ${id}`);
	return {
		...source,
		pages: [
			{
				...source.pages[0],
				keys: source.pages[0].keys.map((k) =>
					k.config.type ? { ...k, config: { ...k.config, icon: artwork } } : k,
				),
			},
		],
	};
}
function envelope(p: Profile): ProfileEnvelope {
	return {
		schemaVersion: 1,
		manager: Option.none(),
		profiles: [p],
		activeByDevice: {},
	};
}
let width = 960,
	height = 240;
beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("quakeAgents", {
		request: async () => ({
			_tag: "failure",
			code: "test",
			message: "No saved models",
		}),
		onSnapshot: () => () => {},
		onProgress: () => () => {},
	});
	vi.stubGlobal("ResizeObserver", TestResizeObserver);
	TestResizeObserver.instances = [];
	width = 960;
	height = 240;
	vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
		function (this: HTMLElement) {
			return this.classList.contains("strip-viewport") ? width : 0;
		},
	);
	vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
		function (this: HTMLElement) {
			return this.classList.contains("strip-viewport") ? height : 0;
		},
	);
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function hosts(p: Profile): ReadonlyArray<readonly [string, ReactNode]> {
	const env = envelope(p),
		encoded = Schema.encodeSync(ProfileEnvelope)(env);
	window.quakeProfiles = {
		read: async () => ({ _tag: "ready", envelope: encoded }),
		onSnapshot: () => () => {},
	};
	window.quakeKeyLibrary = {
		request: async () => ({ _tag: "success", envelope: encoded }),
		onPreview: () => () => {},
		onRuntime: () => () => {},
	};
	return [
		[
			"panel",
			createElement(
				StripViewport,
				null,
				createElement(StripScreen, {
					profiles: { _tag: "ready", envelope: env },
					showEmptyGridDashedBorder: false,
				}),
			),
		],
		["device", createElement(DeviceScreen, { key: "device" })],
		["manager", createElement(ProfilePreview, { profile: p })],
		["editor", createElement(KeyEditor, { key: "editor" })],
	];
}

describe("MGMT-051/056/060 and WIDGETS-011: real strip hosts", () => {
	it.each(["1-2", "1-1", "1-7", "1-3"])(
		"preserves %s artwork, theme, spacing and radii while each host resizes",
		async (id) => {
			const p = profile(id);
			let reference: unknown;
			for (const [name, element] of hosts(p)) {
				const view = await mount(element);
				try {
					const screen = required(
						view.container,
						".strip-screen",
						HTMLDivElement,
					);
					const stage = required(
						view.container,
						".strip-viewport-stage",
						HTMLDivElement,
					);
					const tile = required(screen, '[data-state="tile"]', HTMLDivElement);
					expect(screen.style.width).toBe("1920px");
					expect(screen.style.height).toBe("480px");
					expect(stage.style.transform).toBe(
						"translate(-50%, -50%) scale(0.5)",
					);
					expect(screen.getAttribute("inert") !== null).toBe(name !== "panel");
					const grid = required(screen, ".strip-grid", HTMLDivElement);
					// Same production renderer and source key, including actual artwork and inline geometry.
					const geometry = Array.from(grid.children).map((node) =>
						node.getAttribute("style"),
					);
					if (reference === undefined) reference = geometry;
					else expect(geometry).toEqual(reference);
					if (id === "1-7") {
						expect(tile.style.cssText).toContain("width: 1920px");
						expect(
							required(tile, ".oq-clock", HTMLDivElement).style.width,
						).toBe("1920px");
						expect(tile.querySelector(".strip-tile")).toBeNull();
						expect(tile.style.left).toBe("0px");
					} else {
						expect(tile.style.left).toBe(
							id === "1-1" ? "2px" : id === "1-3" ? "10px" : "12px",
						);
						expect(tile.style.borderRadius).toBe(id === "1-3" ? "0px" : "4px");
						if (id === "1-2")
							expect(required(tile, "img", HTMLImageElement).src).toBe(artwork);
					}
					width = 480;
					height = 200;
					await act(async () => {
						for (const observer of TestResizeObserver.instances)
							observer.resize();
					});
					expect(stage.style.transform).toBe(
						"translate(-50%, -50%) scale(0.25)",
					);
					width = 1200;
					height = 120;
					await act(async () => {
						for (const observer of TestResizeObserver.instances)
							observer.resize();
					});
					expect(stage.style.transform).toBe(
						"translate(-50%, -50%) scale(0.25)",
					);
				} finally {
					await view.unmount();
					width = 960;
					height = 240;
				}
				expect(
					TestResizeObserver.instances.every((o) => o.targets.size === 0),
				).toBe(true);
			}
		},
	);

	it("uses flat filled plates, a pressed accent and one-pixel preview frames without changing tile geometry", async () => {
		const style = document.createElement("style");
		style.textContent =
			":root {--oq-hairline: #26292d;}\n" +
			["strip/strip.css", "keys/keys.css", "profiles/profiles.css"]
				.map((p) => readFileSync(resolve(`src/renderer/src/${p}`), "utf8"))
				.join("\n");
		document.head.append(style);
		const p = profile("1-2");
		const render = (pressed?: string) =>
			createElement(StripScreen, {
				profiles: { _tag: "ready", envelope: envelope(p) },
				showEmptyGridDashedBorder: true,
				pressedKeyCode: pressed,
			});
		const view = await mount(render());
		try {
			const tile = required(
				view.container,
				'[data-state="tile"]',
				HTMLDivElement,
			);
			const geometry = tile.style.cssText;
			expect(getComputedStyle(tile).boxShadow).toContain("1px");
			await view.render(render(tile.dataset.keyCode));
			expect(tile.dataset.pressed).toBe("true");
			expect(getComputedStyle(tile).boxShadow).toContain("2px");
			expect(tile.style.cssText).toBe(geometry);
			for (const [name, element] of hosts(p).filter(
				([name]) => name === "manager" || name === "editor",
			)) {
				await view.render(element);
				const frame = required(
					view.container,
					name === "manager" ? ".profile-preview" : ".keys-preview",
					HTMLElement,
				);
				expect(getComputedStyle(frame).borderTopWidth).toBe("1px");
			}
		} finally {
			await view.unmount();
			style.remove();
		}
	});
});
