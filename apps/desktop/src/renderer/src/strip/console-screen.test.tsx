// @vitest-environment happy-dom

import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type { KeyRuntimeState } from "../../../shared/key-library";
import {
	createInitialProfileEnvelope,
	type Profile,
} from "../../../shared/profiles";
import { mount, settle } from "../../test/dom";
import { consoleProfile } from "../keys/console-profile";
import { stripLayout } from "./geometry";
import { previewVoiceContext } from "./overlays/voice/voice-context";
import { StripScreen } from "./StripScreen";
import { genericTileMetrics } from "./tileMetrics";
import { ConsoleVolumeTile } from "./tiles/ConsoleVolumeTile";

const originalKeyLibrary = window.quakeKeyLibrary;
let close: (() => Promise<void>) | undefined;
afterEach(async () => {
	await close?.();
	close = undefined;
	window.quakeKeyLibrary = originalKeyLibrary;
	vi.unstubAllGlobals();
});
it("renders only observed volume for the current profile revision and keeps compact clock/input hit regions separate", async () => {
	const profile = consoleProfile("en", "Console");
	const envelope = {
		...createInitialProfileEnvelope(),
		profiles: [profile] as const,
	};
	let publish = (_state: KeyRuntimeState) => {};
	window.quakeKeyLibrary = {
		request: async () => ({ _tag: "success" }),
		onPreview: () => () => {},
		onRuntime: (receive) => {
			publish = receive;
			return () => {};
		},
	};
	const mounted = await mount(
		<StripScreen
			profiles={{ _tag: "ready", envelope }}
			showEmptyGridDashedBorder={false}
		/>,
	);
	close = mounted.close;
	expect(mounted.host.querySelector(".console-volume-value")?.textContent).toBe(
		"—%",
	);
	const reading = {
		deviceId: "desktop-preview",
		profileId: profile.id,
		pageId: "1",
		keyCode: "1,3",
		revision: profile.revision,
		volume: 42,
		muted: false,
	};
	await act(async () => publish(reading));
	await settle(() =>
		expect(
			mounted.host.querySelector(".console-volume-value")?.textContent,
		).toBe("42%"),
	);
	await act(async () =>
		publish({ ...reading, revision: profile.revision + 1, volume: 99 }),
	);
	expect(mounted.host.querySelector(".console-volume-value")?.textContent).toBe(
		"—%",
	);
	const clock = mounted.host.querySelector<HTMLElement>(
		'.strip-slot[data-key-code="1,1"][data-state="tile"]',
	);
	const input = mounted.host.querySelector<HTMLElement>(
		'.strip-slot[data-key-code="1,5"][data-state="tile"]',
	);
	expect(clock?.style.width).toBe("456px");
	expect(input?.style.width).toBe("936px");
	expect(
		mounted.host
			.querySelector(".clawbot-input")
			?.getAttribute("data-horizontal"),
	).toBe("true");
});

it("honors volume title visibility and explicitly saved position, color, size and styles", () => {
	const profile = consoleProfile("en", "Console");
	const tile = stripLayout(profile, profile.pages[0]).tiles.find(
		(candidate) => candidate.type === "vol",
	);
	if (!tile) throw new Error("Missing volume tile");
	const host = document.createElement("div");
	const context = {
		now: undefined,
		hourFormat: "24h" as const,
		voice: previewVoiceContext,
	};
	const paint = (display: boolean, pos: "top" | "mid" | "bot") => {
		const next = {
			...tile,
			key: {
				...tile.key,
				config: {
					...tile.key.config,
					title: {
						...tile.key.config.title,
						text: "Custom volume",
						display,
						pos,
						size: 16,
						color: "#d01234",
						style: "bold|italic|underline",
						userModifiedStyle: true,
					},
				},
			},
		};
		host.innerHTML = renderToStaticMarkup(
			<ConsoleVolumeTile tile={next} context={context} />,
		);
		return host.querySelector<HTMLElement>(".console-volume-title");
	};
	expect(paint(false, "top")).toBeNull();
	expect(host.querySelector("header")?.textContent).not.toContain(
		"Custom volume",
	);
	for (const pos of ["top", "mid", "bot"] as const) {
		const title = paint(true, pos);
		expect(title?.textContent).toBe("Custom volume");
		expect(title?.style.color).toBe("#d01234");
		expect(title?.style.fontSize).toBe("68px");
		expect(title?.style.fontWeight).toBe("700");
		expect(title?.style.fontStyle).toBe("italic");
		expect(title?.style.textDecoration).toBe("underline");
		expect(pos === "bot" ? title?.style.bottom : title?.style.top).toBe(
			pos === "mid" ? "50%" : "41px",
		);
	}
});

it("keeps compact saved volume keys on the icon/title renderer and reserves the readout for a two-by-two bank", () => {
	const profile = consoleProfile("en", "Console");
	const volume = profile.pages[0].keys.find((key) => key.config.type === "vol");
	if (!volume) throw new Error("Missing volume key");
	for (const size of [
		[1, 1],
		[2, 1],
		[1, 2],
		[2, 2],
	] as const) {
		const next: Profile = {
			...profile,
			pages: [
				{
					...profile.pages[0],
					keys: [
						{ ...volume, keyCode: "1,1", config: { ...volume.config, size } },
					],
				},
			],
		};
		const host = document.createElement("div");
		host.innerHTML = renderToStaticMarkup(
			<StripScreen
				profiles={{
					_tag: "ready",
					envelope: { ...createInitialProfileEnvelope(), profiles: [next] },
				}}
				showEmptyGridDashedBorder={false}
			/>,
		);
		const large = size[0] >= 2 && size[1] >= 2;
		expect(!!host.querySelector(".console-volume")).toBe(large);
		expect(!!host.querySelector('.strip-tile[data-type="vol"]')).toBe(!large);
		expect(host.textContent).toContain(volume.config.title.text);
	}
});

it.each([8, 12])(
	"keeps size-%i custom titles clear of artwork on device keys and scaled editor previews",
	(size) => {
		const source = consoleProfile("en", "Console");
		const base = source.pages[0].keys.find((key) => key.config.type === "vol");
		if (!base) throw new Error("Missing volume key");
		for (const pos of ["top", "mid", "bot"] as const) {
			const key = {
				...base,
				keyCode: "1,1",
				config: {
					...base.config,
					icon: "0-56",
					size: [1, 1] as const,
					title: {
						...base.config.title,
						text: "A long custom volume heading",
						size,
						pos,
						userModifiedStyle: true,
					},
				},
			};
			const profile: Profile = {
				...source,
				pages: [{ ...source.pages[0], keys: [key] }],
			};
			const tile = stripLayout(profile, profile.pages[0]).tiles[0];
			if (!tile) throw new Error("Missing custom key");
			const metrics = genericTileMetrics(tile.box, key.config.title);
			for (const scale of [1, 0.5]) {
				const host = document.createElement("div");
				host.innerHTML = renderToStaticMarkup(
					<div
						style={{
							transform: `scale(${scale})`,
							transformOrigin: "top left",
						}}
					>
						<StripScreen
							profiles={{
								_tag: "ready",
								envelope: {
									...createInitialProfileEnvelope(),
									profiles: [profile],
								},
							}}
							showEmptyGridDashedBorder={false}
						/>
					</div>,
				);
				const icon = host.querySelector<HTMLElement>(".strip-tile-icon");
				const title = host.querySelector<HTMLElement>(".strip-tile-title");
				if (!icon || !title)
					throw new Error("Missing rendered artwork or title");
				expect(icon.querySelector("img")).not.toBeNull();
				const top =
					(Number.parseFloat(icon.style.top) / 100) * tile.box.height -
					Number.parseFloat(icon.style.height) / 2;
				const bottom = top + Number.parseFloat(icon.style.height);
				const titleHeight = metrics.fontSize * 1.2 * 2;
				expect(icon.style.transform).toBe("translate(-50%, -50%)");
				if (pos === "top")
					expect(top * scale).toBeGreaterThanOrEqual(
						(metrics.padding + titleHeight + 8) * scale,
					);
				else if (pos === "mid")
					expect(bottom * scale).toBeLessThanOrEqual(
						(tile.box.height / 2 - titleHeight / 2 - 8) * scale,
					);
				else
					expect(bottom * scale).toBeLessThanOrEqual(
						(tile.box.height - metrics.padding - titleHeight - 8) * scale,
					);
				expect(title.textContent).toBe(key.config.title.text);
			}
		}
	},
);

it("keeps hidden-heading artwork unchanged by saved title position or style", () => {
	const source = consoleProfile("en", "Console");
	const base = source.pages[0].keys.find((key) => key.config.type === "vol");
	if (!base) throw new Error("Missing volume key");
	const paint = (pos: "top" | "mid" | "bot", explicit: boolean) => {
		const profile: Profile = {
			...source,
			pages: [
				{
					...source.pages[0],
					keys: [
						{
							...base,
							keyCode: "1,1",
							config: {
								...base.config,
								icon: "0-56",
								size: [1, 1],
								title: {
									...base.config.title,
									display: false,
									pos,
									size: 12,
									userModifiedStyle: explicit,
								},
							},
						},
					],
				},
			],
		};
		const host = document.createElement("div");
		host.innerHTML = renderToStaticMarkup(
			<StripScreen
				profiles={{
					_tag: "ready",
					envelope: { ...createInitialProfileEnvelope(), profiles: [profile] },
				}}
				showEmptyGridDashedBorder={false}
			/>,
		);
		expect(host.querySelector(".strip-tile-title")).toBeNull();
		const icon = host.querySelector<HTMLElement>(".strip-tile-icon");
		if (!icon) throw new Error("Missing artwork");
		expect(icon.querySelector("img")).not.toBeNull();
		return icon.style.cssText;
	};
	const plain = paint("bot", false);
	for (const pos of ["top", "mid", "bot"] as const)
		expect(paint(pos, true)).toBe(plain);
});
