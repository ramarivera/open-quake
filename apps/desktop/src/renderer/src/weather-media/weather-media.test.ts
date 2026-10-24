import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mediaSession } from "../../../main/weather-media/test-fixtures";
import {
	type CityResult,
	DEFAULT_WEATHER_SETTINGS,
	type WeatherMediaSnapshot,
	type WeatherResult,
} from "../../../shared/weather-media-contracts";
import { ClockMusicCard, ClockWeatherCard } from "./ClockCards";
import { type CityStatus, CityVerifier } from "./city-verifier";
import { WeatherMediaClient } from "./client";
import { MediaGuide } from "./guide";
import { needleAngle, PlayerCard } from "./PlayerCard";
import { WeatherRefresh } from "./refresh";

const empty: WeatherResult = { _tag: "empty" };
const initial: WeatherMediaSnapshot = {
	revision: 0,
	settings: DEFAULT_WEATHER_SETTINGS,
	media: { revision: 0, session: null, error: null },
};
afterEach(() => vi.useRealTimers());

describe("visible refresh and query sequencing", () => {
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
		expect(html).toContain("TODAY");
		expect(html).toContain('data-weather-icon="default"');
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
	it("needle clamps progress and returns to rest", () => {
		expect(
			needleAngle({
				...initial.media,
				session: { ...mediaSession, positionMs: 999999 },
			}),
		).toBe(-15);
		expect(
			needleAngle({
				...initial.media,
				session: { ...mediaSession, playing: false },
			}),
		).toBe(25);
	});
});
