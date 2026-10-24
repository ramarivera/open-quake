/** Hidden native Electron smoke. Production renderer/preload, fake IO, no HID. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { app, BrowserWindow } from "electron";
import {
	WEATHER_MEDIA_CHANGED,
	type WeatherMediaCommand,
	WeatherMediaReply,
} from "../../shared/weather-media-contracts";
import { WeatherNetworkFailed } from "../../shared/weather-media-errors";
import { ClockLive, registerClock, registerClockScheme } from "../clock";
import { registerKnob } from "../knob";
import { DeviceLifecycle } from "../lifecycle/lifecycle-service";
import { registerLifecycle } from "../lifecycle/registration";
import { registerMaintenance } from "../maintenance";
import { MediaLive, registerMedia } from "../media";
import { registerMonitor } from "../monitor";
import { ProfilesLive, registerProfiles } from "../profiles/profile-ipc";
import { clockProfile, stripFixtureEnvelope } from "../test/strip-fixtures";
import { createToneRecorder, registerVoiceSurface } from "../voice";
import { waitForVoice } from "../voice/smoke-wait";
import { WeatherMediaController } from "./controller";
import { registerWeatherMedia } from "./index";
import { weatherSettingsLive } from "./settings-repository";
import {
	type NativeMediaAction,
	type NativeMediaState,
	SystemMediaAdapter,
} from "./system-media";
import {
	cityFixture,
	forecastFixture,
	mediaSession,
	weatherSettings,
} from "./test-fixtures";
import { WeatherNetwork } from "./weather-network";

assert.equal(
	process.env.OPEN_QUAKE_MOCK_DEVICE,
	"1",
	"native smoke requires mock-device mode",
);
const artifactsArgument = process.argv[2] ?? "";
assert(artifactsArgument.trim(), "pass a non-empty artifacts directory");
const artifacts = resolve(artifactsArgument);
registerClockScheme();
mkdirSync(artifacts, { recursive: true });
const base = mkdtempSync(join(artifacts, "native-user-data-"));
app.setPath("userData", base);
const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));
const evaluate = (window: BrowserWindow, script: string): Promise<unknown> =>
	window.webContents.executeJavaScript(script);
async function waitFor(
	window: BrowserWindow,
	expression: string,
	description: string,
): Promise<void> {
	const end = Date.now() + 10_000;
	while (Date.now() < end) {
		if (await evaluate(window, expression)) return;
		await sleep(50);
	}
	throw new Error(`Timed out: ${description}`);
}
async function request(window: BrowserWindow, command: WeatherMediaCommand) {
	const reply = await evaluate(
		window,
		`window.quakeWeatherMedia.request(${JSON.stringify(command)})`,
	);
	assert(Schema.is(WeatherMediaReply)(reply), JSON.stringify(reply));
	return reply;
}
async function capture(window: BrowserWindow, name: string): Promise<void> {
	await sleep(200);
	await writeFile(
		join(artifacts, `${name}.png`),
		(await window.webContents.capturePage()).toPNG(),
	);
}

async function smoke(): Promise<void> {
	await app.whenReady();
	await mkdir(artifacts, { recursive: true });
	const options = {
		show: false,
		useContentSize: true,
		webPreferences: {
			preload: resolve("out/preload/index.mjs"),
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
			backgroundThrottling: false,
		},
	};
	const management = new BrowserWindow({
		...options,
		width: 1100,
		height: 760,
	});
	const panel = new BrowserWindow({ ...options, width: 1920, height: 480 });
	const renderer = pathToFileURL(resolve("out/renderer/index.html")).href;
	const networkCalls: string[] = [];
	let outage = false;
	const actions: NativeMediaAction[] = [];
	let native: NativeMediaState = { session: mediaSession, error: null };
	const runtime = ManagedRuntime.make(
		WeatherMediaController.Default.pipe(
			Layer.provide(
				Layer.mergeAll(
					weatherSettingsLive(base),
					Layer.succeed(WeatherNetwork, {
						json: (url) =>
							Effect.suspend(() => {
								networkCalls.push(url);
								if (outage)
									return Effect.fail(
										WeatherNetworkFailed.fromCause("fake provider outage"),
									);
								return Effect.succeed(
									url.includes("geocoding") ? cityFixture : forecastFixture,
								);
							}),
					}),
					Layer.succeed(SystemMediaAdapter, {
						read: () => Effect.sync(() => native),
						control: (action) =>
							Effect.sync(() => {
								actions.push(action);
								native = {
									...native,
									session: { ...mediaSession, playing: action === "play" },
								};
								return true;
							}),
					}),
				),
			),
		),
	);
	const registration = registerWeatherMedia(
		runtime,
		() => management,
		renderer,
	);
	const voice = registerVoiceSurface({
		mock: true,
		tones: createToneRecorder(),
		serial: () => "weather-media-smoke",
		panel: () => panel,
		management: () => management,
		renderer,
	});
	const monitor = registerMonitor(
		base,
		() => management,
		() => panel,
		{
			collect: () => Effect.die("Unmounted monitor must not collect host data"),
		},
		renderer,
	);
	const maintenance = registerMaintenance({
		root: base,
		mock: true,
		renderer,
		hardware: () => undefined,
		management: () => management,
		stopWriters: async () =>
			assert.fail("Read-only smoke must not reset or restore"),
		exit: () => assert.fail("Read-only maintenance must not exit the app"),
	});
	const knob = registerKnob(
		() => panel,
		() => [management, panel],
		{
			readVolume: Effect.succeed({ level: 50, muted: false }),
			writeVolume: () => Effect.void,
		},
	);
	const lifecycleRuntime = ManagedRuntime.make(
		DeviceLifecycle.Default({
			mock: true,
			development: true,
			displays: () => [],
			watch: () => () => {},
			panel: () => {},
			notify: () => {},
			bus: () => ({ on: () => () => {}, currentStatus: () => undefined }),
			prompts: {
				platform: process.platform,
				mock: true,
				displays: () => [],
				primaryId: () => 1,
				prompt: () => Effect.die("Weather/media smoke must not prompt"),
				native: () =>
					Effect.die("Weather/media smoke must not call native display APIs"),
				openSettings: () => Effect.void,
			},
		}),
	);
	const removeLifecycle = registerLifecycle(
		lifecycleRuntime,
		() => management,
		renderer,
	);
	const wallpaper = registerMedia(
		ManagedRuntime.make(MediaLive(join(base, "wallpaper-v1"))),
		() => management,
		renderer,
	);
	const clock = registerClock(
		ManagedRuntime.make(ClockLive(base)),
		() => management,
		renderer,
	);
	let envelope = stripFixtureEnvelope(clockProfile);
	const makeProfiles = () =>
		registerProfiles(
			ManagedRuntime.make(
				ProfilesLive({
					read: async () => structuredClone(envelope),
					write: async () => undefined,
				}),
			),
			renderer,
		);
	let profiles = makeProfiles();
	const publish = async () => {
		const snapshot = await runtime.runPromise(WeatherMediaController.read());
		for (const window of [management, panel])
			window.webContents.send(WEATHER_MEDIA_CHANGED, snapshot);
	};
	try {
		await maintenance.ready;
		await Promise.all([
			management.loadFile(resolve("out/renderer/index.html")),
			panel.loadFile(resolve("out/renderer/index.html"), {
				query: { surface: "panel" },
			}),
		]);
		await waitForVoice(panel, "!!window.quakeVoice");
		assert.equal(
			await evaluate(
				management,
				"window.quakeMaintenance.request({action:'read'}).then(reply => reply.ok)",
			),
			true,
			"maintenance reads coexist with weather/media on the shared preload",
		);
		assert.equal(
			await evaluate(
				management,
				"window.quakeMonitor.request({_tag:'read'}).then(reply => reply._tag === 'success' && reply.view.settings.enabled && reply.view.settings.styleId === 'glass')",
			),
			true,
			"monitor reads coexist with weather/media on the shared preload",
		);
		await waitFor(
			panel,
			"!!document.querySelector('.oq-clock')",
			"clock mounted",
		);
		assert.equal(
			networkCalls.length,
			0,
			"disabled weather has no network calls",
		);
		assert.equal(
			await evaluate(
				panel,
				"document.querySelectorAll('.oq-clock-card-slot').length",
			),
			0,
		);
		const configured = await request(management, {
			_tag: "configure",
			settings: { ...weatherSettings, musicEnabled: true },
		});
		assert.equal(configured._tag, "snapshot");
		await waitFor(
			panel,
			"document.querySelector('.oq-weather-temp')?.textContent.includes('12') && document.querySelector('.oq-music-card')?.dataset.state === 'playing'",
			"weather and music data",
		);
		await capture(panel, "clock-weather-music");
		assert.equal(
			await evaluate(
				panel,
				"(() => { const stage = document.querySelector('.oq-clock'); const cards = [...document.querySelectorAll('.oq-clock-card-slot')]; return cards.length === 2 && cards.every(card => card.getBoundingClientRect().right <= stage.getBoundingClientRect().right + 1); })()",
			),
			true,
			"clock cards fit the stage",
		);
		// Exercise actual effective sub-touch, not an isolated callback.
		await evaluate(
			panel,
			"document.querySelector('[data-testid=clock-music-play]').dispatchEvent(new CustomEvent('quake-sub-touch-end',{detail:{isEffective:false},bubbles:true}))",
		);
		assert.equal(actions.length, 0);
		await evaluate(
			panel,
			"document.querySelector('[data-testid=clock-music-play]').dispatchEvent(new CustomEvent('quake-sub-touch-end',{detail:{isEffective:true},bubbles:true}))",
		);
		await waitFor(
			panel,
			"document.querySelector('.oq-music-card')?.dataset.state === 'paused'",
			"effective toggle",
		);
		assert.deepEqual(actions, ["pause"]);
		await evaluate(
			management,
			"[...document.querySelectorAll('.nav-item')].find(button=>button.textContent.includes('Screen'))?.click()",
		);
		await waitFor(
			management,
			"!!document.querySelector('[aria-label=\"City\"]')",
			"weather settings",
		);
		const beforeTyping = networkCalls.length;
		for (const query of ["B", "Be", "Ber", "Berlin, DE"]) {
			await evaluate(
				management,
				`(() => { const input = document.querySelector('[aria-label="City"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(query)}); input.dispatchEvent(new Event('input', {bubbles:true})); input.scrollIntoView({block:'center'}); })()`,
			);
			await sleep(150);
			const current = await request(management, { _tag: "read" });
			assert.equal(current._tag, "snapshot");
			if (current._tag === "snapshot") {
				assert.equal(
					current.snapshot.settings.city,
					"Berlin",
					"draft city is not persisted",
				);
				assert.equal(
					current.snapshot.settings.location,
					null,
					"old coordinates clear immediately",
				);
			}
		}
		await waitFor(
			management,
			"document.querySelector('.weather-settings')?.textContent.includes('Weather for Berlin')",
			"city verification through settings",
		);
		await waitFor(
			management,
			"document.querySelector('[aria-label=\"City\"]')?.value === 'Berlin, DE'",
			"draft stays responsive",
		);
		await waitFor(
			management,
			"window.quakeWeatherMedia.request({_tag:'read'}).then(reply => reply._tag === 'snapshot' && reply.snapshot.settings.city === 'Berlin, DE' && reply.snapshot.settings.location?.sourceCity === 'Berlin, DE')",
			"settled city persisted with coordinates",
		);
		const settled = await request(management, { _tag: "read" });
		assert.equal(settled._tag, "snapshot");
		if (settled._tag === "snapshot") {
			assert.equal(settled.snapshot.settings.city, "Berlin, DE");
			assert.equal(
				settled.snapshot.settings.location?.sourceCity,
				"Berlin, DE",
			);
		}
		assert(
			networkCalls
				.slice(beforeTyping)
				.every(
					(url) =>
						!["B", "Be", "Ber"].includes(
							new URL(url).searchParams.get("name") ?? "",
						),
				),
			"draft prefixes never reach providers",
		);
		await capture(management, "weather-settings-manual-city");
		await evaluate(
			management,
			"document.querySelector('[aria-label=\"Find my city from my IP address\"]')?.scrollIntoView({block:'center'})",
		);
		assert.equal(
			await evaluate(
				management,
				"document.querySelector('[aria-label=\"Find my city from my IP address\"]')?.checked",
			),
			false,
		);
		await capture(management, "weather-settings-ip-consent");
		outage = true;
		await request(management, {
			_tag: "configure",
			settings: {
				...weatherSettings,
				musicEnabled: true,
				forecastUrl: "https://offline.example/forecast",
			},
		});
		await waitFor(
			panel,
			"document.querySelector('.oq-weather-desc')?.textContent === 'Weather unavailable'",
			"provider outage keeps a distinct error",
		);
		await capture(panel, "clock-weather-unavailable");
		outage = false;
		await request(management, {
			_tag: "configure",
			settings: { ...weatherSettings, musicEnabled: true },
		});
		await waitFor(
			panel,
			"document.querySelector('.oq-weather-temp')?.textContent.includes('12')",
			"weather recovers after outage",
		);
		const denied = await request(panel, {
			_tag: "configure",
			settings: { ...weatherSettings, ipLookup: true },
		});
		assert.equal(denied._tag, "failure");
		const source = clockProfile.pages[0].keys[0];
		assert(source);
		envelope = stripFixtureEnvelope({
			...clockProfile,
			id: "fixture-player",
			name: "DK-Player",
			pages: [
				{
					id: "player-1",
					keys: [
						{ ...source, config: { ...source.config, type: "playAudio" } },
					],
				},
			],
		});
		await profiles.dispose();
		profiles = makeProfiles();
		await panel.reload();
		await waitFor(
			panel,
			"!!document.querySelector('.oq-player')",
			"DK-Player mounted",
		);
		for (const state of ["playing", "paused", "idle", "unavailable"] as const) {
			native = {
				session:
					state === "idle" || state === "unavailable"
						? null
						: { ...mediaSession, playing: state === "playing" },
				error: state === "unavailable" ? "MEDIAREMOTE_UNAVAILABLE" : null,
			};
			await publish();
			await waitFor(
				panel,
				`document.querySelector('.oq-player')?.dataset.state === '${state}'`,
				state,
			);
			if (state === "idle") {
				await sleep(3100);
				await waitFor(
					panel,
					"!!document.querySelector('.oq-player-guide')",
					"no-session guide",
				);
			} else await sleep(1700);
			if (state === "unavailable")
				await waitFor(
					panel,
					"!document.querySelector('.oq-player-guide')",
					"guide exit completed",
				);
			await capture(panel, `dk-player-${state}`);
		}
		native = {
			session: { ...mediaSession, canNext: false, canPrevious: false },
			error: null,
		};
		await publish();
		await waitFor(
			panel,
			"document.querySelector('[data-testid=audioPlayerViewForwards]')?.disabled",
			"capability gates",
		);
		await capture(panel, "dk-player-navigation-unavailable");
		native = { session: { ...mediaSession, canPause: false }, error: null };
		await publish();
		await waitFor(
			panel,
			"document.querySelector('[data-testid=playStopActive]')?.disabled",
			"pause capability gate",
		);
		await capture(panel, "dk-player-pause-unavailable");
		native = { session: { ...mediaSession, durationMs: null }, error: null };
		await publish();
		await sleep(100);
		await capture(panel, "dk-player-unknown-duration");
		// A configured local sound key remains owned by the soundboard lane.
		envelope = stripFixtureEnvelope({
			...clockProfile,
			id: "fixture-local-sound",
			name: "Local sound",
			pages: [
				{
					id: "local-1",
					keys: [
						{
							...source,
							config: {
								...source.config,
								type: "playAudio",
								actions: [{ type: "sound", value: "fixture.mp3" }],
							},
						},
					],
				},
			],
		});
		await profiles.dispose();
		profiles = makeProfiles();
		await panel.reload();
		await waitFor(
			panel,
			"!!document.querySelector('.strip-tile[data-type=playAudio]')",
			"local sound renderer retained",
		);
		assert.equal(
			await evaluate(panel, "document.querySelectorAll('.oq-player').length"),
			0,
		);
		assert.deepEqual(actions, ["pause"]);
		assert(
			networkCalls.every(
				(url) => !url.includes("ipapi") && !url.includes("ipwho"),
			),
			"manual weather never invokes IP services",
		);
		process.stdout.write(
			`weather/media native mock smoke PASS; fake weather calls=${networkCalls.length}; actions=${actions.join(",")}\n`,
		);
	} finally {
		management.destroy();
		panel.destroy();
		await maintenance.dispose();
		await registration.dispose();
		await monitor.dispose();
		await knob.dispose();
		await voice.dispose();
		removeLifecycle();
		await lifecycleRuntime.dispose();
		await clock.dispose();
		await profiles.dispose();
		await wallpaper.dispose();
	}
}
void smoke()
	.then(() => {
		app.exit(0);
	})
	.catch((cause: unknown) => {
		process.stderr.write(`${String(cause)}\n`);
		app.exit(1);
	});
process.once("exit", () => {
	rmSync(base, { recursive: true, force: true });
});
