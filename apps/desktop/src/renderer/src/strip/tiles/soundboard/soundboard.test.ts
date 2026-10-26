import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { builtinProfiles } from "../../../../../../../../packages/device/src/profiles/profile-catalog";
import {
	mediaSession,
	weatherSettings,
} from "../../../../../main/weather-media/test-fixtures";
import type { ProfileKey } from "../../../../../shared/profiles";
import { stripLayout } from "../../geometry";
import { previewVoiceContext } from "../../overlays/voice/voice-context";
import { type StripTileContext, stripTileFor } from "../../tileRegistry";
import { soundboardOwned } from "./soundboard-state";

vi.mock("../../../weather-media/hooks", () => ({
	rendererWeatherLocale: () => "en",
	useWeatherMedia: () => ({
		snapshot: {
			revision: 1,
			settings: weatherSettings,
			media: { revision: 1, session: mediaSession, error: null },
		},
		client: { control: vi.fn() },
	}),
}));

type Actions = ProfileKey["config"]["actions"];
const preset = [
	{ type: "sound", value: "" },
	{ type: "audioAction", value: 0 },
] as const satisfies Actions;
const config = (actions: Actions = preset, type = "playAudio") => ({
	type,
	actions,
});
const context: StripTileContext = {
	now: undefined,
	hourFormat: "24h",
	voice: previewVoiceContext,
};
const profile = builtinProfiles("darwin").find((entry) => entry.id === "1-6");
if (!profile) throw new Error("Missing built-in DK-Player fixture");
const first = profile.pages[0].keys[0];
if (!first) throw new Error("Missing built-in DK-Player key");
const soundProfile = profile;
const soundKey = first;
function render(actions: Actions, type = "playAudio") {
	const key: ProfileKey = {
		...soundKey,
		config: {
			...soundKey.config,
			type,
			actions,
			size: type === "playAudioLegacy" ? [1, 1] : soundKey.config.size,
		},
	};
	const page = { ...soundProfile.pages[0], keys: [key] };
	const tile = stripLayout(soundProfile, page).tiles[0];
	if (!tile) throw new Error("Missing sound tile");
	return renderToStaticMarkup(
		createElement(stripTileFor(type), { tile, context }),
	);
}

describe("first-release soundboard ownership", () => {
	it("keeps the real built-in preset on native media even with volume/fade edits", () => {
		expect(soundboardOwned(soundKey.config)).toBe(false);
		expect(
			soundboardOwned(
				config([
					...preset,
					{ type: "volume", value: 5 },
					{ type: "audioFade", value: "3-1000" },
				]),
			),
		).toBe(false);
		expect(soundboardOwned(config([], "open"))).toBe(false);
	});
	it.each(
		["a.mp3", " ", "[]", ["x"], [], 42, null, {}, true].map((value) => ({
			value,
		})),
	)("blocks local or malformed sound $value", ({ value }) => {
		expect(soundboardOwned(config([{ type: "sound", value }, preset[1]]))).toBe(
			true,
		);
	});
	it.each([1, 2, 3, 4, 5, 6, 7, "0", null])(
		"blocks non-preset operation %j without needing a file",
		(value) => {
			expect(
				soundboardOwned(config([preset[0], { type: "audioAction", value }])),
			).toBe(true);
		},
	);
	it("blocks missing/duplicate settings and legacy keys", () => {
		for (const actions of [
			[],
			[preset[0]],
			[preset[1]],
			[...preset, preset[0]],
			[...preset, preset[1]],
		])
			expect(soundboardOwned(config(actions))).toBe(true);
		expect(soundboardOwned(config(preset, "playAudioLegacy"))).toBe(true);
	});
});

describe("registered soundboard rendering", () => {
	it.each(["playAudio", "playAudioLegacy"])(
		"labels %s unavailable without private data or controls",
		(type) => {
			const html = render(
				[{ type: "sound", value: "/private/secret.mp3" }, preset[1]],
				type,
			);
			expect(html).toContain('data-testid="soundboard-unavailable"');
			expect(html).toContain(
				'aria-label="Local playlist, not available in this release"',
			);
			expect(html).toMatch(/aria-describedby="[^"]+"/);
			expect(html).not.toMatch(
				/class="oq-player"|<button|data-quake-sub-touch|tabindex|aria-live|role="status"|private|secret\.mp3/,
			);
			if (type === "playAudio") {
				expect(html).toContain("Not available in this release");
				expect(html).toContain("Imported files are kept.");
			} else {
				expect(html).toContain('data-kind="unavailable">Unavailable');
				expect(html).toContain('class="strip-tile"');
			}
		},
	);
	it.each(
		[
			[],
			[preset[0], { type: "audioAction", value: 4 }],
			[{ type: "sound", value: [] }, preset[1]],
		].map((actions) => ({ actions })),
	)(
		"never exposes native controls for malformed settings $actions",
		({ actions }) => {
			expect(render(actions)).toContain('data-testid="soundboard-unavailable"');
			expect(render(actions)).not.toContain("data-quake-sub-touch");
		},
	);
	it("retains the actual native-media card and transport for the exact preset", () => {
		const html = render(soundKey.config.actions);
		expect(html).toContain('data-testid="dk-player"');
		expect(html).toContain("data-quake-sub-touch");
		expect(html).not.toContain("soundboard-unavailable");
	});
});
