/** Mounted clock lane acceptance. Hidden mock windows, fake HTTP/media, no HID or audio. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { builtinProfiles } from "../../../../../packages/device/src/profiles/profile-catalog.js";
import { Profile } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository.js";
import { CLOCK_REQUEST, CLOCK_SNAPSHOT } from "../../shared/clock-contracts";
import { WEATHER_MEDIA_REQUEST } from "../../shared/weather-media-contracts";
import {
	WeatherNetworkFailed,
	WeatherRequestTimedOut,
} from "../../shared/weather-media-errors";
import { MediaLive, registerMedia } from "../media";
import { registerProfiles } from "../profiles";
import { activeClockTarget } from "../profiles/clock-profile-binding";
import { registerWeatherMedia } from "../weather-media";
import { WeatherMediaController } from "../weather-media/controller";
import { weatherSettingsLive } from "../weather-media/settings-repository";
import { systemMediaStub } from "../weather-media/system-media";
import { cityFixture, forecastFixture } from "../weather-media/test-fixtures";
import { WeatherNetwork } from "../weather-media/weather-network";
import { ClockStore } from "./clock-store";
import { ClockLive, registerClock, registerClockScheme } from "./index";

assert.equal(process.env.OPEN_QUAKE_MOCK_DEVICE, "1");
if (process.platform === "darwin") app.setActivationPolicy("prohibited");
registerClockScheme();
app.on("window-all-closed", () => {});

async function smoke(): Promise<void> {
	const artifacts = resolve(process.argv[2] || ".");
	assert(process.argv[2], "Pass a screenshot directory");
	await mkdir(artifacts, { recursive: true });
	const root = await mkdtemp(join(artifacts, "clock-native-"));
	app.setPath("userData", root);
	const preset = builtinProfiles("darwin").find((p) => p.id === "1-7");
	assert(preset);
	const raw = Schema.encodeSync(Profile)(preset);
	const firstPage = raw.pages[0];
	assert(firstPage);
	const a = {
		...raw,
		id: "clock-a",
		name: "First clock",
		pages: [firstPage, { ...firstPage, id: "other-clock-page" }] as const,
	};
	const b = { ...a, id: "clock-b", name: "Second clock" };
	const targetA = { profileId: a.id, pageId: a.pages[0].id, keyCode: "1,1" };
	const targetB = { ...targetA, profileId: b.id };
	await writeFile(
		join(root, "profiles-v1.json"),
		JSON.stringify({
			schemaVersion: 1,
			clockConfigVersion: 1,
			manager: {
				revision: 0,
				nextId: 1,
				installed: true,
				hidden: [],
				userHasSetDefault: true,
				links: [],
				approvedCommands: [],
			},
			profiles: [a, b],
			activeByDevice: {
				"desktop-preview": { profileId: a.id, pageId: a.pages[0].id },
			},
		}),
	);
	const page = resolve("out/renderer/index.html");
	const options = {
		show: false,
		useContentSize: true,
		width: 1280,
		height: 1000,
		webPreferences: {
			preload: resolve("out/preload/index.mjs"),
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
			backgroundThrottling: false,
		},
	};
	const evaluate = (win: BrowserWindow, source: string): Promise<unknown> =>
		win.webContents.executeJavaScript(source);
	const wait = (win: BrowserWindow, expression: string) =>
		evaluate(
			win,
			`new Promise((resolve,reject)=>{const end=Date.now()+10000;const check=()=>{if(${expression})return resolve(true);if(Date.now()>end)return reject(new Error('Clock smoke timeout '+${JSON.stringify(expression)}));setTimeout(check,20)};check()})`,
		);
	let assertions = 0;
	const check = (value: unknown, message: string) => {
		assert(value, message);
		assertions++;
		process.stdout.write(`PASS ${message}\n`);
	};
	const screenshots: string[] = [];
	async function capture(win: BrowserWindow, name: string) {
		await evaluate(
			win,
			"document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))",
		);
		await writeFile(
			join(artifacts, `${name}.png`),
			(await win.webContents.capturePage()).toPNG(),
		);
		screenshots.push(`${name}.png`);
	}
	let profiles: ReturnType<typeof registerProfiles> | undefined;
	let clock: ReturnType<typeof registerClock> | undefined;
	let clockRuntime:
		| ManagedRuntime.ManagedRuntime<ClockStore, never>
		| undefined;
	let media: ReturnType<typeof registerMedia> | undefined;
	let weather: ReturnType<typeof registerWeatherMedia> | undefined;
	let weatherCalls = 0;
	const weatherRuntime = () =>
		ManagedRuntime.make(
			WeatherMediaController.Default.pipe(
				Layer.provide(
					Layer.mergeAll(
						weatherSettingsLive(root),
						systemMediaStub("darwin"),
						Layer.succeed(WeatherNetwork, {
							json: (url) =>
								Effect.suspend(
									(): Effect.Effect<
										unknown,
										WeatherNetworkFailed | WeatherRequestTimedOut
									> => {
										weatherCalls++;
										const query = new URL(url).searchParams.get("name");
										if (query === "Offline")
											return Effect.fail(
												WeatherNetworkFailed.fromCause(undefined),
											);
										if (query === "Timeout")
											return Effect.fail(
												WeatherRequestTimedOut.fromCause(undefined),
											);
										return Effect.succeed<unknown>(
											url.includes("geocoding")
												? query === "Missing"
													? { results: [] }
													: cityFixture
												: forecastFixture,
										);
									},
								),
						}),
					),
				),
			),
		);
	const calls: { sender: number; channel: string }[] = [];
	const handle = ipcMain.handle.bind(ipcMain);
	ipcMain.handle = (channel, listener) =>
		handle(channel, (event, input: unknown) => {
			if (channel === CLOCK_REQUEST || channel === WEATHER_MEDIA_REQUEST)
				calls.push({ sender: event.sender.id, channel });
			return listener(event, input);
		});

	async function start() {
		const management = new BrowserWindow(options);
		const panel = new BrowserWindow({ ...options, width: 1920, height: 480 });
		management.webContents.setAudioMuted(true);
		panel.webContents.setAudioMuted(true);
		profiles = registerProfiles(() => management);
		clockRuntime = ManagedRuntime.make(ClockLive(root, profiles.runtime));
		clock = registerClock(clockRuntime, () => management, undefined, {
			panel: () => panel,
			target: async (keyCode) => {
				assert(profiles);
				const { envelope } = await profiles.runtime.runPromise(
					ProfileRepository.load(),
				);
				return activeClockTarget(envelope, "desktop-preview", keyCode);
			},
		});
		media = registerMedia(
			ManagedRuntime.make(MediaLive(join(root, "wallpaper-v1"))),
			() => management,
		);
		weather = registerWeatherMedia(weatherRuntime(), () => management);
		await Promise.all([
			management.loadFile(page),
			panel.loadFile(page, { query: { surface: "panel" } }),
		]);
		await wait(management, "!!document.querySelector('[data-nav-page=keys]')");
		await wait(panel, "!!document.querySelector('.oq-clock')");
		for (const win of [management, panel])
			await evaluate(
				win,
				"Object.defineProperty(document,'hidden',{get:()=>false,configurable:true});document.dispatchEvent(new Event('visibilitychange'))",
			);
		return { management, panel };
	}
	async function stop() {
		for (const win of BrowserWindow.getAllWindows()) win.destroy();
		await clock?.dispose();
		await profiles?.dispose();
		await media?.dispose();
		await weather?.dispose();
		clock = undefined;
		profiles = undefined;
		media = undefined;
		weather = undefined;
	}
	const readClock = async (target = targetA) => {
		assert(clockRuntime);
		return clockRuntime.runPromise(ClockStore.read(target));
	};
	const input = (selector: string, value: string) =>
		`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`;
	const choose = async (win: BrowserWindow) => {
		await evaluate(
			win,
			"[...document.querySelectorAll('.keys-cells button')].find(b=>b.textContent==='1,1').click()",
		);
		await wait(
			win,
			"!!document.querySelector('.clock-theme-radio') && !document.querySelector('.clock-theme-radio').disabled",
		);
	};
	try {
		await app.whenReady();
		if (process.platform === "darwin") app.dock?.hide();
		const { management, panel } = await start();
		await wait(
			panel,
			"!!document.querySelector('[data-testid=clock-weather-card]') && !!document.querySelector('[data-testid=clock-music-card]')",
		);
		check(
			weatherCalls === 0,
			"first-install cards perform no IP or forecast lookup",
		);
		await evaluate(management, "new Promise(r=>setTimeout(r,850))");
		check(
			!calls.some((call) => call.sender === management.webContents.id),
			"Overview clock preview makes no clock/weather requests",
		);
		calls.length = 0;
		await evaluate(
			management,
			"document.querySelector('[data-nav-page=profiles]').click()",
		);
		await wait(
			management,
			"!!document.querySelector('.profile-preview .oq-clock')",
		);
		await evaluate(management, "new Promise(r=>setTimeout(r,850))");
		check(
			!calls.some((call) => call.sender === management.webContents.id),
			"profile previews make no clock/weather requests",
		);
		calls.length = 0;
		await evaluate(
			management,
			"document.querySelector('[data-nav-page=keys]').click()",
		);
		await wait(management, "!!document.querySelector('.keys-cells')");
		await evaluate(management, "new Promise(r=>setTimeout(r,850))");
		check(
			!calls.some(
				(call) =>
					call.sender === management.webContents.id &&
					(call.channel === CLOCK_REQUEST ||
						call.channel === WEATHER_MEDIA_REQUEST),
			),
			"mounted passive grid makes no clock, weather or media bridge calls",
		);

		await choose(management);
		const originalB = await readClock(targetB);
		await evaluate(
			management,
			"window.clockEvents=[];window.quakeClock.onSnapshot(value=>window.clockEvents.push(value));true",
		);
		await evaluate(
			management,
			"[...document.querySelectorAll('.clock-settings label')].find(b=>b.textContent==='12-Hour (AM/PM)').click()",
		);
		await wait(panel, "!!document.querySelector('.oq-clock-meridiem')");
		check(
			(await readClock()).hourFormat === "24h",
			"format draft previews without persisting",
		);
		await evaluate(
			management,
			"[...document.querySelectorAll('.key-editor button')].findLast(b=>b.textContent==='Cancel').click()",
		);
		await wait(panel, "!document.querySelector('.oq-clock-meridiem')");
		check(
			(await readClock()).hourFormat === "24h",
			"Cancel restores saved format",
		);
		await choose(management);
		await evaluate(
			management,
			"[...document.querySelectorAll('.clock-settings label')].find(b=>b.textContent==='12-Hour (AM/PM)').click()",
		);
		// Retain identity and a draft while a device theme arrives.
		await evaluate(
			management,
			"window.clockEditorNode=document.querySelector('.clock-settings')",
		);
		const deviceReply = await evaluate(
			panel,
			"window.quakeClock.request({_tag:'setTheme',keyCode:'1,1',themeId:'aurora'})",
		);
		check(
			Schema.is(Schema.Struct({ _tag: Schema.Literal("success") }))(
				deviceReply,
			),
			"omitted device target resolves through authenticated panel",
		);
		check(
			await evaluate(
				management,
				"window.clockEvents.some(e=>e.source==='device-screen'&&e.target.profileId==='clock-a'&&e.change==='setTheme')",
			),
			"device broadcast identifies its source and target",
		);
		check(
			Schema.is(Schema.Struct({ _tag: Schema.Literal("failure") }))(
				await evaluate(
					panel,
					`window.quakeClock.request({_tag:'setTheme',target:${JSON.stringify(targetB)},keyCode:'1,1',themeId:'anime'})`,
				),
			),
			"panel cannot patch a foreign selected profile",
		);
		await wait(
			management,
			"!!document.querySelector('.clock-theme-card[data-theme=aurora][data-selected=true]')",
		);
		check(
			await evaluate(
				management,
				"window.clockEditorNode===document.querySelector('.clock-settings') && document.querySelector('.clock-settings input[value=\"12h\"]').checked && document.querySelector('.keys-cells button[aria-pressed=true]').textContent==='1,1'",
			),
			"targeted theme keeps mounted editor, selection and unsaved format",
		);
		await evaluate(
			management,
			"[...document.querySelectorAll('.key-editor button')].findLast(b=>b.textContent==='Save').click()",
		);
		await wait(
			management,
			"[...document.querySelectorAll('[role=status]')].some(e=>e.textContent.includes('Saved successfully'))",
		);
		check(
			(await readClock()).hourFormat === "12h",
			"Save persists draft after external theme revision",
		);
		// A targeted unrelated clock update cannot reload this open editor.
		await evaluate(
			management,
			`window.quakeClock.request({_tag:'setTheme',target:${JSON.stringify({ ...targetA, pageId: "other-clock-page" })},keyCode:'1,1',themeId:'cyber'})`,
		);
		check(
			await evaluate(
				management,
				"window.clockEditorNode===document.querySelector('.clock-settings')",
			),
			"another clock does not reload the editor",
		);
		await evaluate(
			management,
			"document.querySelector('.clock-theme-card[data-theme=tactical] input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))",
		);
		await wait(
			management,
			"!!document.querySelector('.clock-theme-card[data-theme=tactical][data-selected=true]')",
		);
		check(
			(await readClock()).themeId === "tactical",
			"theme radio Enter saves selected key",
		);
		await evaluate(
			management,
			"document.querySelector('.clock-theme-card[data-theme=anime] input').focus()",
		);
		management.webContents.sendInputEvent({
			type: "keyDown",
			keyCode: "Space",
		});
		management.webContents.sendInputEvent({ type: "keyUp", keyCode: "Space" });
		await wait(
			management,
			"!!document.querySelector('.clock-theme-card[data-theme=anime][data-selected=true]')",
		);
		check(
			(await readClock()).themeId === "anime",
			"theme radio Space saves selected key",
		);
		check(
			await evaluate(
				management,
				"window.clockEvents.some(e=>e.source==='pc-grid'&&e.target.profileId==='clock-a')",
			),
			"management broadcast stamps pc-grid source",
		);
		const videoPath = join(root, "thumbnail.webm");
		const base64 = await evaluate(
			management,
			`(async()=>{
			const canvas=document.createElement('canvas');canvas.width=960;canvas.height=240;
			const ctx=canvas.getContext('2d');const stream=canvas.captureStream(20);
			const recorder=new MediaRecorder(stream,{mimeType:'video/webm'});const chunks=[];
			recorder.ondataavailable=e=>chunks.push(e.data);const stopped=new Promise(r=>recorder.onstop=r);
			let n=0;const timer=setInterval(()=>{ctx.fillStyle=n++%2?'#135a70':'#8a3410';ctx.fillRect(0,0,960,240)},50);
			recorder.start(200);await new Promise(r=>setTimeout(r,2300));recorder.stop();await stopped;
			clearInterval(timer);stream.getTracks().forEach(t=>t.stop());
			const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());return btoa(Array.from(bytes,b=>String.fromCharCode(b)).join(''));
		})()`,
		);
		assert(typeof base64 === "string");
		await writeFile(videoPath, Buffer.from(base64, "base64"));
		const picker = dialog.showOpenDialog;
		Object.defineProperty(dialog, "showOpenDialog", {
			configurable: true,
			value: async () => {
				await new Promise((r) => setTimeout(r, 150));
				return { canceled: false, filePaths: [videoPath] };
			},
		});
		try {
			await evaluate(
				management,
				"document.querySelector('.clock-theme-card[data-theme=tactical] button').click()",
			);
			await wait(
				management,
				"document.querySelector('.clock-theme-radio').disabled",
			);
			check(true, "theme controls disable while choosing and probing media");
			await wait(
				management,
				"!!document.querySelector('.clock-theme-card[data-theme=tactical] img[src^=\"data:image/jpeg\"]')",
			);
			check(
				await evaluate(
					management,
					"(()=>{const e=document.querySelector('.clock-theme-card[data-theme=tactical] img');return e.complete&&e.naturalWidth===960&&e.naturalHeight===240&&!!e.closest('li').querySelector('.clock-theme-badge')})()",
				),
				"native decoded video produces bounded JPEG and custom badge",
			);
			await capture(management, "clock-video-thumbnail");
		} finally {
			Object.defineProperty(dialog, "showOpenDialog", {
				configurable: true,
				value: picker,
			});
		}
		await rm(videoPath);
		management.webContents.send(CLOCK_SNAPSHOT, await readClock());
		await wait(
			management,
			"!!document.querySelector('.clock-theme-card[data-theme=tactical] .clock-theme-missing')",
		);
		check(true, "missing custom file retains its filename and warning badge");
		await evaluate(
			management,
			"document.querySelector('.clock-theme-card[data-theme=tactical] button[title]').click()",
		);
		await wait(
			management,
			"!document.querySelector('.clock-theme-card[data-theme=tactical] .clock-theme-badge')",
		);
		check(
			!(await readClock()).media.tactical,
			"restore removes selected key's custom background",
		);
		await evaluate(
			management,
			input('.weather-settings input[aria-label="City"]', "Berlin"),
		);
		await wait(
			management,
			"document.querySelector('.weather-verification').textContent.includes('Weather for Berlin')",
		);
		const passiveBefore = await evaluate(
			management,
			"document.querySelector('.keys-preview .oq-clock-time').dataset.time",
		);
		const midnight = `(()=>{const Real=Date;window.clockRealDate=Real;const next=new Real();next.setHours(23,59,59,850);const shift=next.getTime()-Real.now();window.Date=class extends Real{constructor(...args){args.length?super(...args):super(Real.now()+shift)}static now(){return Real.now()+shift}};document.dispatchEvent(new Event('visibilitychange'));true})()`;
		for (const win of [management, panel]) await evaluate(win, midnight);
		await wait(
			management,
			"document.querySelector('.clock-settings .oq-clock-time').dataset.time==='12:00'",
		);
		await wait(
			panel,
			"document.querySelector('.oq-clock-time').dataset.time==='12:00'",
		);
		check(
			await evaluate(
				management,
				`document.querySelector('.keys-preview .oq-clock-time').dataset.time===${JSON.stringify(passiveBefore)}`,
			),
			"mounted passive host freezes while panel and edit host tick across midnight",
		);
		for (const win of [management, panel])
			await evaluate(
				win,
				"window.Date=window.clockRealDate;document.dispatchEvent(new Event('visibilitychange'));true",
			);
		check(
			(await readClock()).weather?.city === "Berlin",
			"debounced city verification saves selected weather action",
		);
		await evaluate(
			management,
			"(()=>{const e=document.querySelector('.weather-settings select');e.value='fahrenheit';e.dispatchEvent(new Event('change',{bubbles:true}))})()",
		);
		await evaluate(
			management,
			"document.querySelector('input[aria-label=\"Music controls\"]').click()",
		);
		await wait(
			panel,
			"!document.querySelector('[data-testid=clock-music-card]')",
		);
		check(
			(await readClock()).musicEnabled === false,
			"music switch reaches selected key and panel",
		);
		await evaluate(
			management,
			input(".weather-settings input[type=url]", "invalid://host"),
		);
		await wait(
			management,
			"!!document.querySelector('.weather-settings [role=alert]')",
		);
		check(
			(await readClock()).weather?.forecastUrl === "",
			"invalid forecast URL never saves",
		);
		for (const [city, fragment] of [
			["Missing", "No city found"],
			["Offline", "verification failed"],
			["Timeout", "timed out"],
		]) {
			await evaluate(
				management,
				input('.weather-settings input[aria-label="City"]', city ?? ""),
			);
			await wait(
				management,
				`document.querySelector('.weather-verification').textContent.includes(${JSON.stringify(fragment)})`,
			);
			check(true, `city ${city} status reaches editor`);
		}
		await evaluate(
			management,
			input('.weather-settings input[aria-label="City"]', "Berlin"),
		);
		await wait(
			management,
			"document.querySelector('.weather-verification').textContent.includes('Weather for Berlin')",
		);
		for (const locale of ["en", "de"]) {
			await evaluate(
				management,
				`Object.defineProperty(navigator,'language',{value:${JSON.stringify(locale)},configurable:true});document.querySelector('#keys-language').value=${JSON.stringify(locale)};document.querySelector('#keys-language').dispatchEvent(new Event('change',{bubbles:true}));`,
			);
			await evaluate(
				management,
				"document.querySelector('.clock-settings').scrollIntoView()",
			);
			await capture(management, `clock-editor-${locale}`);
			await evaluate(
				management,
				"document.querySelector('.weather-settings').scrollIntoView()",
			);
			await capture(management, `clock-enrichment-${locale}`);
		}
		await capture(panel, "clock-panel");
		const savedA = await readClock();
		const savedB = await readClock(targetB);
		check(
			savedB.hourFormat === originalB.hourFormat &&
				savedB.weather?.city === originalB.weather?.city &&
				savedB.musicEnabled === originalB.musicEnabled,
			"other profile's format, weather and music stay unchanged",
		);
		// The management grid is a mounted passive consumer beside the active panel.
		check(
			await evaluate(
				management,
				"!document.querySelector('.keys-preview .oq-clock-meridiem') && !!document.querySelector('.keys-preview [data-testid=clock-music-card]')===false",
			),
			"passive preview forces 24h and follows card switches",
		);
		const passiveTime = await evaluate(
			management,
			"document.querySelector('.keys-preview .oq-clock').textContent",
		);
		await evaluate(
			management,
			"(()=>{const now=Date.now()+86400000;const NativeDate=Date;window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[now]))}static now(){return now}};document.dispatchEvent(new Event('visibilitychange'));})()",
		);
		check(
			await evaluate(
				management,
				`document.querySelector('.keys-preview .oq-clock').textContent===${JSON.stringify(passiveTime)}`,
			),
			"passive time stays frozen across resume",
		);
		await evaluate(
			management,
			"window.Date=window.clockRealDate;document.dispatchEvent(new Event('visibilitychange'));true",
		);
		await evaluate(
			management,
			"(()=>{window.clockTimeout=setTimeout;window.clockClear=clearTimeout;window.clockHandles=new Set();window.clockCleared=0;window.setTimeout=(fn,ms,...args)=>{const id=window.clockTimeout(()=>{window.clockHandles.delete(id);fn(...args)},ms);if(ms>=900&&ms<=1000)window.clockHandles.add(id);return id};window.clearTimeout=id=>{if(window.clockHandles.delete(id))window.clockCleared++;window.clockClear(id)}})()",
		);
		await evaluate(
			management,
			`window.quakeClock.request({_tag:'setSeconds',target:${JSON.stringify(targetA)},showSeconds:true})`,
		);
		await wait(
			management,
			"!!document.querySelector('.clock-settings .oq-clock-seconds')",
		);
		const secondBefore = await evaluate(
			panel,
			"document.querySelector('.oq-clock-seconds')?.textContent",
		);
		await wait(
			panel,
			`document.querySelector('.oq-clock-seconds')?.textContent!==${JSON.stringify(secondBefore)}`,
		);
		await wait(management, "window.clockHandles.size>0");
		check(true, "mounted panel and edit hosts tick with seconds enabled");
		await evaluate(
			management,
			"document.querySelector('.keys-preview').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))",
		);
		await wait(management, "!document.querySelector('.clock-settings')");
		check(
			await evaluate(
				management,
				"window.clockCleared>0&&window.clockHandles.size===0",
			),
			"editor unmount clears its live second timer",
		);
		await evaluate(
			management,
			"window.setTimeout=window.clockTimeout;window.clearTimeout=window.clockClear;true",
		);
		await evaluate(
			management,
			`window.quakeClock.request({_tag:'setSeconds',target:${JSON.stringify(targetA)},showSeconds:false})`,
		);
		// Preserve the PR82 regression: Screen controls follow the displayed serial.
		await evaluate(
			management,
			`(async()=>{await window.quakeKeyLibrary.request({type:'select',deviceId:'QUAKE-MOCK',profileId:'clock-b',pageId:${JSON.stringify(targetB.pageId)}});await window.quakeWallpaper.request({_tag:'select',serial:'QUAKE-MOCK'});document.querySelector('[data-nav-page=screen]').click()})()`,
		);
		await wait(
			management,
			"!!document.querySelector('.clock-settings input[value=\"24h\"]') && document.querySelector('.clock-settings input[value=\"24h\"]').checked",
		);
		check(true, "Screen settings resolve the displayed serial's clock");
		const foreign = await readClock();
		management.webContents.send(CLOCK_SNAPSHOT, {
			...foreign,
			revision: foreign.revision + 100,
		});
		const { target: _target, ...targetless } = foreign;
		management.webContents.send(CLOCK_SNAPSHOT, {
			...targetless,
			revision: 1000,
		});
		await evaluate(management, "new Promise(r=>setTimeout(r,80))");
		check(
			await evaluate(
				management,
				"document.querySelector('.clock-settings input[value=\"24h\"]').checked",
			),
			"Screen ignores foreign and targetless clock broadcasts",
		);
		await evaluate(
			management,
			"document.querySelector('.clock-settings input[value=\"12h\"]').click()",
		);
		await wait(
			management,
			"!document.querySelector('.clock-settings input[value=\"12h\"]').disabled",
		);
		check(
			(await readClock(targetB)).hourFormat === "12h",
			"Screen format writes reach its displayed profile",
		);
		await evaluate(
			management,
			"window.quakeWallpaper.request({_tag:'select',serial:'desktop-preview'})",
		);
		await stop();
		const restarted = await start();
		check(
			(await readClock()).hourFormat === savedA.hourFormat &&
				(await readClock()).weather?.city === savedA.weather?.city &&
				(await readClock()).musicEnabled === false,
			"all selected-key settings survive owner restart",
		);
		await wait(
			restarted.panel,
			"!!document.querySelector('.oq-clock-meridiem') && !document.querySelector('[data-testid=clock-music-card]')",
		);
		await capture(restarted.panel, "clock-after-restart");
		await stop();
		check(
			BrowserWindow.getAllWindows().length === 0,
			"all hidden windows closed",
		);
		const disk = JSON.parse(
			await readFile(join(root, "profiles-v1.json"), "utf8"),
		);
		check(
			disk.profiles.length === 2,
			"canonical profile file retains both clocks",
		);
		await writeFile(
			join(artifacts, "result.json"),
			JSON.stringify(
				{ assertions, screenshots, weatherCalls, hardware: "unverified" },
				null,
				2,
			),
		);
		await rm(root, { recursive: true, force: true });
		process.stdout.write(
			`Clock lane smoke PASS: ${assertions} assertions, ${screenshots.length} screenshots\n`,
		);
		app.quit();
	} catch (cause) {
		process.stderr.write(
			`${cause instanceof Error ? cause.stack : String(cause)}\n`,
		);
		for (const [i, win] of BrowserWindow.getAllWindows().entries()) {
			process.stderr.write(
				`${JSON.stringify(await evaluate(win, "({statuses:[...document.querySelectorAll('[role=status]')].map(e=>e.textContent), buttons:[...document.querySelectorAll('.key-editor button')].filter(e=>e.textContent==='Save').map(e=>({text:e.textContent,disabled:e.matches(':disabled'),parent:e.parentElement.outerHTML.slice(0,900)}))})").catch(String))}\n`,
			);
			if (!win.isDestroyed()) await capture(win, `failed-${i}`).catch(() => {});
		}
		await stop();
		app.exit(1);
	}
}
void smoke().catch((cause) => {
	process.stderr.write(`${String(cause)}\n`);
	app.exit(1);
});
