// @vitest-environment happy-dom
import { Option } from "effect";
import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { createEmptyProfileKey } from "../../../../../../packages/device/src/profiles/profile-contracts";
import type { AppLocaleBridge, LocaleSnapshot } from "../../../shared/locale";
import {
	DEFAULT_WEATHER_SETTINGS,
	type WeatherMediaBridge,
} from "../../../shared/weather-media-contracts";
import { mount } from "../../test/dom";
import { AppLocaleProvider } from "../i18n";
import { stripLayout } from "../strip/geometry";
import { previewVoiceContext } from "../strip/overlays/voice/voice-context";
import { stripTileFor } from "../strip/tileRegistry";
import { ClockWeatherCard } from "./ClockCards";

const weather = vi.hoisted(() => {
	const request = vi.fn<WeatherMediaBridge["request"]>(async (command) => {
		if (command._tag === "read")
			return {
				_tag: "snapshot",
				snapshot: {
					revision: 1,
					settings: DEFAULT_WEATHER_SETTINGS,
					media: { revision: 1, session: null, error: null },
				},
			};
		return { _tag: "rejected", reason: "unavailable" };
	});
	vi.stubGlobal("quakeWeatherMedia", {
		request,
		onSnapshot: () => () => {},
	} satisfies WeatherMediaBridge);
	return { request };
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
const content = () => {
	const empty = createEmptyProfileKey("1,1");
	return (
		<>
			{["system", "local"].map((source) => {
				const key = {
					...empty,
					config: {
						...empty.config,
						type: "playAudio",
						display: true,
						size: [5, 2] as const,
						actions: [
							{ type: "sound", value: "" },
							{ type: "audioAction", value: 0 },
							{ type: "musicSource", value: source },
						],
					},
				};
				const tile = stripLayout(
					{ name: "P", compatibility: Option.none() },
					{ keys: [key] },
				).tiles[0];
				if (!tile) throw new Error("missing tile");
				return (
					<div key={source} data-source={source}>
						{createElement(stripTileFor("playAudio"), {
							tile,
							context: {
								now: undefined,
								hourFormat: "24h",
								voice: previewVoiceContext,
								keyTarget: {
									deviceId: "d",
									profileId: "p",
									pageId: "one",
									revision: 1,
								},
							},
						})}
					</div>
				);
			})}
			<ClockWeatherCard
				city="Berlin"
				unit="celsius"
				state={{ kind: "loading" }}
			/>
		</>
	);
};
it("switches mounted system/local media and weather copy through reactive locale before another poll", async () => {
	vi.useFakeTimers();
	let snapshot: LocaleSnapshot = { locale: "en", revision: 0 };
	const listeners = new Set<(next: LocaleSnapshot) => void>();
	const bridge: AppLocaleBridge = {
		read: async () => snapshot,
		set: async (locale) => {
			snapshot = { locale, revision: snapshot.revision + 1 };
			for (const listener of listeners) listener(snapshot);
			return snapshot;
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose: async () => {},
	};
	const view = await mount(
		<AppLocaleProvider bridge={bridge}>{content()}</AppLocaleProvider>,
	);
	try {
		const system = view.host.querySelector('[data-source="system"]');
		const local = view.host.querySelector('[data-source="local"]');
		expect(system?.textContent).toContain("System media");
		expect(local?.textContent).toContain("Not configured");
		const button = system?.querySelector('[data-testid="playStop"]');
		const calls = weather.request.mock.calls.length;
		await act(async () => {
			await bridge.set("de");
		});
		expect(system?.textContent).toContain("Öffnen Sie Ihren Player");
		expect(local?.textContent).toContain("Nicht konfiguriert");
		expect(view.host.querySelector(".oq-weather-card")?.textContent).toContain(
			"Laden...",
		);
		expect(system?.querySelector('[data-testid="playStop"]')).toBe(button);
		expect(weather.request).toHaveBeenCalledTimes(calls);
	} finally {
		await view.close();
	}
});
it("uses an independent German capture context even while the mirrored DOM language is English", async () => {
	document.documentElement.lang = "en";
	const view = await mount(
		<AppLocaleProvider bridge={null} initialLocale="de">
			{content()}
		</AppLocaleProvider>,
	);
	try {
		expect(
			view.host.querySelector('[data-source="system"]')?.textContent,
		).toContain("Öffnen Sie Ihren Player");
		expect(
			view.host.querySelector('[data-source="local"]')?.textContent,
		).toContain("Nicht konfiguriert");
	} finally {
		await view.close();
	}
});
