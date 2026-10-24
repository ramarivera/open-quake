/** Production preview consumers with synthetic stores and recorded IO only. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { app, BrowserWindow, ipcMain } from "electron";
import {
	createEmptyProfileKey,
	Profile,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository.js";
import { ProfileReplySchema } from "../../shared/profile-manager";
import { WeatherNetworkFailed } from "../../shared/weather-media-errors";
import { ClockLive, registerClock, registerClockScheme } from "../clock";
import { registerHardware } from "../hardware";
import { registerKnob } from "../knob";
import { DeviceLifecycle } from "../lifecycle/lifecycle-service";
import { registerLifecycle } from "../lifecycle/registration";
import { registerMaintenance } from "../maintenance";
import { MediaLive, registerMedia } from "../media";
import { registerMeetings } from "../meetings";
import { registerProfiles } from "../profiles";
import { createToneRecorder, registerVoiceSurface } from "../voice";
import { WeatherMediaController } from "../weather-media/controller";
import { registerWeatherMedia } from "../weather-media/index";
import { weatherSettingsLive } from "../weather-media/settings-repository";
import {
	type NativeMediaAction,
	SystemMediaAdapter,
} from "../weather-media/system-media";
import { mediaSession, weatherSettings } from "../weather-media/test-fixtures";
import { WeatherNetwork } from "../weather-media/weather-network";

assert.equal(process.env.OPEN_QUAKE_MOCK_DEVICE, "1");
assert(process.argv[2], "Provide an absolute evidence directory");
const scratch = resolve(process.argv[2]);
const probe = process.argv[3] ?? "all";
registerClockScheme();
app.on("window-all-closed", () => {});
const evaluate = (win: BrowserWindow, expression: string): Promise<unknown> =>
	win.webContents.executeJavaScript(expression);
async function ready(win: BrowserWindow, expression: string): Promise<void> {
	await evaluate(
		win,
		`new Promise((resolve,reject)=>{const end=Date.now()+10000;const check=()=>{if(${expression})resolve(true);else if(Date.now()>end)reject(new Error(${JSON.stringify(expression)}));else setTimeout(check,20)};check()})`,
	);
}
async function select(win: BrowserWindow, selector: string, value: string) {
	await ready(win, `document.querySelector(${JSON.stringify(selector)})`);
	await evaluate(
		win,
		`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
	);
}
const titleExpression = (parent: string): string =>
	`Array.from(document.querySelectorAll(${JSON.stringify(`${parent} .strip-tile-title`)})).map(el=>el.textContent)`;
async function capture(win: BrowserWindow, name: string) {
	await evaluate(
		win,
		"document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(true)))))",
	);
	await writeFile(
		join(scratch, `${name}.png`),
		(await win.webContents.capturePage()).toPNG(),
	);
}
async function navigate(win: BrowserWindow, label: string) {
	await ready(win, "document.querySelector('nav')");
	await evaluate(
		win,
		`Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`,
	);
}
async function nativeClick(
	win: BrowserWindow,
	selector: string,
): Promise<void> {
	await evaluate(
		win,
		`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`,
	);
	const point = Schema.decodeUnknownSync(
		Schema.Struct({ x: Schema.Number, y: Schema.Number }),
	)(
		await evaluate(
			win,
			`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
		),
	);
	win.webContents.sendInputEvent({
		type: "mouseDown",
		button: "left",
		clickCount: 1,
		...point,
	});
	win.webContents.sendInputEvent({
		type: "mouseUp",
		button: "left",
		clickCount: 1,
		...point,
	});
}
const fixtureKey = (code: string, type: string) => {
	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey(code));
	return {
		...empty,
		childrenName: type,
		compatibility: {
			source: {
				keyCode: code,
				config: {
					type,
					title: {
						text: "Record",
						i18nKey: "defaultMeetingAssistantConfig.record",
					},
				},
			},
		},
		config: {
			...empty.config,
			type,
			display: true,
			supportTouchEffect: true,
			title: {
				...empty.config.title,
				text: "Record",
				i18nKey: "defaultMeetingAssistantConfig.record",
				display: true,
			},
			actions: type === "hotkey" ? [{ type: "key", value: "c" }] : [],
		},
	};
};
const localeProfile = Schema.decodeUnknownSync(Profile)({
	id: "preview-locale",
	name: "Preview locale",
	revision: 0,
	pages: [{ id: "one", keys: [fixtureKey("1,1", "hotkey")] }],
});

async function smoke(): Promise<void> {
	await mkdir(scratch, { recursive: true });
	const directory = await mkdtemp(
		join(process.env.OPEN_QUAKE_SMOKE_SCRATCH ?? scratch, "preview-user-data-"),
	);
	app.setPath("userData", directory);
	const disposals: (() => Promise<void> | void)[] = [];
	let manager: BrowserWindow | undefined;
	let failed = false;
	const actions: NativeMediaAction[] = [],
		network: string[] = [];
	const outbound: { channel: string; input: unknown }[] = [];
	const handle = ipcMain.handle.bind(ipcMain);
	ipcMain.handle = (channel, listener) =>
		handle(channel, (event, input: unknown) => {
			outbound.push({ channel, input });
			return listener(event, input);
		});
	try {
		await app.whenReady();
		const options = {
			show: false,
			width: 1440,
			height: 1100,
			useContentSize: true,
			webPreferences: {
				preload: resolve("out/preload/index.mjs"),
				sandbox: false,
				contextIsolation: true,
				nodeIntegration: false,
				backgroundThrottling: false,
			},
		};
		const win = new BrowserWindow(options);
		manager = win;
		const panel = new BrowserWindow({ ...options, width: 960, height: 240 });
		const renderer = pathToFileURL(resolve("out/renderer/index.html")).href;
		let profiles = registerProfiles(
			() => win,
			renderer,
			undefined,
			renderer,
			() => undefined,
			() => panel,
		);
		disposals.push(() => profiles.dispose());
		const clock = registerClock(
			ManagedRuntime.make(ClockLive(directory)),
			() => win,
		);
		disposals.push(() => clock.dispose());
		const media = registerMedia(
			ManagedRuntime.make(MediaLive(join(directory, "media"))),
			() => win,
		);
		disposals.push(() => media.dispose());
		const weather = registerWeatherMedia(
			ManagedRuntime.make(
				WeatherMediaController.Default.pipe(
					Layer.provide(
						Layer.mergeAll(
							weatherSettingsLive(directory),
							Layer.succeed(WeatherNetwork, {
								json: (url) =>
									Effect.sync(() => network.push(url)).pipe(
										Effect.zipRight(
											Effect.fail(
												WeatherNetworkFailed.fromCause(
													"No network in preview proof",
												),
											),
										),
									),
							}),
							Layer.succeed(SystemMediaAdapter, {
								read: () =>
									Effect.succeed({ session: mediaSession, error: null }),
								control: (action) =>
									Effect.sync(() => {
										actions.push(action);
										return true;
									}),
							}),
						),
					),
				),
			),
			() => win,
			renderer,
		);
		disposals.push(() => weather.dispose());
		const voice = registerVoiceSurface({
			mock: true,
			tones: createToneRecorder(),
			serial: () => "desktop-preview",
			panel: () => panel,
			management: () => win,
			renderer,
		});
		disposals.push(() => voice.dispose());
		const meetings = registerMeetings({
			userData: directory,
			mock: true,
			hardware: () => undefined,
		});
		disposals.push(() => meetings.dispose());
		const maintenance = registerMaintenance({
			root: directory,
			mock: true,
			renderer,
			hardware: () => undefined,
			management: () => win,
			stopWriters: async () => {},
		});
		disposals.push(() => maintenance.dispose());
		const knob = registerKnob(
			() => panel,
			() => [win, panel],
		);
		disposals.push(() => knob.dispose());
		const lifecycle = ManagedRuntime.make(
			DeviceLifecycle.Default({
				mock: true,
				development: true,
				displays: () => [],
				watch: () => () => {},
				panel: () => {},
				bus: () => undefined,
				notify: () => {},
				prompts: {
					platform: process.platform,
					mock: true,
					displays: () => [],
					primaryId: () => 1,
					prompt: () => Effect.die("No prompt"),
					native: () => Effect.die("No displays"),
					openSettings: () => Effect.void,
				},
			}),
		);
		const removeLifecycle = registerLifecycle(lifecycle, () => win, renderer);
		disposals.push(async () => {
			removeLifecycle();
			await lifecycle.dispose();
		});
		disposals.push(
			registerHardware(
				() => undefined,
				() => win,
				true,
			),
		);
		await win.loadURL(renderer);
		await ready(win, "document.querySelector('nav')");
		await evaluate(win, 'localStorage.setItem("open-quake-key-locale","en")');
		const read = Schema.decodeUnknownSync(ProfileReplySchema)(
			await evaluate(
				win,
				'window.quakeProfileManager.request({type:"read",locale:"en"})',
			),
		);
		assert.equal(read._tag, "success");
		await profiles.runtime.runPromise(
			Effect.flatMap(ProfileRepository, (repo) =>
				repo.transact((env) =>
					Effect.succeed({
						...env,
						profiles: [...env.profiles, localeProfile],
						activeByDevice: {
							...env.activeByDevice,
							"desktop-preview": { profileId: localeProfile.id, pageId: "one" },
						},
					}),
				),
			),
		);
		await profiles.connect("desktop-preview", localeProfile.id);
		if (probe !== "media") {
			if (probe !== "thumbnail") {
				await navigate(win, "Knob Profile");
				await select(win, ".profiles-manager header select", "de");
				await ready(
					win,
					`document.querySelector('[data-profile-ready="preview-locale"]')`,
				);
				await ready(
					win,
					`${titleExpression(".profile-preview")}[0]!=="Record"`,
				);
				assert.deepEqual(
					await evaluate(win, titleExpression(".profile-preview")),
					["Aufnahme"],
					"Mounted German manager preview must ignore English Keys locale",
				);
				await evaluate(
					win,
					'localStorage.setItem("open-quake-key-locale","ja");window.dispatchEvent(new Event("key-locale"))',
				);
				await evaluate(
					win,
					"new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
				);
				assert.deepEqual(
					await evaluate(win, titleExpression(".profile-preview")),
					["Aufnahme"],
				);
				await capture(win, "manager-de");
				await select(win, ".profiles-manager header select", "fr");
				await ready(
					win,
					`${titleExpression(".profile-preview")}[0]==="Enreg."`,
				);
				await capture(win, "manager-fr");
			}
			const captures: { locale: string; initial: unknown; later: unknown }[] =
				[];
			const interceptCapture = (
				_event: Electron.Event,
				thumbnail: BrowserWindow,
			) => {
				const original = thumbnail.webContents.capturePage.bind(
					thumbnail.webContents,
				);
				thumbnail.webContents.capturePage = async () => {
					const url = new URL(thumbnail.webContents.getURL());
					assert.equal(url.searchParams.get("surface"), "profile-thumbnail");
					const locale = url.searchParams.get("locale") ?? "";
					const expected = locale === "de" ? "Aufnahme" : "Enreg.";
					const initial = await evaluate(
						thumbnail,
						titleExpression(".profile-preview"),
					);
					await writeFile(
						join(scratch, `thumbnail-${locale}-initial.json`),
						JSON.stringify({ locale, initial, expected }),
					);
					process.stdout.write(
						`Thumbnail ${locale} at capture: ${JSON.stringify(initial)}; expected ${expected}\n`,
					);
					assert.deepEqual(
						initial,
						[expected],
						"Titles at the real thumbnail capture readiness boundary",
					);
					await evaluate(
						thumbnail,
						'localStorage.setItem("open-quake-key-locale","ko");window.dispatchEvent(new StorageEvent("storage",{key:"open-quake-key-locale"}));window.dispatchEvent(new Event("key-locale"));new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
					);
					const later = await evaluate(
						thumbnail,
						titleExpression(".profile-preview"),
					);
					assert.deepEqual(later, [expected]);
					captures.push({ locale, initial, later });
					const image = await original();
					await writeFile(
						join(scratch, `thumbnail-${locale}.png`),
						image.toPNG(),
					);
					return image;
				};
			};
			app.on("browser-window-created", interceptCapture);
			try {
				for (const locale of ["de", "fr"]) {
					await evaluate(
						win,
						'localStorage.setItem("open-quake-key-locale","en")',
					);
					const reply = Schema.decodeUnknownSync(ProfileReplySchema)(
						await evaluate(
							win,
							`window.quakeProfileManager.request({type:"thumbnail",id:"preview-locale",locale:${JSON.stringify(locale)}})`,
						),
					);
					assert.equal(reply._tag, "success");
					const stored = await readFile(
						join(scratch, `thumbnail-${locale}.png`),
					);
					const cached = Schema.decodeUnknownSync(ProfileReplySchema)(
						await evaluate(
							win,
							`window.quakeProfileManager.request({type:"read",locale:${JSON.stringify(locale)}})`,
						),
					);
					assert(cached._tag === "success");
					assert.equal(
						cached.view.thumbnails[localeProfile.id],
						`data:image/png;base64,${stored.toString("base64")}`,
					);
				}
				await profiles.dispose();
				profiles = registerProfiles(
					() => win,
					renderer,
					undefined,
					renderer,
					() => undefined,
					() => panel,
				);
				for (const locale of ["de", "fr"]) {
					const cached = Schema.decodeUnknownSync(ProfileReplySchema)(
						await evaluate(
							win,
							`window.quakeProfileManager.request({type:"read",locale:${JSON.stringify(locale)}})`,
						),
					);
					assert(cached._tag === "success");
					assert.equal(
						cached.view.thumbnails[localeProfile.id],
						`data:image/png;base64,${(await readFile(join(scratch, `thumbnail-${locale}.png`))).toString("base64")}`,
					);
				}
				assert.deepEqual(
					captures.map((c) => c.locale),
					["de", "fr"],
					"Cache reads must not recapture",
				);
				await writeFile(
					join(scratch, "thumbnail-consumers.json"),
					JSON.stringify(captures, null, 2),
				);
			} finally {
				app.removeListener("browser-window-created", interceptCapture);
			}
			process.stdout.write(
				"Preview locale PASS: mounted de/fr manager; real thumbnail readiness/render/cache; conflicting and changed Keys locale.\n",
			);
		}
		if (probe === "all" || probe === "media") {
			await navigate(win, "Keys");
			await ready(win, "document.querySelector('#keys-profile option')");
			// Find the installed Music profile by its actual player key, independent of ID.
			const music = await profiles.runtime.runPromise(
				Effect.flatMap(ProfileRepository, (repo) =>
					Effect.map(repo.load(), (env) =>
						env.envelope.profiles.find((p) =>
							p.pages.some((page) =>
								page.keys.some((k) => k.config.type === "playAudio"),
							),
						),
					),
				),
			);
			assert(music);
			await select(win, "#keys-profile", music.id);
			await ready(
				win,
				"document.querySelector('.keys-preview .oq-player[data-state=playing] .oq-player-main:not(:disabled)')",
			);
			const playerCode = await evaluate(
				win,
				"document.querySelector('.keys-preview .oq-player').closest('[data-key-code]').dataset.keyCode",
			);
			assert.equal(typeof playerCode, "string");
			const checkpoint = outbound.length;
			await nativeClick(win, ".keys-preview .oq-player-main");
			await evaluate(win, "new Promise(resolve=>setTimeout(resolve,100))");
			assert.deepEqual(
				actions,
				[],
				"Clicking the nested transport area must never play/pause",
			);
			await ready(win, "document.querySelector('#key-function')");
			assert.equal(
				await evaluate(
					win,
					"document.querySelector('.keys-cells button[aria-pressed=true]').textContent",
				),
				playerCode,
				"A native mouse click on transport artwork selects its key",
			);
			await evaluate(
				win,
				`(()=>{const el=document.querySelector('.keys-preview .oq-player-main');const r=el.getBoundingClientRect();el.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));})()`,
			);
			await ready(win, "document.querySelector('#key-function')");
			assert.equal(
				await evaluate(win, "document.querySelector('#key-function').value"),
				"playAudio",
			);
			assert.equal(
				await evaluate(
					win,
					`document.querySelector('.keys-cells button[aria-pressed=true]').textContent`,
				),
				playerCode,
			);
			await evaluate(
				win,
				`(()=>{const el=document.querySelector('.keys-preview .oq-player-main');for(const name of ['quake-sub-touch-start','quake-sub-touch-end'])el.dispatchEvent(new CustomEvent(name,{detail:{phase:name.endsWith('start')?'start':'end',isEffective:true,confirmedTap:true}}));el.dispatchEvent(new DragEvent('dragstart',{bubbles:true,cancelable:true}));el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true}));el.focus();})()`,
			);
			win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
			win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
			await evaluate(win, "new Promise(resolve=>setTimeout(resolve,150))");
			assert.deepEqual(
				actions,
				[],
				"Preview interactions must send zero real media commands",
			);
			assert.deepEqual(network, []);
			await evaluate(
				win,
				"document.querySelector('.keys-preview').scrollIntoView({block:'center'})",
			);
			await capture(win, "editor-music-grid");
			await evaluate(
				win,
				"document.querySelectorAll('.keys-cells button')[1].focus()",
			);
			win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Space" });
			win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Space" });
			await ready(
				win,
				"document.querySelectorAll('.keys-cells button')[1].getAttribute('aria-pressed')==='true'",
			);
			assert.deepEqual(actions, []);
			// With enrichment enabled, a preview must not start a weather provider
			// or make clock transport/theme and meeting controls actionable.
			await evaluate(
				win,
				`window.quakeWeatherMedia.request({_tag:"configure",settings:${JSON.stringify({ ...weatherSettings, musicEnabled: true })}})`,
			);
			const afterConfigure = outbound.length;
			await select(win, "#keys-profile", "1-7");
			await ready(
				win,
				"document.querySelector('.keys-preview .oq-clock [data-quake-sub-touch]')",
			);
			await evaluate(
				win,
				`document.querySelectorAll('.keys-preview [data-quake-sub-touch]').forEach(el=>{el.click();el.dispatchEvent(new CustomEvent('quake-sub-touch-end',{detail:{isEffective:true,confirmedTap:true,phase:'end',y:0,startY:0}}))})`,
			);
			await capture(win, "editor-clock-grid");
			await select(win, "#keys-profile", "1-1");
			await ready(win, "document.querySelector('.keys-preview .meeting-key')");
			await nativeClick(win, ".keys-preview .meeting-key");
			await evaluate(
				win,
				"document.querySelector('.keys-preview .meeting-key').click()",
			);
			await capture(win, "editor-meeting-grid");
			await evaluate(win, "new Promise(resolve=>setTimeout(resolve,100))");
			assert.deepEqual(actions, []);
			assert.deepEqual(network, []);
			const hostCommands = outbound
				.slice(checkpoint)
				.filter(({ channel, input }, index) => {
					if (checkpoint + index === afterConfigure - 1) return false;
					if (typeof input !== "object" || input === null) return false;
					const tag =
						"_tag" in input
							? input._tag
							: "type" in input
								? input.type
								: "action" in input
									? input.action
									: undefined;
					return (
						tag !== "read" &&
						tag !== "Read" &&
						!(
							channel === "keys:request" &&
							(tag === "select" || tag === "preview" || tag === "revert")
						)
					);
				});
			assert.deepEqual(
				hostCommands,
				[],
				"Preview must not send media, weather, voice, meeting, clock or runtime actions",
			);
			// The live strip owns the Keys locale from its first paint onward.
			await evaluate(win, 'localStorage.setItem("open-quake-key-locale","de")');
			await profiles.connect("desktop-preview", localeProfile.id);
			await profiles.select(localeProfile.id);
			await panel.loadURL(`${renderer}?surface=panel`);
			await ready(panel, "document.querySelector('.strip-tile-title')");
			assert.deepEqual(
				await evaluate(panel, titleExpression(".strip-screen")),
				["Aufnahme"],
			);
			await evaluate(
				panel,
				'localStorage.setItem("open-quake-key-locale","fr");window.dispatchEvent(new Event("key-locale"))',
			);
			await ready(panel, `${titleExpression(".strip-screen")}[0]==="Enreg."`);
			await evaluate(
				panel,
				'localStorage.setItem("open-quake-key-locale","de");window.dispatchEvent(new StorageEvent("storage",{key:"open-quake-key-locale"}))',
			);
			await ready(panel, `${titleExpression(".strip-screen")}[0]==="Aufnahme"`);
			await profiles.connect("desktop-preview", music.id);
			await profiles.select(music.id);
			await panel.loadURL(`${renderer}?surface=panel`);
			await ready(
				panel,
				"document.querySelector('.oq-player[data-state=playing] .oq-player-main:not(:disabled)')",
			);
			await evaluate(
				panel,
				"document.querySelector('.oq-player-main').click()",
			);
			await ready(panel, "document.querySelector('.oq-player')");
			await evaluate(panel, "new Promise(resolve=>setTimeout(resolve,100))");
			assert.deepEqual(
				actions,
				["pause"],
				"Live strip still reaches the actual media adapter",
			);
			await evaluate(
				panel,
				"document.querySelector('.oq-player-next').dispatchEvent(new CustomEvent('quake-sub-touch-end',{detail:{isEffective:true}}))",
			);
			await evaluate(panel, "new Promise(resolve=>setTimeout(resolve,100))");
			assert.deepEqual(actions, ["pause", "next"]);
			await capture(panel, "live-music");
			await writeFile(
				join(scratch, "outbound.json"),
				JSON.stringify({ actions, network, hostCommands }, null, 2),
			);
			process.stdout.write(
				"Preview inert PASS: mounted controllable Music; nested click selects key; keyboard/drag/native events send zero host commands; live strip click/native transport works.\n",
			);
		}
	} catch (cause) {
		failed = true;
		process.stderr.write(
			`${cause instanceof Error ? cause.stack : String(cause)}\n`,
		);
		await writeFile(
			join(scratch, "failure-outbound.json"),
			JSON.stringify({ actions, network, outbound }, null, 2),
		);
		if (manager && !manager.isDestroyed()) await capture(manager, "failure");
	} finally {
		ipcMain.handle = handle;
		for (const dispose of disposals.reverse()) await dispose();
		for (const win of BrowserWindow.getAllWindows()) win.destroy();
		await rm(directory, { recursive: true, force: true });
		app.exit(failed ? 1 : 0);
	}
}
void smoke().catch((cause) => {
	process.stderr.write(`${String(cause)}\n`);
	app.exit(1);
});
