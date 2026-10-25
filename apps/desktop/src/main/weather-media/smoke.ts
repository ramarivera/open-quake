/** Hidden native Electron smoke. Production renderer/preload, fake IO, no HID. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { app, BrowserWindow } from "electron";
import { THEME_IDS } from "../../shared/clock-style";
import {
	WEATHER_MEDIA_CHANGED,
	type WeatherMediaCommand,
	WeatherMediaReply,
} from "../../shared/weather-media-contracts";
import { WeatherNetworkFailed } from "../../shared/weather-media-errors";
import { WEATHER_MEDIA_STRINGS } from "../../shared/weather-media-strings";
import { ClockLive, registerClock, registerClockScheme } from "../clock";
import { registerKnob } from "../knob";
import { DeviceLifecycle } from "../lifecycle/lifecycle-service";
import { registerLifecycle } from "../lifecycle/registration";
import { registerMaintenance } from "../maintenance";
import { MediaLive, registerMedia } from "../media";
import { registerMeetings } from "../meetings";
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
	let fallbackCode: number | undefined;
	const actions: NativeMediaAction[] = [];
	let native: NativeMediaState = { session: mediaSession, error: null };
	const runtime = ManagedRuntime.make(
		WeatherMediaController.Default.pipe(
			Layer.provide(
				Layer.mergeAll(
					weatherSettingsLive(base),
					Layer.succeed(WeatherNetwork, {
						json: (url) =>
							Effect.suspend(
								(): Effect.Effect<unknown, WeatherNetworkFailed> => {
									networkCalls.push(url);
									if (outage)
										return Effect.fail(
											WeatherNetworkFailed.fromCause("fake provider outage"),
										);
									if (url.includes("geocoding"))
										return Effect.succeed(cityFixture);
									if (fallbackCode !== undefined) {
										if (!url.startsWith("https://wttr.in/"))
											return Effect.fail(
												WeatherNetworkFailed.fromCause("fake primary outage"),
											);
										return Effect.succeed({
											current_condition: [
												{ temp_C: "11.4", weatherCode: String(fallbackCode) },
											],
											weather: [{ maxtempC: "14.8", mintempC: "6.5" }],
										});
									}
									// The fake honors Fahrenheit, so a request-unit regression
									// reaches IPC and the rendered current/high/low values.
									if (
										new URL(url).searchParams
											.getAll("temperature_unit")
											.includes("fahrenheit")
									)
										return Effect.succeed({
											current: { temperature_2m: 54.32, weather_code: 2 },
											daily: {
												temperature_2m_max: [59.72],
												temperature_2m_min: [44.78],
											},
										});
									return Effect.succeed(forecastFixture);
								},
							),
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
	const meetings = registerMeetings({
		userData: base,
		hardware: () => undefined,
		mock: true,
		renderer,
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
		assert.deepEqual(
			new URL(networkCalls[0] ?? "").searchParams.getAll("temperature_unit"),
			["celsius"],
			"default explicitly requests canonical units",
		);
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
		for (const [index, query] of [", DE", "A, DE"].entries()) {
			const beforeInvalid: number = networkCalls.length;
			assert.deepEqual(
				await request(management, { _tag: "verifyCity", query, locale: "en" }),
				{ _tag: "city", result: { _tag: "not-found" } },
			);
			const configured = await request(management, {
				_tag: "configure",
				settings: {
					...weatherSettings,
					city: query,
					location: null,
					musicEnabled: true,
				},
			});
			assert.equal(configured._tag, "snapshot");
			assert.deepEqual(
				await request(panel, { _tag: "weather", locale: "en" }),
				{
					_tag: "weather",
					result: { _tag: "error", reason: "city-not-found" },
				},
			);
			await evaluate(
				management,
				`(() => { const input = document.querySelector('[aria-label="City"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(query)}); input.dispatchEvent(new Event('input', {bubbles:true})); input.scrollIntoView({block:'center'}); })()`,
			);
			await waitFor(
				management,
				"document.querySelector('.weather-verification')?.textContent.includes('No city found for')",
				"invalid city is not a renderer network error",
			);
			await waitFor(
				panel,
				"document.querySelector('.oq-weather-desc')?.textContent === 'City not found'",
				"invalid city is not a provider outage",
			);
			assert.equal(
				networkCalls.length,
				beforeInvalid,
				"invalid city makes no IO",
			);
			await capture(management, `weather-invalid-city-${index}`);
			await capture(panel, `clock-invalid-city-${index}`);
		}
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
		const contrast: { theme: string; text: string; ratio: unknown }[] = [];
		for (const theme of THEME_IDS) {
			await evaluate(
				panel,
				`window.quakeClock.request({_tag:'setTheme',keyCode:'1,1',themeId:${JSON.stringify(theme)}})`,
			);
			await waitFor(
				panel,
				`document.querySelector('.oq-clock')?.dataset.theme===${JSON.stringify(theme)}`,
				`contrast theme ${theme}`,
			);
			for (const text of ["Weather unavailable", "City not found"]) {
				// These strings already run through real service paths above. This probe isolates
				// their unchanged error-chip style against each actual built-in background.
				const ratio = await evaluate(
					panel,
					`(()=>{const element=document.querySelector('.oq-weather-desc');element.textContent=${JSON.stringify(text)};const style=getComputedStyle(element);const channels=value=>value.match(/[0-9.]+/g).map(Number);const fg=channels(style.color),bg=channels(style.backgroundColor);if(bg.length===4&&bg[3]!==1)return 0;const luminance=rgb=>rgb.slice(0,3).map(value=>{const c=value/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4}).reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index],0);const a=luminance(fg),b=luminance(bg);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);})()`,
				);
				assert(typeof ratio === "number" && ratio >= 4.5);
				contrast.push({ theme, text, ratio });
				await capture(
					panel,
					`weather-contrast-${theme}-${text.startsWith("City") ? "city" : "unavailable"}`,
				);
			}
		}
		await writeFile(
			join(artifacts, "weather-contrast.json"),
			JSON.stringify(contrast),
		);

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
		for (const [code, wmo, icon, english, german] of [
			[122, 3, "cloudy", "Overcast", "Bedeckt"],
			[179, 85, "snow", "Snow", "Schnee"],
		] as const) {
			fallbackCode = code;
			await request(management, {
				_tag: "configure",
				settings: {
					...weatherSettings,
					musicEnabled: true,
					forecastUrl: `https://fallback.example/forecast?condition=${code}`,
				},
			});
			await waitFor(
				panel,
				`document.querySelector('.oq-weather-desc')?.textContent === '${english}' && !!document.querySelector('[data-weather-icon=${icon}]')`,
				"fallback card condition without provider text",
			);
			const localized = await request(panel, { _tag: "weather", locale: "de" });
			assert.equal(localized._tag, "weather");
			if (localized._tag !== "weather" || localized.result._tag !== "ready")
				assert.fail("fallback IPC missing");
			assert.equal(localized.result.data.weatherCode, wmo);
			assert.equal(localized.result.data.description, german);
			assert.equal(localized.result.data.provider, "wttr.in");
			await capture(panel, `clock-fallback-${code}`);
		}
		fallbackCode = undefined;
		const customUrl =
			"https://custom.example/forecast?temperature_unit=fahrenheit&temperature_unit=celsius&temperature_unit=fahrenheit&model=best_match&model=icon";
		let cachedCalls: number | undefined;
		for (const [index, unit] of (
			["fahrenheit", "celsius", "fahrenheit", "celsius"] as const
		).entries()) {
			await request(management, {
				_tag: "configure",
				settings: {
					...weatherSettings,
					musicEnabled: true,
					forecastUrl: customUrl,
					unit,
				},
			});
			const [temperature, high, low] =
				unit === "celsius" ? [12, 15, 7] : [54, 60, 45];
			const reply = await request(panel, { _tag: "weather", locale: "en" });
			if (reply._tag !== "weather" || reply.result._tag !== "ready")
				assert.fail("custom forecast IPC missing");
			assert.equal(reply.result.data.temperature, temperature);
			assert.equal(reply.result.data.high, high);
			assert.equal(reply.result.data.low, low);
			await waitFor(
				panel,
				`document.querySelector('.oq-weather-temp')?.textContent === '${temperature}°' && document.querySelector('.oq-weather-range')?.textContent === 'H ${high}°L ${low}°' && document.querySelector('.oq-weather-meta')?.textContent === '°${unit === "celsius" ? "C" : "F"}'`,
				"custom units render once from canonical cache",
			);
			if (cachedCalls !== undefined)
				assert.equal(
					networkCalls.length,
					cachedCalls,
					"unit toggles reuse Celsius cache",
				);
			cachedCalls = networkCalls.length;
			await capture(panel, `clock-custom-${index}-${unit}`);
		}
		const customCalls = networkCalls.filter(
			(url) => new URL(url).hostname === "custom.example",
		);
		assert.equal(customCalls.length, 1);
		const forwarded = new URL(customCalls[0] ?? "");
		assert.deepEqual(forwarded.searchParams.getAll("temperature_unit"), [
			"celsius",
		]);
		assert.deepEqual(forwarded.searchParams.getAll("model"), [
			"best_match",
			"icon",
		]);
		await writeFile(
			join(artifacts, "weather-network-calls.json"),
			JSON.stringify(networkCalls, null, 2),
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

		const localizedBounds: unknown[] = [];
		for (const locale of ["fr", "it"] as const) {
			native = { session: null, error: "TCC_DENIED" };
			await evaluate(
				panel,
				`Object.defineProperty(navigator,'language',{value:${JSON.stringify(locale)},configurable:true});null`,
			);
			await publish();
			await waitFor(
				panel,
				`document.querySelector('.oq-player-error')?.textContent===${JSON.stringify(WEATHER_MEDIA_STRINGS[locale].media.tccDenied)}`,
				`${locale} system hint`,
			);
			const bounds = await evaluate(
				panel,
				"(()=>{const h=document.querySelector('.oq-player-error'),s=document.querySelector('.oq-player-source');return {locale:navigator.language,text:h.textContent,font:getComputedStyle(h).fontSize,hint:h.getBoundingClientRect().toJSON(),source:s.getBoundingClientRect().toJSON()};})()",
			);
			localizedBounds.push(bounds);
			assert.equal(
				await evaluate(
					panel,
					"(()=>{const hint=document.querySelector('.oq-player-error'),source=document.querySelector('.oq-player-source');const box=hint.getBoundingClientRect(),pill=source.getBoundingClientRect();return getComputedStyle(hint).fontSize==='24px' && box.height>=28 && box.height<=62.5 && box.top>=0 && box.bottom<=pill.top;})()",
				),
				true,
				"Localized hint must fit at most two lines above the source pill",
			);

			await capture(panel, `dk-player-${locale}-permission-hint`);
		}
		// Layout-only stress case uses the existing recovered Italian service string.
		// Real permission errors above still exercise their unmodified production renderer.
		await evaluate(
			panel,
			`document.querySelector('.oq-player-error').textContent=${JSON.stringify(WEATHER_MEDIA_STRINGS.it.media.mediaRemoteUnavailable)};null`,
		);
		assert.equal(
			await evaluate(
				panel,
				"(()=>{const box=document.querySelector('.oq-player-error').getBoundingClientRect(),pill=document.querySelector('.oq-player-source').getBoundingClientRect();return box.height>=28 && box.height<=62.5 && box.top>=0 && box.bottom<=pill.top;})()",
			),
			true,
			"Long recovered hint fits at most two lines without source overlap",
		);
		await capture(panel, "dk-player-italian-long-service-layout");
		await writeFile(
			join(artifacts, "localized-player-bounds.json"),
			JSON.stringify(localizedBounds),
		);
		await evaluate(panel, "delete navigator.language;null");
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
		await meetings.dispose();
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
