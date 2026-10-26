import { Option } from "effect";
import type { EffectCallback } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyProfileKey } from "../../../../../../packages/device/src/profiles/profile-contracts";
import { stripLayout } from "../strip/geometry";
import { previewVoiceContext } from "../strip/overlays/voice/voice-context";

const hooks = vi.hoisted((): { effects: EffectCallback[] } => ({
	effects: [],
}));
vi.mock("react", async (importOriginal) => {
	const react = await importOriginal<typeof import("react")>();
	return {
		...react,
		useEffect: (effect: EffectCallback) => hooks.effects.push(effect),
		useState: () => [undefined, vi.fn()],
		useRef: () => ({ current: null }),
		useId: () => "tile-lease",
	};
});
vi.mock("../keys/key-locale", () => ({ storedKeyLocale: () => "en" }));

import { ObsTile } from "./ObsTile";

afterEach(() => {
	hooks.effects = [];
	vi.unstubAllGlobals();
});

it.each([true, false])(
	"retries draft targets with interactive=%s and removes the listener on unmount",
	async (interactive) => {
		let committed: (() => void) | undefined;
		const offProfiles = vi.fn();
		const request = vi.fn(async () => ({ type: "error" }));
		vi.stubGlobal("window", {
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			quakeObs: { request, onLive: () => vi.fn() },
			quakeProfiles: {
				onSnapshot: (listener: () => void) => {
					committed = listener;
					return offProfiles;
				},
			},
		});
		vi.stubGlobal("document", {
			hidden: false,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		});
		vi.stubGlobal("IntersectionObserver", undefined);
		const empty = createEmptyProfileKey("1,1");
		const key = {
			...empty,
			config: {
				...empty.config,
				type: "obsScreenshot",
				actions: [{ type: "configData", value: '{"sourceName":"Updated"}' }],
			},
		};
		const tile = stripLayout(
			{ name: "OBS", compatibility: Option.none() },
			{ keys: [key] },
		).tiles[0];
		if (!tile) throw new Error("Missing screenshot tile");
		ObsTile({
			tile,
			context: {
				interactive,
				now: undefined,
				hourFormat: "24h",
				voice: previewVoiceContext,
			},
		});
		const cleanups = hooks.effects.map((effect) => effect());
		await Promise.resolve();
		expect(request).toHaveBeenCalledTimes(1);
		expect(committed).toBeTypeOf("function");
		committed?.();
		expect(request).toHaveBeenCalledTimes(2);
		expect(request.mock.calls[1]).toEqual(request.mock.calls[0]);
		for (const cleanup of cleanups) cleanup?.();
		expect(offProfiles).toHaveBeenCalledOnce();
		expect(request).toHaveBeenLastCalledWith({
			type: "visible",
			lease: "tile-lease",
			tiles: [],
		});
	},
);
