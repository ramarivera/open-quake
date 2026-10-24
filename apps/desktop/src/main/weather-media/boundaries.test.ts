import { mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Layer, ManagedRuntime, Schema } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	DEFAULT_WEATHER_SETTINGS,
	ForecastUrl,
	SafeCoverUrl,
} from "../../shared/weather-media-contracts";
import {
	WeatherNetworkFailed,
	WeatherResponseInvalid,
} from "../../shared/weather-media-errors";
import { WeatherMediaController } from "./controller";
import { canRequestWeatherMedia } from "./index";
import {
	WeatherSettingsRepository,
	weatherSettingsLive,
} from "./settings-repository";
import { systemMediaStub } from "./system-media";
import { weatherSettings } from "./test-fixtures";
import { WeatherNetwork, weatherNetworkLive } from "./weather-network";

vi.mock("node:fs/promises", { spy: true });
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});
describe("IO and authorization boundaries", () => {
	it("rejects redirects/status failures, malformed JSON and oversized HTTP using a fake fetch", async () => {
		for (const response of [
			new Response("error", { status: 502 }),
			new Response("not json"),
			new Response("x".repeat(1_048_577)),
		]) {
			const fetchFake = vi.fn(async () => response);
			vi.stubGlobal("fetch", fetchFake);
			const result = await Effect.runPromise(
				Effect.either(
					WeatherNetwork.pipe(
						Effect.flatMap((network) =>
							network.json("https://api.open-meteo.com/"),
						),
						Effect.provide(weatherNetworkLive),
					),
				),
			);
			expect(Either.isLeft(result)).toBe(true);
			if (Either.isLeft(result))
				expect(result.left.code).toBe("QUAKE.WEATHER.NETWORK_FAILED");
			expect(fetchFake).toHaveBeenCalledWith(
				"https://api.open-meteo.com/",
				expect.objectContaining({
					redirect: "error",
					signal: expect.any(AbortSignal),
				}),
			);
		}
	});
	it("retains original errors privately and exposes scrubbed stable identity", () => {
		const original = Object.assign(
			new Error("token=private-secret /Users/private/file"),
			{ code: "ETIMEDOUT" },
		);
		for (const error of [
			WeatherNetworkFailed.fromCause(original),
			WeatherResponseInvalid.fromCause(original),
		]) {
			expect(error.originalCause).toBe(original);
			expect(JSON.stringify(error)).not.toContain("private-secret");
			expect(JSON.stringify(error)).not.toContain("/Users/private");
			expect(Object.keys(error)).not.toContain("originalCause");
		}
	});
	it("keeps native HTTP timeouts distinct from network failure", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new DOMException("deadline", "TimeoutError");
			}),
		);
		const result = await Effect.runPromise(
			Effect.either(
				WeatherNetwork.pipe(
					Effect.flatMap((network) =>
						network.json("https://api.open-meteo.com/"),
					),
					Effect.provide(weatherNetworkLive),
				),
			),
		);
		expect(Either.isLeft(result)).toBe(true);
		if (Either.isLeft(result))
			expect(result.left.code).toBe("QUAKE.WEATHER.REQUEST_TIMED_OUT");
	});
	it("allows only exact renderer and management-only writes, rejects unsafe URLs and covers", () => {
		const renderer = "file:///app/index.html";
		expect(
			canRequestWeatherMedia(
				`${renderer}?surface=panel`,
				renderer,
				{ _tag: "read" },
				false,
			),
		).toBe(true);
		expect(
			canRequestWeatherMedia(
				`${renderer}?surface=management`,
				renderer,
				{ _tag: "configure", settings: DEFAULT_WEATHER_SETTINGS },
				false,
			),
		).toBe(false);
		expect(
			canRequestWeatherMedia(
				"https://evil.example/index.html",
				renderer,
				{ _tag: "read" },
				true,
			),
		).toBe(false);
		expect(
			canRequestWeatherMedia(
				`${renderer}.evil`,
				renderer,
				{ _tag: "read" },
				true,
			),
		).toBe(false);
		for (const value of [
			"file:///secret",
			"https://user:pass@example.com",
			"javascript:alert(1)",
		])
			expect(Schema.is(ForecastUrl)(value)).toBe(false);
		expect(Schema.is(SafeCoverUrl)("https://external.example/cover.png")).toBe(
			false,
		);
		expect(Schema.is(SafeCoverUrl)("data:image/svg+xml;base64,AAAA")).toBe(
			false,
		);
	});
	it("persists atomically, keeps old disk and controller state after a failed rename", async () => {
		const root = await mkdtemp(join(tmpdir(), "weather-store-"));
		const runtime = ManagedRuntime.make(
			WeatherMediaController.Default.pipe(
				Layer.provide(
					Layer.mergeAll(
						weatherSettingsLive(root),
						systemMediaStub("darwin"),
						Layer.succeed(WeatherNetwork, {
							json: () => Effect.die("network must not run"),
						}),
					),
				),
			),
		);
		try {
			await runtime.runPromise(
				WeatherMediaController.request({
					_tag: "configure",
					settings: weatherSettings,
				}),
			);
			vi.mocked(rename).mockRejectedValueOnce(
				Object.assign(new Error("permission"), { code: "EACCES" }),
			);
			const reply = await runtime.runPromise(
				WeatherMediaController.request({
					_tag: "configure",
					settings: { ...weatherSettings, city: "Paris" },
				}),
			);
			expect(reply).toMatchObject({
				_tag: "failure",
				code: "QUAKE.WEATHER.PERSISTENCE_FAILED",
			});
			expect(
				(await runtime.runPromise(WeatherMediaController.read())).settings.city,
			).toBe("Berlin");
			expect(
				JSON.parse(
					await readFile(join(root, "weather-media-v1/settings.json"), "utf8"),
				),
			).toMatchObject({ city: "Berlin" });
			const loaded = await Effect.runPromise(
				WeatherSettingsRepository.pipe(
					Effect.flatMap((repository) => repository.load()),
					Effect.provide(weatherSettingsLive(root)),
				),
			);
			expect(loaded.city).toBe("Berlin");
		} finally {
			await runtime.dispose();
			await rm(root, { recursive: true, force: true });
		}
	});
});
