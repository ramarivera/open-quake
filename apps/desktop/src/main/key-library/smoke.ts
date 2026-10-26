/** Full native editor/preload/main/strip consumer proof. Mock mode is mandatory. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, ManagedRuntime, Schema } from "effect";
import { app, BrowserWindow, dialog, nativeImage } from "electron";
import {
	createEmptyProfileKey,
	Profile,
	ProfileKey,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository.js";
import { QUAKE_EVENT_CHANNEL } from "../../preload/quake";
import { KeyReply, type KeyRequest } from "../../shared/key-library";
import { ClockLive, registerClock, registerClockScheme } from "../clock";
import { registerHardware } from "../hardware";
import { registerKnob } from "../knob";
import { DeviceLifecycle } from "../lifecycle/lifecycle-service";
import { registerLifecycle } from "../lifecycle/registration";
import { registerMaintenance } from "../maintenance";
import { registerManagementAppearance } from "../management/appearance";
import { MediaLive, registerMedia } from "../media";
import { registerMeetings } from "../meetings";
import { registerProfiles } from "../profiles";
import { iconZip } from "../test/icon-pack-fixtures";
import { smokeFont } from "../test/smoke-font";
import { createToneRecorder, registerVoiceSurface } from "../voice";
import { playKeyAlarm } from "./alarm";
import { resetKeysOnLinkLoss } from "./device-status";
import { verifyIconsLane } from "./icons-lane-smoke";
import {
	interceptEditorRequests,
	verifyEditorTransactions,
} from "./smoke-editor";
import { verifyFinalReview } from "./smoke-final-review";
import { verifyGeometryPagesImport } from "./smoke-geometry";
import { verifyIconReview } from "./smoke-icon-review";
import { verifyReviewEditor } from "./smoke-review";

registerClockScheme();
// Retain explicit failure status while the final owned window is disposed.
app.on("window-all-closed", () => {});
assert.equal(process.env.OPEN_QUAKE_MOCK_DEVICE, "1", "Mock mode required");
if (
	["icons-lane", "geometry-pages-import"].includes(
		process.env.OPEN_QUAKE_KEY_REVIEW_PROBE ?? "",
	)
) {
	// Native renderer checks stay hidden and never activate the desktop.
	if (process.platform === "darwin") app.setActivationPolicy("prohibited");
	BrowserWindow.prototype.showInactive = () => {};
}
const scratchArg = process.argv[2];
assert(scratchArg, "Provide an absolute scratch directory");
const scratch = resolve(scratchArg);
const sleep = (ms = 120): Promise<void> =>
	new Promise((done) => setTimeout(done, ms));
const waitForClosed = async (win: BrowserWindow): Promise<void> => {
	const deadline = Date.now() + 8000;
	while (!win.isDestroyed() && Date.now() < deadline) await sleep(20);
	assert(win.isDestroyed(), "Owned icon picker did not close within 8 seconds");
};
const evalIn = (win: BrowserWindow, source: string): Promise<unknown> =>
	win.webContents.executeJavaScript(source);
const ready = async (win: BrowserWindow, expression: string): Promise<void> => {
	await win.webContents.executeJavaScript(
		`new Promise((resolve,reject)=>{const limit=Date.now()+8000;const check=()=>{if(${expression})resolve(true);else if(Date.now()>limit)reject(new Error(${JSON.stringify(expression)}));else setTimeout(check,20);};check()})`,
	);
};
const request = async (win: BrowserWindow, command: KeyRequest) =>
	Schema.decodeUnknownSync(KeyReply)(
		await evalIn(
			win,
			`window.quakeKeyLibrary.request(${JSON.stringify(command)})`,
		),
	);
const iconRequest = async (manager: BrowserWindow, command: KeyRequest) => {
	const token = `smoke-import-${Date.now()}`;
	const pending = request(manager, { type: "open-icons", token, locale: "en" });
	try {
		return await request(await iconPicker(manager), command);
	} finally {
		await request(manager, { type: "cancel-icons", token });
		await pending;
	}
};
const click = async (win: BrowserWindow, selector: string): Promise<void> => {
	await ready(win, `document.querySelector(${JSON.stringify(selector)})`);
	await evalIn(
		win,
		`document.querySelector(${JSON.stringify(selector)}).click()`,
	);
	await sleep();
};
const button = async (win: BrowserWindow, text: string): Promise<void> => {
	const page =
		text === "Keys" ? "keys" : text === "Appearance" ? "appearance" : undefined;
	if (page) {
		await click(win, `[data-nav-page="${page}"]`);
		await ready(
			win,
			`document.querySelector('[data-nav-page="${page}"]')?.getAttribute('aria-current') === 'page'`,
		);
		return;
	}
	await ready(
		win,
		`Array.from(document.querySelectorAll("button")).some(b=>b.textContent.trim()===${JSON.stringify(text)})`,
	);
	await evalIn(
		win,
		`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
	);
	await sleep();
};
const input = async (
	win: BrowserWindow,
	selector: string,
	value: string,
): Promise<void> => {
	await ready(win, `document.querySelector(${JSON.stringify(selector)})`);
	process.stdout.write(`keys smoke: type ${selector} ${value}\n`);
	await evalIn(
		win,
		`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.focus();el.select();})()`,
	);
	await win.webContents.insertText(value);
	await sleep();
};
const select = async (
	win: BrowserWindow,
	selector: string,
	value: string,
): Promise<void> => {
	process.stdout.write(`keys smoke: select ${selector} ${value}\n`);
	await ready(
		win,
		`Array.from(document.querySelector(${JSON.stringify(selector)})?.options ?? []).some(option => option.value === ${JSON.stringify(value)})`,
	);
	await ready(win, `document.querySelector(${JSON.stringify(selector)})`);
	await evalIn(
		win,
		`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`,
	);
	await ready(
		win,
		`document.querySelector(${JSON.stringify(selector)})?.value === ${JSON.stringify(value)}`,
	);
	if (selector === "#keys-profile" || selector === "#keys-page")
		await ready(
			win,
			"!document.querySelector('#key-title') && document.querySelector('.key-editor')?.getAttribute('aria-busy') === 'false'",
		);
	await sleep();
};
const snapshot = async (win: BrowserWindow, name: string): Promise<void> => {
	await sleep();
	await writeFile(
		join(scratch, `${name}.png`),
		(await win.webContents.capturePage()).toPNG(),
	);
};
const iconPicker = async (manager: BrowserWindow): Promise<BrowserWindow> => {
	const end = Date.now() + 12000;
	while (Date.now() < end) {
		const child = BrowserWindow.getAllWindows().find(
			(win) =>
				win.getParentWindow() === manager &&
				new URL(win.webContents.getURL() || "about:blank").searchParams.get(
					"surface",
				) === "icons",
		);
		if (child) {
			assert.deepEqual(child.getMinimumSize(), [600, 550]);
			assert.equal(child.isResizable(), true);
			await ready(
				child,
				"document.querySelector('.icon-library-body[aria-busy=false]') && document.querySelectorAll('.icon-library-cell').length === 10 * Math.max(1, Math.floor(innerWidth / (72 + 12)))",
			);
			return child;
		}
		await sleep(25);
	}
	throw new Error("Owned native icon picker did not open");
};
const key = (code: string, type: string, actions: unknown[], extra = {}) => {
	const empty = Schema.encodeSync(ProfileKey)(createEmptyProfileKey(code));
	return Schema.decodeUnknownSync(ProfileKey)({
		...empty,
		childrenName: type,
		config: {
			...empty.config,
			type,
			supportTouchEffect: true,
			display: true,
			actions,
			...extra,
			title: { ...empty.config.title, text: type, display: true },
		},
	});
};
let selectedPath = "";
dialog.showOpenDialog = async () => ({
	canceled: false,
	filePaths: [selectedPath],
});
async function smoke(): Promise<void> {
	let failed = false;
	await mkdir(scratch, { recursive: true });
	const directory = await mkdtemp(
		join(process.env.OPEN_QUAKE_SMOKE_SCRATCH ?? scratch, "keys-native-"),
	);
	app.setPath("userData", directory);
	let profiles: ReturnType<typeof registerProfiles> | undefined,
		media: ReturnType<typeof registerMedia> | undefined,
		clock: ReturnType<typeof registerClock> | undefined;
	let knob: ReturnType<typeof registerKnob> | undefined;
	let voice: ReturnType<typeof registerVoiceSurface> | undefined;
	let maintenance: ReturnType<typeof registerMaintenance> | undefined;
	let meetings: ReturnType<typeof registerMeetings> | undefined;
	let disposeLifecycle = async () => {},
		removeHardware = () => {};
	let removeAppearance = () => {};
	let management: BrowserWindow | undefined;
	let delays: ReturnType<typeof interceptEditorRequests> | undefined;
	try {
		await app.whenReady();
		const options = {
			show: false,
			width: 1400,
			height: 1150,
			webPreferences: {
				preload: resolve("out/preload/index.mjs"),
				sandbox: false,
				contextIsolation: true,
				nodeIntegration: false,
			},
		};
		const manager = new BrowserWindow(options),
			panel = new BrowserWindow({ ...options, width: 960, height: 240 });
		management = manager;
		for (const win of [manager, panel])
			win.webContents.on("render-process-gone", (_event, details) => {
				process.stderr.write(
					`renderer process gone: ${JSON.stringify(details)}\n`,
				);
			});
		for (const win of [manager, panel])
			win.webContents.on("console-message", (details) => {
				if (details.level === "error")
					process.stderr.write(`renderer: ${details.message}\n`);
			});
		const renderer = pathToFileURL(resolve("out/renderer/index.html")).href;
		removeAppearance = registerManagementAppearance(
			() => manager,
			directory,
			renderer,
		);

		delays = interceptEditorRequests();
		profiles = registerProfiles(
			() => manager,
			renderer,
			undefined,
			renderer,
			() => undefined,
			() => panel,
		);
		voice = registerVoiceSurface({
			mock: true,
			tones: createToneRecorder(),
			serial: () => "desktop-preview",
			panel: () => panel,
			management: () => manager,
			renderer,
		});
		meetings = registerMeetings({
			userData: directory,
			mock: true,
			hardware: () => undefined,
		});
		maintenance = registerMaintenance({
			root: directory,
			mock: true,
			renderer,
			hardware: () => undefined,
			management: () => manager,
			stopWriters: async () => {},
		});
		knob = registerKnob(
			() => panel,
			() => [manager, panel],
		);
		media = registerMedia(
			ManagedRuntime.make(MediaLive(join(directory, "media"))),
			() => manager,
		);
		clock = registerClock(
			ManagedRuntime.make(ClockLive(directory)),
			() => manager,
		);
		delays.restore();
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
					prompt: () => Effect.die("No prompts"),
					native: () => Effect.die("No displays"),
					openSettings: () => Effect.void,
				},
			}),
		);
		const removeLifecycle = registerLifecycle(
			lifecycle,
			() => manager,
			renderer,
		);
		disposeLifecycle = async () => {
			removeLifecycle();
			await lifecycle.dispose();
		};
		removeHardware = registerHardware(
			() => undefined,
			() => manager,
			true,
		);
		await Promise.all([
			manager.loadURL(renderer),
			panel.loadURL(`${renderer}?surface=panel`),
		]);
		await evalIn(
			manager,
			'window.quakeProfileManager.request({type:"read",locale:"en"})',
		);
		const custom = Schema.decodeUnknownSync(Profile)({
			id: "keys-smoke",
			name: "Keys smoke",
			revision: 0,
			pages: [
				{
					id: "one",
					keys: [
						key(
							"1,1",
							"hotkeySwitch",
							[
								{ type: "key", value: "control+a" },
								{ type: "key", value: "control+b" },
							],
							{
								compatibility: {
									defaultIcon: "resource:missing/999999",
									defaultAlterIcon: "resource:missing/888888",
								},
							},
						),
						key("1,2", "timer", [
							{ type: "time", value: 1800 },
							{ type: "sound", value: "" },
						]),
						key("1,3", "multiActions", [], {
							subActions: [
								{
									config: {
										type: "delay",
										actions: [{ type: "time", value: 1000 }],
									},
								},
								{
									config: {
										type: "hotkey",
										actions: [{ type: "key", value: "a" }],
									},
								},
							],
						}),
					].map((k) => Schema.encodeSync(ProfileKey)(k)),
				},
				{ id: "two", keys: [] },
			],
		});
		await profiles.runtime.runPromise(
			Effect.flatMap(ProfileRepository, (repository) =>
				repository.transact((env) =>
					Effect.succeed({
						...env,
						profiles: [...env.profiles, custom],
						activeByDevice: {
							...env.activeByDevice,
							"desktop-preview": { profileId: custom.id, pageId: "one" },
						},
					}),
				),
			),
		);
		await button(manager, "Keys");
		await ready(manager, "document.querySelector('#keys-profile')");
		const harness = {
			manager,
			iconPicker,
			profiles,
			scratch,
			delays,
			evalIn,
			ready,
			click,
			button,
			input,
			select,
			snapshot,
		};
		if (process.env.OPEN_QUAKE_KEY_REVIEW_PROBE === "icons-lane") {
			await verifyIconsLane(harness, directory, (path) => {
				selectedPath = path;
			});
			return;
		}
		if (process.env.OPEN_QUAKE_KEY_REVIEW_PROBE === "geometry-pages-import") {
			await verifyGeometryPagesImport(harness);
			return;
		}
		await verifyIconReview(
			harness,
			directory,
			(path) => {
				selectedPath = path;
			},
			process.env.OPEN_QUAKE_KEY_REVIEW_PROBE,
		);
		if (process.env.OPEN_QUAKE_KEY_REVIEW_PROBE?.startsWith("icon-review"))
			return;
		await verifyFinalReview(harness, panel);
		if (process.env.OPEN_QUAKE_KEY_REVIEW_PROBE === "final-review") return;
		await verifyReviewEditor(harness, process.env.OPEN_QUAKE_KEY_REVIEW_PROBE);
		if (process.env.OPEN_QUAKE_KEY_REVIEW_PROBE) return;
		await verifyEditorTransactions(harness);
		await ready(manager, "document.querySelector('#keys-profile')");
		await select(manager, "#keys-profile", custom.id);
		await ready(
			manager,
			"document.querySelector('#keys-profile')?.value === 'keys-smoke' && !document.querySelector('#key-title')",
		);
		await click(manager, ".keys-cells button:first-child");
		await ready(
			manager,
			"document.querySelector('#key-function')?.value === 'hotkeySwitch'",
		);
		await evalIn(
			manager,
			'document.querySelectorAll(".keys-cells button")[0].click();document.querySelectorAll(".keys-cells button")[1].click();true',
		);
		await ready(
			manager,
			'document.querySelector("#key-function")?.value === "timer"',
		);
		await click(manager, ".keys-cells button:first-child");
		await ready(
			manager,
			'document.querySelector("#key-function")?.value === "hotkeySwitch"',
		);
		process.stdout.write("keys smoke: edit preview\n");
		await input(manager, "#key-title", "Live draft");
		await ready(panel, "document.body.innerText.includes('Live draft')");
		const disk = JSON.parse(
			await readFile(join(directory, "profiles-v1.json"), "utf8"),
		);
		assert.equal(
			disk.profiles.find((p: { id: string }) => p.id === custom.id).pages[0]
				.keys[0].config.title.text,
			"hotkeySwitch",
		);
		await evalIn(
			manager,
			"document.querySelector('#key-title').dispatchEvent(new KeyboardEvent('keyup',{key:'Delete',bubbles:true}))",
		);
		assert(
			await evalIn(manager, "Boolean(document.querySelector('#key-title'))"),
		);
		await evalIn(
			manager,
			"document.querySelector('nav').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))",
		);
		await ready(panel, "!document.body.innerText.includes('Live draft')");
		await click(manager, ".keys-cells button:first-child");
		await input(manager, "#key-title", "Saved title");
		await button(manager, "Save");
		await ready(panel, "document.body.innerText.includes('Saved title')");
		await snapshot(manager, "editor-saved");
		// MGMT-260/261: exercise the actual style controls and draft projection.
		await click(manager, ".key-title-settings summary");
		await select(manager, "#key-title-position", "mid");
		await click(manager, 'button[aria-label="bold"]');
		await ready(
			panel,
			"Array.from(document.querySelectorAll('.strip-tile-title')).some(el => el.textContent==='Saved title' && el.style.top==='50%' && el.style.fontWeight==='700')",
		);
		await snapshot(manager, "title-style");
		await click(manager, "#key-title-reset");
		await ready(
			panel,
			"Array.from(document.querySelectorAll('.strip-tile-title')).some(el => el.textContent==='Saved title' && el.style.textDecoration==='underline')",
		);
		await button(manager, "Save");
		await click(manager, ".key-title-settings summary");
		// Full bundled MDI catalog, search debounce, zoom and target-bound selection.
		process.stdout.write("keys smoke: icon library\n");
		await button(manager, "Icon Library");
		const chooser = await iconPicker(manager);
		assert.equal(
			(
				await request(chooser, {
					type: "pick-icon",
					token:
						new URL(chooser.webContents.getURL()).searchParams.get("token") ??
						"",
					data: (await evalIn(
						chooser,
						"(()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=10;return canvas.toDataURL()})()",
					)) as string,
				})
			)._tag,
			"rejected",
			"picker must reject native-decodable images with incorrect dimensions",
		);
		assert.equal(
			(
				await request(chooser, {
					type: "navigate",
					deviceId: "mock",
					direction: 0,
				})
			)._tag,
			"rejected",
		);
		await snapshot(chooser, "icon-library-default");
		await input(chooser, "#icon-search", "alarm");
		await sleep(650);
		assert(
			await evalIn(
				chooser,
				"document.querySelectorAll('.icon-library-cell').length>0",
			),
		);
		await click(chooser, 'button[aria-label="Zoom in"]');
		assert.equal(
			await evalIn(
				chooser,
				`document.querySelector('input[aria-label="Icon size"]').value`,
			),
			"80",
		);
		await snapshot(chooser, "mdi-search-zoom");
		await click(chooser, ".icon-library-cell button");
		await ready(
			manager,
			"Array.from(document.querySelectorAll('.keys-preview img')).some(image => image.src.startsWith('data:image/png;base64,'))",
		);
		await button(manager, "Save");
		await ready(
			manager,
			"document.querySelector('.key-editor')?.getAttribute('aria-busy') === 'false' && document.body.innerText.includes('Saved successfully')",
		);
		const savedIcon = await request(manager, { type: "read", locale: "en" });
		assert(savedIcon._tag === "success");
		const savedKey = savedIcon.envelope?.profiles
			.find((p) => p.id === custom.id)
			?.pages[0]?.keys.find((key) => key.keyCode === "1,1");
		assert(savedKey);
		assert(savedKey.config.icon.startsWith("data:image/png;base64,"));
		assert.deepEqual(
			nativeImage.createFromDataURL(savedKey.config.icon).getSize(),
			{ width: 170, height: 170 },
		);
		// Import picker -> archive parser -> local store -> rendered group.
		const svg =
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="white" d="M0 0h24v24z"/></svg>';
		selectedPath = join(directory, "shapes.zip");
		await writeFile(
			selectedPath,
			iconZip([
				{
					name: "manifest.json",
					data: JSON.stringify({ Name: "Shapes smoke" }),
				},
				{
					name: "icons.json",
					data: JSON.stringify([
						{ path: "square.svg", name: "Square", tags: ["shape"] },
					]),
				},
				{ name: "icons/square.svg", data: svg },
			]),
		);
		process.stdout.write("keys smoke: stream deck import\n");
		const imported = await iconRequest(manager, { type: "import-pack" });
		assert(imported._tag === "success" && imported.packs?.length);
		if (imported._tag !== "success" || !imported.packs?.[0])
			throw new Error("Pack import failed");
		const pack = imported.packs.find((pack) => pack.name === "Shapes smoke");
		assert(pack);
		process.stdout.write("keys smoke: pack references\n");
		const read = await request(manager, { type: "read", locale: "en" });
		assert(read._tag === "success" && read.envelope);
		if (read._tag !== "success" || !read.envelope)
			throw new Error("read failed");
		const p = read.envelope.profiles.find((p) => p.id === custom.id);
		assert(p);
		const target = {
			token: "pack-in-use",
			profileId: p.id,
			pageId: "one",
			keyCode: "1,1",
			revision: p.revision,
		};
		const existing = p.pages[0].keys.find((k) => k.keyCode === "1,1");
		assert(existing);

		await button(manager, "Icon Library");
		const packChooser = await iconPicker(manager);
		await click(packChooser, 'button[aria-label="Shapes smoke"]');
		await click(packChooser, ".icon-library-cell button");
		await ready(
			manager,
			"document.querySelector('.keys-preview img')?.getAttribute('src') !== " +
				JSON.stringify(existing.config.icon),
		);

		assert.equal(
			(await iconRequest(manager, { type: "remove-pack", id: pack.id }))._tag,
			"rejected",
		);
		await button(manager, "Save");
		await ready(
			manager,
			"document.querySelector('.key-editor')?.getAttribute('aria-busy') === 'false' && document.body.innerText.includes('Saved successfully')",
		);
		const packed = await request(manager, { type: "read", locale: "en" });
		assert(packed._tag === "success");
		const packedKey = packed.envelope?.profiles
			.find((profile) => profile.id === p.id)
			?.pages[0]?.keys.find((key) => key.keyCode === "1,1");
		assert(packedKey);
		assert(packedKey.config.icon.startsWith("data:image/png;base64,"));
		assert.equal(
			packedKey.config.compatibility?.iconSource,
			pack.icons[0]?.data,
		);
		await snapshot(manager, "rasterized-pack-saved");
		assert.equal(
			(await iconRequest(manager, { type: "remove-pack", id: pack.id }))._tag,
			"rejected",
		);
		await request(manager, {
			type: "preview",
			target: { ...target, revision: p.revision + 1 },
			key: existing,
		});
		await request(manager, { type: "save", token: target.token });
		assert.equal(
			(await iconRequest(manager, { type: "remove-pack", id: pack.id }))._tag,
			"success",
		);
		// Real Chromium font decode/rasterization from a local system font; no copied font asset.
		selectedPath = join(directory, "font.zip");
		await writeFile(
			selectedPath,
			iconZip([
				{
					name: "iconfont.json",
					data: JSON.stringify({
						name: "Native font",
						glyphs: [{ name: "Letter A", font_class: "a", unicode: "0041" }],
					}),
				},
				{
					name: "iconfont.ttf",
					data: await smokeFont(),
				},
			]),
		);
		process.stdout.write("keys smoke: native font\n");
		const font = await iconRequest(manager, { type: "import-pack" });
		assert(
			font._tag === "success" &&
				font.packs?.some(
					(p) =>
						p.name === "Native font" &&
						p.icons[0]?.data.startsWith("data:image/png;base64,"),
				),
		);
		// Panel tap, sequence progress, countdown and swipe all use production dispatch.
		process.stdout.write("keys smoke: panel dispatch\n");
		await evalIn(
			panel,
			"window.smokeStates=[];window.quakeKeyLibrary.onRuntime(s=>window.smokeStates.push(s));true",
		);
		const touch = async (x: number, y: number, action: number) => {
			panel.webContents.send(QUAKE_EVENT_CHANNEL, {
				source: "mock",
				kind: "touch",
				points: [{ x, y: 480 - y, action }],
			});
			await sleep(25);
		};
		const tap = async (x: number) => {
			await touch(x, 100, 1);
			await touch(x, 100, 0);
			await sleep();
		};
		await tap(100);
		await tap(100);
		assert.deepEqual(
			await evalIn(
				panel,
				"window.smokeStates.filter(s=>s.alternate!==undefined).map(s=>s.alternate)",
			),
			[1, 0],
		);
		await tap(590);
		await ready(panel, "window.smokeStates.some(s=>s.progress===0)");
		await snapshot(panel, "sequence-progress");
		await tap(350);
		await ready(panel, "window.smokeStates.some(s=>s.countdown>0)");
		await snapshot(panel, "countdown");
		await touch(800, 100, 1);
		await evalIn(
			panel,
			"document.getElementById('root').dataset.stripOverlay='true';true",
		);
		await touch(650, 100, 1);
		await evalIn(
			panel,
			"document.getElementById('root').dataset.stripOverlay='false';true",
		);
		await touch(500, 100, 0);
		const retainedPage = await request(manager, { type: "read", locale: "en" });
		assert(
			retainedPage._tag === "success" &&
				retainedPage.envelope?.activeByDevice["desktop-preview"]?.pageId ===
					"one",
			"Picker takeover must cancel a started slide",
		);
		await touch(800, 100, 1);
		await touch(650, 100, 1);
		await touch(500, 100, 0);
		await sleep();
		const next = await request(manager, { type: "read", locale: "en" });
		assert(
			next._tag === "success" &&
				next.envelope?.activeByDevice["desktop-preview"]?.pageId === "two",
		);
		await request(manager, {
			type: "navigate",
			deviceId: "desktop-preview",
			direction: 1,
		});
		const wrapped = await request(manager, { type: "read", locale: "en" });
		assert(
			wrapped._tag === "success" &&
				wrapped.envelope?.activeByDevice["desktop-preview"]?.pageId === "one",
		);
		await ready(panel, "window.smokeStates.some(s=>s.alert===2)");
		await snapshot(panel, "alarm");
		assert.equal(
			(await request(panel, { type: "delete", target }))._tag,
			"rejected",
		);
		const spoof = new BrowserWindow(options);
		await spoof.loadURL(`${renderer}?surface=panel`);
		assert.equal(
			(
				await request(spoof, {
					type: "navigate",
					deviceId: "desktop-preview",
					direction: 1,
				})
			)._tag,
			"rejected",
		);
		assert.equal(
			(
				await request(spoof, {
					type: "activate",
					deviceId: "desktop-preview",
					profileId: custom.id,
					pageId: "one",
					revision: 0,
					keyCode: "1,1",
					kind: "press",
				})
			)._tag,
			"rejected",
		);
		spoof.destroy();
		// Real disconnect composition path with synthetic HID status. Never opens HID.
		await resetKeysOnLinkLoss(
			{
				source: "hid",
				kind: "status",
				state: "disconnected",
				reason: "scope-closed",
			},
			profiles.resetKeys,
		);
		const resetState = await request(manager, { type: "read", locale: "en" });
		assert(resetState._tag === "success" && resetState.states?.length === 0);
		// Reload clears pending drafts even when the renderer cannot send its cleanup IPC.
		const latest = await request(manager, { type: "read", locale: "en" });
		assert(latest._tag === "success" && latest.envelope);
		if (latest._tag !== "success" || !latest.envelope)
			throw new Error("read failed");
		const latestProfile = latest.envelope.profiles.find(
			(p) => p.id === custom.id,
		);
		assert(latestProfile);
		await request(manager, {
			type: "preview",
			target: { ...target, revision: latestProfile.revision },
			key: {
				...existing,
				config: {
					...existing.config,
					title: { ...existing.config.title, text: "Orphaned draft" },
				},
			},
		});
		await manager.loadURL(`${renderer}?surface=foreign`);
		assert.equal(
			(await request(manager, { type: "preview", target, key: existing }))._tag,
			"rejected",
		);
		await ready(panel, "!document.body.innerText.includes('Orphaned draft')");
		await manager.loadURL(renderer);
		await button(manager, "Keys");
		await select(manager, "#keys-profile", custom.id);
		await click(manager, ".keys-cells button:first-child");
		process.stdout.write("keys smoke: icon library\n");
		await button(manager, "Icon Library");
		const resizedChooser = await iconPicker(manager);
		await snapshot(resizedChooser, "icon-library");
		assert(
			await evalIn(
				resizedChooser,
				"document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight",
			),
		);
		const initialCount = await evalIn(
			resizedChooser,
			"document.querySelectorAll('.icon-library-cell').length",
		);
		await evalIn(
			resizedChooser,
			"document.querySelector('.icon-library-grid').scrollTop=100000;true",
		);
		await sleep();
		assert.notEqual(
			await evalIn(
				resizedChooser,
				"document.querySelectorAll('.icon-library-cell').length",
			),
			initialCount,
		);
		resizedChooser.setContentSize(900, 650);
		await ready(
			resizedChooser,
			"document.querySelectorAll('.icon-library-cell').length === 10 * Math.floor(innerWidth / 84)",
		);
		await snapshot(resizedChooser, "icon-library-wide");
		await click(resizedChooser, 'button[aria-label="Installed applications"]');
		await ready(
			resizedChooser,
			"Array.from(document.querySelectorAll('.icon-library-cell img')).some(image => image.complete && image.naturalWidth > 0)",
		);
		await snapshot(resizedChooser, "installed-application-artwork");
		await click(resizedChooser, ".icon-library-cell button");
		await waitForClosed(resizedChooser);
		await button(manager, "Save");
		await ready(
			manager,
			"document.querySelector('.key-editor')?.getAttribute('aria-busy') === 'false' && document.body.innerText.includes('Saved successfully')",
		);
		await button(manager, "Icon Library");
		const cancelledChooser = await iconPicker(manager);
		await select(manager, "#key-function", "text");
		await waitForClosed(cancelledChooser);
		await click(manager, 'button[aria-label="Reset icon to default"]');
		await ready(
			manager,
			`(()=>{const image=document.querySelector('.keys-preview [data-key-code="1,1"] img');return image?.src.startsWith('data:image/svg+xml,') && image.complete && image.naturalWidth>0})()`,
		);
		await snapshot(manager, "semantic-fallback-preview");
		await input(manager, "#key-action-0", "Quiet fallback");
		await button(manager, "Save");
		await ready(
			manager,
			"document.querySelector('.key-editor')?.getAttribute('aria-busy') === 'false' && document.body.innerText.includes('Saved successfully')",
		);
		const fallback = await request(manager, { type: "read", locale: "en" });
		assert(fallback._tag === "success");
		const fallbackKey = fallback.envelope?.profiles
			.find((p) => p.id === custom.id)
			?.pages[0]?.keys.find((key) => key.keyCode === "1,1");
		assert(fallbackKey?.config.icon.startsWith("data:image/svg+xml,"));
		manager.setContentSize(680, 1000);
		await sleep();
		assert(
			await evalIn(manager, "document.documentElement.scrollWidth<=innerWidth"),
		);
		await evalIn(
			manager,
			'document.querySelector(".key-editor").scrollIntoView({block:"start"});true',
		);
		await snapshot(manager, "editor-narrow");
		// Clock format uses the existing wallpaper owner and persists without Save.
		await select(manager, "#keys-profile", "1-7");
		await ready(
			manager,
			"document.querySelector('#keys-profile').value==='1-7' && !document.querySelector('#key-title') && document.querySelectorAll('.keys-cells button').length===16",
		);
		await request(manager, { type: "read", locale: "en" });
		await sleep(250);
		await click(manager, ".keys-cells button:first-child");
		await ready(manager, "document.querySelector('#key-clock-format')");
		await select(manager, "#key-clock-format", "12h");
		assert(
			await evalIn(
				manager,
				'window.quakeWallpaper.request({_tag:"read"}).then(reply=>reply._tag === "success" && reply.snapshot.saved.clock.actions[0].value === "12h")',
			),
		);
		await ready(
			manager,
			"Array.from(document.querySelectorAll('.keys-preview .oq-clock-time')).some(el=>/AM|PM/.test(el.getAttribute('aria-label')??''))",
		);
		await snapshot(manager, "clock-auto-save");
		// Native audio decoding/playback and cleanup, using a silent 20ms WAV.
		const wav = Buffer.alloc(44 + 882 * 2);
		wav.write("RIFF");
		wav.writeUInt32LE(wav.length - 8, 4);
		wav.write("WAVEfmt ", 8);
		wav.writeUInt32LE(16, 16);
		wav.writeUInt16LE(1, 20);
		wav.writeUInt16LE(1, 22);
		wav.writeUInt32LE(44100, 24);
		wav.writeUInt32LE(88200, 28);
		wav.writeUInt16LE(2, 32);
		wav.writeUInt16LE(16, 34);
		wav.write("data", 36);
		wav.writeUInt32LE(wav.length - 44, 40);
		const audio = join(directory, "silent.wav");
		await writeFile(audio, wav);
		await playKeyAlarm(audio, new AbortController().signal);
		process.stdout.write(
			"Key library native smoke PASS: editor preview/revert/Save/Delete focus; 7447 MDI icons/search/zoom; safe pack import/protection; native font and audio; real panel alternation/progress/countdown/alarm/wrap/swipe; authority/reload cleanup; responsive screenshots.\n",
		);
	} catch (cause) {
		failed = true;
		await writeFile(
			join(scratch, "keys-requests-failure.json"),
			JSON.stringify(delays?.requests, null, 2),
		);
		process.stderr.write(
			`${cause instanceof Error ? cause.stack : String(cause)}\n`,
		);
		if (management && !management.isDestroyed()) {
			await snapshot(management, "keys-failure");
			await writeFile(
				join(scratch, "keys-failure.txt"),
				String(await evalIn(management, "document.body.innerText")),
			);
		}
	} finally {
		removeAppearance();
		delays?.releaseAll();
		removeHardware();
		await disposeLifecycle();
		await meetings?.dispose();
		await maintenance?.dispose();
		await voice?.dispose();
		await knob?.dispose();
		await profiles?.dispose();
		await media?.dispose();
		await clock?.dispose();
		for (const win of BrowserWindow.getAllWindows()) win.destroy();
		await rm(directory, { recursive: true, force: true });
		app.exit(failed ? 1 : 0);
	}
}
void smoke().catch((cause: unknown) => {
	process.stderr.write(`${String(cause)}\n`);
	app.exit(1);
});
