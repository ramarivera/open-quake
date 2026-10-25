import { Effect, Layer, ManagedRuntime } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	berlin,
	forecastFixture,
	mediaSession,
	weatherSettings,
} from "../../../main/weather-media/test-fixtures";
import { WeatherNetwork } from "../../../main/weather-media/weather-network";
import { WeatherService } from "../../../main/weather-media/weather-service";
import {
	type CityResult,
	DEFAULT_WEATHER_SETTINGS,
	WEATHER_REFRESH_MS,
	type WeatherMediaSnapshot,
	type WeatherResult,
} from "../../../shared/weather-media-contracts";
import { ClockMusicCard, ClockWeatherCard } from "./ClockCards";
import { type CityStatus, CityVerifier } from "./city-verifier";
import { WeatherMediaClient } from "./client";
import { MediaGuide } from "./guide";
import { formatPlaybackTime, PlayerCard, playbackFraction } from "./PlayerCard";
import { WeatherRefresh } from "./refresh";

const empty: WeatherResult = { _tag: "empty" };
const initial: WeatherMediaSnapshot = {
	revision: 0,
	settings: DEFAULT_WEATHER_SETTINGS,
	media: { revision: 0, session: null, error: null },
};
afterEach(() => vi.useRealTimers());

describe("visible refresh and query sequencing", () => {
	it("refreshes the real service at expiry after delayed forecasts and an early cache hit", async () => {
		vi.useFakeTimers();
		const network = vi.fn(() =>
			Effect.promise(
				() =>
					new Promise<unknown>((resolve) =>
						setTimeout(() => resolve(forecastFixture), 1200),
					),
			),
		);
		const runtime = ManagedRuntime.make(
			WeatherService.Default.pipe(
				Layer.provide(
					Layer.succeed(WeatherNetwork, {
						json: () => Effect.suspend(network),
					}),
				),
			),
		);
		const load = () =>
			runtime.runPromise(WeatherService.fetchWeather(weatherSettings, "en"));
		const publish = vi.fn();
		const refresh = new WeatherRefresh(
			load,
			publish,
			() => true,
			() => false,
		);
		try {
			await vi.advanceTimersByTimeAsync(800);
			expect(network).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(1200);
			expect(publish).toHaveBeenLastCalledWith(
				expect.objectContaining({
					_tag: "ready",
					refreshAfterMs: WEATHER_REFRESH_MS,
				}),
			);
			// Visibility causes a cache hit 51 ms before expiry. It must keep that expiry.
			await vi.advanceTimersByTimeAsync(WEATHER_REFRESH_MS - 101);
			refresh.visibilityChanged();
			await vi.advanceTimersByTimeAsync(50);
			expect(network).toHaveBeenCalledTimes(1);
			expect(publish).toHaveBeenLastCalledWith(
				expect.objectContaining({ _tag: "ready", refreshAfterMs: 51 }),
			);
			await vi.advanceTimersByTimeAsync(50);
			expect(network).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(1);
			expect(network).toHaveBeenCalledTimes(2);
			await vi.advanceTimersByTimeAsync(1200);
			expect(publish).toHaveBeenLastCalledWith(
				expect.objectContaining({
					_tag: "ready",
					refreshAfterMs: WEATHER_REFRESH_MS,
				}),
			);
		} finally {
			refresh.dispose();
			await runtime.dispose();
		}
		expect(vi.getTimerCount()).toBe(0);
	});
	it("starts at 800ms, skips hidden intervals, refreshes on visibility, coalesces config changes and disposes", async () => {
		vi.useFakeTimers();
		let visible = true;
		let finish: ((value: WeatherResult) => void) | undefined;
		const load = vi.fn(
			() =>
				new Promise<WeatherResult>((resolve) => {
					finish = resolve;
				}),
		);
		const publish = vi.fn();
		const refresh = new WeatherRefresh(
			load,
			publish,
			() => visible,
			() => false,
		);
		await vi.advanceTimersByTimeAsync(799);
		expect(load).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(load).toHaveBeenCalledTimes(1);
		refresh.changed();
		refresh.changed();
		await vi.advanceTimersByTimeAsync(50);
		expect(load).toHaveBeenCalledTimes(1);
		finish?.(empty);
		await vi.advanceTimersByTimeAsync(50);
		expect(load).toHaveBeenCalledTimes(2);
		finish?.(empty);
		await vi.advanceTimersByTimeAsync(0);
		visible = false;
		await vi.advanceTimersByTimeAsync(30 * 60_000);
		expect(load).toHaveBeenCalledTimes(2);
		visible = true;
		refresh.visibilityChanged();
		await vi.advanceTimersByTimeAsync(50);
		expect(load).toHaveBeenCalledTimes(3);
		refresh.dispose();
		finish?.(empty);
		await vi.advanceTimersByTimeAsync(60 * 60_000);
		expect(load).toHaveBeenCalledTimes(3);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("retries failed auto location once after 120s", async () => {
		vi.useFakeTimers();
		const load = vi.fn(
			async (): Promise<WeatherResult> => ({
				_tag: "error",
				reason: "unavailable",
			}),
		);
		const refresh = new WeatherRefresh(
			load,
			vi.fn(),
			() => true,
			() => true,
		);
		await vi.advanceTimersByTimeAsync(800);
		expect(load).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(120_000);
		expect(load).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(120_000);
		expect(load).toHaveBeenCalledTimes(2);
		refresh.dispose();
	});
	it("restores one 120s retry after recovery, keeps normal expiry and stops hidden or disposed work", async () => {
		vi.useFakeTimers();
		let visible = true;
		const failure: WeatherResult = { _tag: "error", reason: "unavailable" };
		const ready: WeatherResult = {
			_tag: "ready",
			data: {
				city: "Berlin",
				temperature: 12,
				high: 15,
				low: 7,
				weatherCode: 2,
				description: "Partly cloudy",
				stale: false,
				provider: "open-meteo",
			},
			refreshAfterMs: WEATHER_REFRESH_MS,
		};
		const load = vi.fn(async (): Promise<WeatherResult> => failure);
		load.mockResolvedValueOnce(failure).mockResolvedValueOnce(ready);
		const publish = vi.fn();
		const refresh = new WeatherRefresh(
			load,
			publish,
			() => visible,
			() => true,
		);
		try {
			await vi.advanceTimersByTimeAsync(800);
			expect(load).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(119_999);
			expect(load).toHaveBeenCalledTimes(1);
			await vi.advanceTimersByTimeAsync(1);
			expect(publish).toHaveBeenLastCalledWith(ready);
			await vi.advanceTimersByTimeAsync(WEATHER_REFRESH_MS - 1);
			expect(load).toHaveBeenCalledTimes(2);
			await vi.advanceTimersByTimeAsync(1);
			expect(publish).toHaveBeenLastCalledWith(failure);
			expect(load).toHaveBeenCalledTimes(3);
			await vi.advanceTimersByTimeAsync(119_999);
			expect(load).toHaveBeenCalledTimes(3);
			await vi.advanceTimersByTimeAsync(1);
			expect(load).toHaveBeenCalledTimes(4);
			await vi.advanceTimersByTimeAsync(WEATHER_REFRESH_MS - 1);
			expect(load).toHaveBeenCalledTimes(4);
			await vi.advanceTimersByTimeAsync(1);
			expect(load).toHaveBeenCalledTimes(5);
			visible = false;
			await vi.advanceTimersByTimeAsync(WEATHER_REFRESH_MS);
			expect(load).toHaveBeenCalledTimes(5);
			expect(vi.getTimerCount()).toBe(0);
			visible = true;
			refresh.visibilityChanged();
			await vi.advanceTimersByTimeAsync(50);
			expect(load).toHaveBeenCalledTimes(6);
		} finally {
			refresh.dispose();
		}
		const calls = publish.mock.calls.length;
		refresh.changed();
		refresh.visibilityChanged();
		await vi.advanceTimersByTimeAsync(WEATHER_REFRESH_MS);
		expect(load).toHaveBeenCalledTimes(6);
		expect(publish).toHaveBeenCalledTimes(calls);
		expect(vi.getTimerCount()).toBe(0);
	});
	for (const query of [", DE", " A, DE ", "123!, FR", "京, CN"]) {
		it(`rejects invalid city part ${query} before renderer search`, async () => {
			vi.useFakeTimers();
			const search = vi.fn(
				async (): Promise<CityResult> => ({ _tag: "network" }),
			);
			const publish = vi.fn();
			const settled = vi.fn();
			const verifier = new CityVerifier(search, publish, settled);
			verifier.update(query);
			await vi.advanceTimersByTimeAsync(599);
			expect(settled).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1);
			expect(search).not.toHaveBeenCalled();
			expect(publish).toHaveBeenLastCalledWith({ _tag: "not-found" });
			expect(settled).toHaveBeenCalledExactlyOnceWith(query, {
				_tag: "not-found",
			});
			verifier.dispose();
			expect(vi.getTimerCount()).toBe(0);
		});
	}
	for (const query of ["東京, JP", "北京, CN", "London, UK", "New York, US"]) {
		it(`verifies valid city part ${query} through the renderer`, async () => {
			vi.useFakeTimers();
			const result: CityResult = { _tag: "matched", location: berlin };
			const search = vi.fn(async () => result);
			const settled = vi.fn();
			const verifier = new CityVerifier(search, vi.fn(), settled);
			verifier.update(query);
			await vi.advanceTimersByTimeAsync(600);
			expect(search).toHaveBeenCalledExactlyOnceWith(query);
			expect(settled).toHaveBeenCalledExactlyOnceWith(query, result);
			verifier.dispose();
		});
	}
	it("debounces verification and drops old results and disposed work", async () => {
		vi.useFakeTimers();
		const pending = new Map<string, (result: CityResult) => void>();
		const statuses: CityStatus[] = [];
		const matched = vi.fn();
		const search = vi.fn(
			(query: string) =>
				new Promise<CityResult>((resolve) => pending.set(query, resolve)),
		);
		const verifier = new CityVerifier(
			search,
			(status) => statuses.push(status),
			matched,
		);
		verifier.update("Berlin");
		await vi.advanceTimersByTimeAsync(600);
		verifier.update("Paris");
		await vi.advanceTimersByTimeAsync(600);
		pending.get("Berlin")?.({
			_tag: "matched",
			location: {
				lat: 1,
				lon: 2,
				name: "Berlin",
				country: "DE",
				sourceCity: "Berlin",
			},
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(matched).not.toHaveBeenCalled();
		pending.get("Paris")?.({ _tag: "not-found" });
		await vi.advanceTimersByTimeAsync(0);
		expect(statuses.at(-1)).toEqual({ _tag: "not-found" });
		verifier.update("42!");
		await vi.advanceTimersByTimeAsync(600);
		expect(search).toHaveBeenCalledTimes(2);
		verifier.update("London");
		verifier.dispose();
		await vi.advanceTimersByTimeAsync(600);
		expect(search).toHaveBeenCalledTimes(2);
	});
	it("settles only the final city with its result and commits clearing or invalid input after idle", async () => {
		vi.useFakeTimers();
		const result: CityResult = {
			_tag: "matched",
			location: weatherSettings.location ?? {
				lat: 0,
				lon: 0,
				name: "Berlin",
				country: "DE",
				sourceCity: "Berlin",
			},
		};
		const search = vi.fn(async () => result);
		const settled = vi.fn();
		const verifier = new CityVerifier(search, vi.fn(), settled);
		for (const query of ["B", "Be", "Ber", "Berlin"]) {
			verifier.update(query);
			await vi.advanceTimersByTimeAsync(150);
			expect(search).not.toHaveBeenCalled();
			expect(settled).not.toHaveBeenCalled();
		}
		await vi.advanceTimersByTimeAsync(450);
		expect(search).toHaveBeenCalledExactlyOnceWith("Berlin");
		expect(settled).toHaveBeenCalledExactlyOnceWith("Berlin", result);
		verifier.update("");
		await vi.advanceTimersByTimeAsync(599);
		expect(settled).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(settled).toHaveBeenLastCalledWith("", null);
		verifier.update("42!");
		await vi.advanceTimersByTimeAsync(600);
		expect(settled).toHaveBeenLastCalledWith("42!", { _tag: "not-found" });
		expect(search).toHaveBeenCalledTimes(1);
		verifier.dispose();
	});
});

it("guide hides at 4.5s, suppresses track-change gaps, dismisses on session and cleans timers", async () => {
	vi.useFakeTimers();
	const publish = vi.fn();
	const guide = new MediaGuide(publish);
	guide.update(false);
	expect(publish).toHaveBeenLastCalledWith(true);
	await vi.advanceTimersByTimeAsync(4500);
	expect(publish).toHaveBeenLastCalledWith(false);
	guide.update(true);
	guide.update(false);
	await vi.advanceTimersByTimeAsync(2999);
	expect(publish).toHaveBeenLastCalledWith(false);
	guide.update(true);
	await vi.advanceTimersByTimeAsync(1);
	expect(publish).toHaveBeenLastCalledWith(false);
	guide.update(false);
	await vi.advanceTimersByTimeAsync(3000);
	expect(publish).toHaveBeenLastCalledWith(true);
	guide.dispose();
	expect(vi.getTimerCount()).toBe(0);
});

it("client subscribes before read, retains newer settings/media, composes writes, reconciles rejected controls and unsubscribes", async () => {
	let listener: ((value: unknown) => void) | undefined;
	const off = vi.fn();
	let state = initial;
	const client = new WeatherMediaClient({
		onSnapshot: (callback) => {
			listener = callback;
			return off;
		},
		request: async (command) => {
			if (command._tag === "configure")
				state = {
					...state,
					revision: state.revision + 1,
					settings: command.settings,
				};
			if (command._tag === "media")
				return {
					_tag: "control",
					accepted: false,
					media: { ...initial.media, revision: 10 },
				};
			return { _tag: "snapshot", snapshot: state };
		},
	});
	const unsubscribe = client.subscribe(vi.fn());
	await Promise.resolve();
	await Promise.resolve();
	await Promise.all([
		client.configure({ enabled: true }),
		client.configure({ city: "Berlin" }),
	]);
	expect(client.getSnapshot()?.settings).toMatchObject({
		enabled: true,
		city: "Berlin",
	});
	listener?.({
		...initial,
		media: { ...initial.media, revision: 9, session: mediaSession },
	});
	expect(client.getSnapshot()?.settings.city).toBe("Berlin");
	expect(client.getSnapshot()?.media.session?.title).toBe(mediaSession.title);
	expect(await client.control("toggle")).toBe(false);
	expect(client.getSnapshot()?.media.revision).toBe(10);
	unsubscribe();
	expect(off).toHaveBeenCalledOnce();
});

describe("real card render states", () => {
	it("weather keeps placeholders, WMO icon, units and errors", () => {
		const html = renderToStaticMarkup(
			createElement(ClockWeatherCard, {
				city: "Berlin",
				unit: "celsius",
				state: { kind: "error", reason: "city-not-found" },
			}),
		);
		expect(html).toContain("City not found");
		expect(html).toContain("--");
		expect(html).toContain("<span>L</span> --°");
		expect(html).toContain('data-weather-icon="default"');
	});
	it("provider outages show Weather unavailable while keeping the valid city and placeholders", () => {
		const html = renderToStaticMarkup(
			createElement(ClockWeatherCard, {
				city: "Berlin",
				unit: "celsius",
				state: { kind: "error", reason: "unavailable" },
			}),
		);
		expect(html).toContain("Weather unavailable");
		expect(html).toContain("Berlin");
		expect(html).toContain("--");
		expect(html).not.toContain("Try entering city");
		expect(html).not.toContain("City not found");
	});
	for (const status of ["playing", "paused", "idle", "unavailable"]) {
		it(`clock and player render ${status} from the same snapshot`, () => {
			const snapshot = {
				revision: 1,
				session:
					status === "idle" || status === "unavailable"
						? null
						: { ...mediaSession, playing: status === "playing" },
				error: status === "unavailable" ? "MEDIAREMOTE_UNAVAILABLE" : null,
			} satisfies WeatherMediaSnapshot["media"];
			const control = async () => true;
			const clock = renderToStaticMarkup(
				createElement(ClockMusicCard, { snapshot, control }),
			);
			const player = renderToStaticMarkup(
				createElement(PlayerCard, {
					widthPx: 1920,
					heightPx: 480,
					snapshot,
					control,
					volumeOverlay: createElement("i", {}, "knob owner"),
				}),
			);
			expect(clock).toContain(`data-state="${status}"`);
			expect(player).toContain(`data-state="${status}"`);
			expect(player).toContain("knob owner");
			if (snapshot.session) {
				expect(clock).toContain(mediaSession.title);
				expect(player).toContain(mediaSession.title);
			}
			if (status === "unavailable")
				expect(clock.match(/disabled=""/g)).toHaveLength(3);
		});
	}
	it("progress clamps to the known duration and is absent without one", () => {
		expect(
			playbackFraction({
				...initial.media,
				session: { ...mediaSession, positionMs: 999999 },
			}),
		).toBe(1);
		expect(
			playbackFraction({
				...initial.media,
				session: { ...mediaSession, durationMs: null },
			}),
		).toBeUndefined();
		expect(formatPlaybackTime(65_400)).toBe("1:05");
		expect(formatPlaybackTime(3_725_000)).toBe("1:02:05");
	});
	it("player draws no turntable and keeps one accent primary control", () => {
		const html = renderToStaticMarkup(
			createElement(PlayerCard, {
				widthPx: 1920,
				heightPx: 480,
				snapshot: { revision: 1, session: mediaSession, error: null },
				control: async () => true,
			}),
		);
		expect(html).not.toMatch(/platter|oq-player-arm|grooves|textPath/);
		expect(html.match(/oq-player-main/g)).toHaveLength(1);
		expect(html).toContain('role="progressbar"');
	});
});
