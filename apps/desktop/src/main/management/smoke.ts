/** Production preload/renderer and real main handlers. Electron only, mock hardware required. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, ManagedRuntime, Schema } from "effect";
import { app, BrowserWindow, dialog, nativeImage, nativeTheme } from "electron";
import { QUAKE_EVENT_CHANNEL, type QuakeEvent } from "../../preload/quake";
import { AgentReply } from "../../shared/agents";
import { EmojiReply } from "../../shared/emoji";
import { encodeGif } from "../../shared/gif";
import { IntegrationReply } from "../../shared/integrations";
import { MANAGEMENT_ACTIVATE } from "../../shared/management";
import { registerAgents } from "../agents";
import { ClockLive, registerClock, registerClockScheme } from "../clock";
import { registerEmoji } from "../emoji";
import { registerHardware } from "../hardware";
import { registerIntegrations } from "../integrations";
import { registerKnob } from "../knob";
import { DeviceLifecycle } from "../lifecycle/lifecycle-service";
import { registerLifecycle } from "../lifecycle/registration";
import { MediaLive, registerMedia } from "../media";
import { registerMonitor } from "../monitor";
import { registerProfiles } from "../profiles";
import { registerManagementAppearance } from "./appearance";
import { managementAgentCredentials } from "./credentials";

assert.equal(
	process.env.OPEN_QUAKE_MOCK_DEVICE,
	"1",
	"Never run native smoke against hardware",
);
registerClockScheme();
const settle = (ms = 180) => new Promise<void>((done) => setTimeout(done, ms));
const directory = mkdtempSync(join(tmpdir(), "oq-management-smoke-"));
app.setPath("userData", directory);
let selectedFile: string | undefined;
dialog.showOpenDialog = async () => ({
	canceled: selectedFile === undefined,
	filePaths: selectedFile ? [selectedFile] : [],
});
const artifacts = process.argv[2] ?? "";
assert(artifacts, "Supply screenshot directory");
const renderer = pathToFileURL(resolve("out/renderer/index.html")).href;
let state = "on";
let services = 0;
const server = createServer((req, res) => {
	assert.equal(req.headers.authorization, "Bearer smoke-local-fixture");
	assert(!req.url?.includes("smoke-local-fixture"));
	res.setHeader("Content-Type", "application/json");
	const entity = {
		entity_id: "light.studio",
		state,
		attributes: {
			friendly_name: "Studio light",
			brightness: 180,
			icon: "mdi:lightbulb",
		},
	};
	if (req.url === "/api/") res.end(JSON.stringify({ message: "API running." }));
	else if (req.url === "/api/template") {
		req.resume();
		res.end(JSON.stringify([]));
	} else if (req.url === "/api/states") res.end(JSON.stringify([entity]));
	else if (req.url === "/api/states/light.studio")
		res.end(JSON.stringify(entity));
	else if (req.url === "/api/services")
		res.end(
			JSON.stringify([
				{
					domain: "light",
					services: { toggle: { name: "Toggle", fields: {} } },
				},
			]),
		);
	else if (req.url === "/api/services/light/toggle") {
		services++;
		state = state === "on" ? "off" : "on";
		req.resume();
		res.end("[]");
	} else {
		res.statusCode = 404;
		res.end("{}");
	}
});
async function smoke() {
	await app.whenReady();
	await mkdir(artifacts, { recursive: true });
	await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
	const address = server.address();
	assert(address && typeof address !== "string");
	const origin = `http://127.0.0.1:${address.port}`;
	const options = {
		show: false,
		useContentSize: true,
		width: 1320,
		height: 960,
		titleBarStyle: "hiddenInset",
		webPreferences: {
			preload: resolve("out/preload/index.mjs"),
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
		},
	} as const;
	const win = new BrowserWindow(options),
		panel = new BrowserWindow({ ...options, width: 1920, height: 480 });
	const errors: string[] = [];
	win.webContents.on("console-message", (_event, level, message) => {
		if (level === 3) errors.push(message);
	});
	const knob = registerKnob(
		() => panel,
		() => [win, panel],
	);
	const lifecycleRuntime = ManagedRuntime.make(
		DeviceLifecycle.Default({
			mock: true,
			development: true,
			displays: () => [],
			watch: () => () => {},
			panel: () => {},
			bus: () => ({
				on: () => () => {},
				currentStatus: () => undefined,
				recover: () => Effect.void,
			}),
			notify: (status) => win.webContents.send("quake:diagnostic", status),
			prompts: {
				platform: process.platform,
				mock: true,
				displays: () => [],
				primaryId: () => 1,
				prompt: () => Effect.die("Smoke must not prompt"),
				native: () => Effect.die("Smoke must not call native display APIs"),
				openSettings: () => Effect.void,
			},
		}),
	);
	const lifecycle = registerLifecycle(lifecycleRuntime, () => win, renderer);
	const appearance = registerManagementAppearance(
		() => win,
		directory,
		renderer,
	);
	const profiles = registerProfiles(() => win, renderer);
	const agents = registerAgents({
		management: () => win,
		renderer,
		profiles: profiles.runtime,
		selectProfile: profiles.select,
		credentials: managementAgentCredentials(
			join(directory, "agent-credentials"),
		),
	});
	const integrations = registerIntegrations({
		management: () => win,
		rendererURL: renderer,
		profileRuntime: profiles.runtime,
	});
	const emoji = registerEmoji({
		management: () => win,
		panel: () => panel,
		profiles,
		bus: () => undefined,
		renderer,
		mock: true,
	});
	const media = registerMedia(
		ManagedRuntime.make(MediaLive(join(directory, "media"))),
		() => win,
		renderer,
	);
	const clock = registerClock(
		ManagedRuntime.make(ClockLive(directory)),
		() => win,
		renderer,
	);
	const monitor = registerMonitor(
		directory,
		() => win,
		() => panel,
	);
	const hardware = registerHardware(
		() => undefined,
		() => win,
		true,
	);
	const js = (code: string) => win.webContents.executeJavaScript(code);
	const request = async (bridge: string, input: unknown) =>
		js(`window.${bridge}.request(${JSON.stringify(input)})`);
	const agent = async (input: unknown) => {
		const value: unknown = await request("quakeAgents", input);
		assert(Schema.is(AgentReply)(value));
		assert.equal(value._tag, "success", JSON.stringify(value));
		if (value._tag !== "success") throw Error("Agent request failed");
		return value.view;
	};
	const emot = async (input: unknown) => {
		const value: unknown = await request("quakeEmoji", input);
		assert(Schema.is(EmojiReply)(value));
		assert.equal(value._tag, "ready", JSON.stringify(value));
		if (value._tag !== "ready") throw Error("Emoji request failed");
		return value;
	};
	const integration = async (input: unknown) => {
		const value: unknown = await request("quakeIntegrations", input);
		assert(Schema.is(IntegrationReply)(value));
		assert.notEqual(value.type, "error", JSON.stringify(value));
		return value;
	};
	const activate = async (name: string) => {
		win.webContents.send(MANAGEMENT_ACTIVATE, name);
		await settle();
	};
	const capture = async (name: string) => {
		await js("document.fonts.ready");
		await settle();
		await writeFile(
			join(artifacts, `${name}.png`),
			(await win.webContents.capturePage()).toPNG(),
		);
	};
	try {
		await Promise.all([
			win.loadURL(renderer),
			panel.loadURL(`${renderer}?surface=panel`),
		]);
		await settle(500);
		assert.equal(
			await js(
				"document.querySelector('.mc-runtime-dot')?.getAttribute('aria-label')",
			),
			"No agent runtime is installed",
		);
		let view = await agent({
			type: "create",
			id: "writer",
			name: "Writer",
			emoji: "🦉",
		});
		view = await agent({
			type: "create",
			id: "coder",
			name: "Coder",
			emoji: "⚡",
		});
		view = await agent({
			type: "save-skill",
			create: true,
			folder: "daily-brief",
			owner: "",
			name: "daily-brief",
			content:
				"---\nname: daily-brief\ndescription: Prepare a concise daily briefing\n---\nSummarize the day's tasks and blockers.",
			revision: view.revision,
		});
		view = await agent({
			type: "save-model",
			scope: "default",
			row: {
				id: "primary",
				role: "default",
				provider: "openai",
				model: "gpt-4.1",
				baseUrl: "https://api.openai.com/v1",
				maxTokens: 8192,
			},
			secret: "",
			revision: view.revision,
		});
		// Sync exercises production profile saving, including the composed function validators.
		await agent({
			type: "sync-panel",
			slots: { "1,5": "main", "1,6": "writer", "2,5": "coder", "2,6": "main" },
			revision: view.revision,
		});
		const protectedMain: unknown = await request("quakeAgents", {
			type: "delete",
			id: "main",
			confirmed: true,
		});
		assert(
			Schema.is(AgentReply)(protectedMain) && protectedMain._tag === "rejected",
		);
		const rgba = new Uint8ClampedArray(96 * 96 * 4);
		for (let y = 0; y < 96; y++)
			for (let x = 0; x < 96; x++) {
				const i = (y * 96 + x) * 4;
				const eye =
					(x - 31) ** 2 + (y - 36) ** 2 < 30 ||
					(x - 65) ** 2 + (y - 36) ** 2 < 30;
				const smile = y > 57 && y < 63 && x > 30 && x < 67;
				rgba.set(eye || smile ? [38, 37, 48, 255] : [246, 192, 67, 255], i);
			}
		const bytes = encodeGif({
			width: 96,
			height: 96,
			loopCount: 0,
			frames: [
				{ rgba, delayMs: 120 },
				{ rgba, delayMs: 180 },
			],
		});
		selectedFile = join(directory, "hello.png");
		await writeFile(
			selectedFile,
			nativeImage
				.createFromBitmap(Buffer.from(rgba), { width: 96, height: 96 })
				.toPNG(),
		);
		await emot({ type: "import-static" });
		selectedFile = undefined;
		let em = await emot({
			type: "create-result",
			name: "Hello",
			base64: Buffer.from(bytes).toString("base64"),
		});
		const item = em.store.items[0];
		assert(item);
		await emot({
			type: "command",
			command: { type: "create-package", id: "daily", name: "Daily" },
		});
		await emot({
			type: "command",
			command: { type: "add-drafts", packageId: "daily", ids: [item.id] },
		});
		em = await emot({ type: "place", id: "daily" });
		const profileId = em.store.packages[0]?.profileId;
		assert(profileId);
		await panel.loadURL(`${renderer}?surface=panel`);
		await settle(800);
		assert.equal(
			await panel.webContents.executeJavaScript(
				"document.querySelectorAll('[data-type=emoji] img').length > 0",
			),
			true,
		);
		// Caption runs in Chromium canvas from the original GIF through the production editor.
		await activate("emoji");
		await js(
			"document.querySelector('button[title=\"Edit Hello\"]').click();null;",
		);
		await settle();
		await capture("grey-emoji-caption");
		await js(
			"document.querySelector('.mc-dialog input:not([type])').focus();null;",
		);
		win.webContents.insertText("Hi!");
		await js(
			"Array.from(document.querySelectorAll('.mc-dialog button')).find(b=>b.textContent.trim()==='Save').click();null;",
		);
		await settle(500);
		em = await emot({ type: "read" });
		assert.equal(em.store.items[0]?.caption.text, "Hi!");
		assert.notEqual(em.store.items[0]?.rendered, item.original);
		await emot({ type: "place", id: "daily" });
		await emot({
			type: "command",
			command: { type: "settings", appMatch: false, apps: [], globalMode: 0 },
		});
		const press: unknown = await panel.webContents.executeJavaScript(
			`window.quakeEmoji.press(${JSON.stringify({ profileId, pageId: `${profileId}-page`, keyCode: "1,1", keyAction: 1 })})`,
		);
		assert.deepEqual(press, { _tag: "handled" });
		// Real mounted touch dispatch must reach the emoji sink and show failures.
		await emot({
			type: "command",
			command: { type: "settings", appMatch: false, apps: [], globalMode: 1 },
		});
		await panel.webContents.executeJavaScript(
			"window.__emojiInvalidSeen=false;(()=>{const observer=new MutationObserver(records=>{if(records.some(r=>r.target.dataset.invalid==='true')){window.__emojiInvalidSeen=true;observer.disconnect();}});observer.observe(document.getElementById('root'),{subtree:true,attributes:true,attributeFilter:['data-invalid']});})();",
		);
		const touch = (action: number): void =>
			panel.webContents.send(QUAKE_EVENT_CHANNEL, {
				source: "mock",
				kind: "touch",
				points: [{ action, x: 120, y: 360 }],
			} satisfies QuakeEvent);
		touch(1);
		await settle(30);
		assert.equal(
			await panel.webContents.executeJavaScript(
				"document.querySelector('[data-key-code=\"1,1\"]').dataset.pressed",
			),
			"true",
		);
		touch(0);
		await settle(400);
		assert.equal(
			await panel.webContents.executeJavaScript("window.__emojiInvalidSeen"),
			true,
			"Unavailable device keyboard must flash the touched emoji key",
		);
		assert.equal(
			await panel.webContents.executeJavaScript(
				"document.querySelector('[data-key-code=\"1,1\"]').dataset.invalid",
			),
			undefined,
			"Invalid feedback must clear after 160 ms",
		);
		await emot({
			type: "command",
			command: { type: "settings", appMatch: false, apps: [], globalMode: 0 },
		});
		const libraries = await integration({
			type: "shortcuts.save",
			library: {
				id: "creative",
				name: "Creative",
				app: "Figma",
				createdAt: "2026-10-24T12:00:00Z",
				rows: [
					{ id: "1", name: "Quick actions", app: "Figma", chord: "command+k" },
					{ id: "2", name: "Frame selection", app: "Figma", chord: "shift+2" },
				],
			},
		});
		assert(libraries.type === "libraries" && libraries.libraries[0]);
		await integration({
			type: "shortcuts.sync",
			id: libraries.libraries[0].id,
		});
		await integration({
			type: "ha.connect",
			origin,
			token: "smoke-local-fixture",
		});
		const ha = await integration({ type: "ha.read" });
		assert(ha.type === "ha");
		assert.equal(ha.snapshot.state, "Connected");
		assert(!JSON.stringify(ha).includes("smoke-local-fixture"));
		const key = {
			entity_id: "light.studio",
			service: "toggle",
			service_data: {},
			custom_display_type: "custom",
			custom_display_settings: { fontSize: 28 },
			custom_display_detail: [
				{ displayItemKey: "state", displayAlias: "Studio" },
				{ displayItemKey: "brightness", displayAlias: "Brightness" },
			],
		} as const;
		await integration({
			type: "ha.key",
			target: { profileId, pageId: `${profileId}-page`, keyCode: "1,2" },
			key,
		});
		await integration({ type: "ha.allowlist", ids: ["light.studio"] });
		assert.equal((await integrations.aiEntities()).length, 1);
		await integrations.executeHa(key);
		assert.equal(services, 1);
		await panel.reload();
		await settle(2400);
		assert(
			(
				await panel.webContents.executeJavaScript("document.body.innerText")
			).includes("off"),
		);
		await writeFile(
			join(artifacts, "panel-emoji-home-assistant.png"),
			(await panel.webContents.capturePage()).toPNG(),
		);
		// Every main page and all workbench tabs, using the actual persisted domain state.
		const pages = [
			"overview",
			"profiles",
			"screen",
			"controls",
			"connection",
			"openclaw",
			"agents",
			"openclaw-ai",
			"emoji",
			"shortcuts",
			"home-assistant",
			"appearance",
		];
		for (const theme of ["dark", "grey", "light"]) {
			await js(
				"document.querySelector('button[title=\"UI Settings\"]').click();null;",
			);
			await settle();
			await js(
				`document.querySelector('input[name=mc-theme][value=${theme}]').click();null;`,
			);
			await settle();
			assert.equal(
				nativeTheme.themeSource,
				theme === "light" ? "light" : "dark",
			);
			await capture(`${theme}-ui-settings`);
			await js(
				"document.querySelector('button[title=\"UI Settings\"]').click();null;",
			);
			for (const page of pages) {
				await activate(page);
				await capture(`${theme}-${page}`);
				if (page === "shortcuts") {
					await js(
						"Array.from(document.querySelectorAll('button[aria-pressed]')).find(b=>b.textContent.includes('Creative')).click();null;",
					);
					await settle();
					assert(
						(await js("document.querySelectorAll('table tbody tr').length")) >=
							2,
					);
					await js(
						"document.querySelector('table').scrollIntoView({block:'center'});null;",
					);
					await capture(`${theme}-shortcuts-table`);
				}
				if (page === "home-assistant") {
					await js(
						`(()=>{const select=Array.from(document.querySelectorAll('select')).find(s=>Array.from(s.options).some(o=>o.value===${JSON.stringify(`${profileId}/${profileId}-page/1,2`)}));select.value=${JSON.stringify(`${profileId}/${profileId}-page/1,2`)};select.dispatchEvent(new Event('change',{bubbles:true}));})();`,
					);
					await settle();
					await capture(`${theme}-ha-key`);
				}
				if (page === "screen") {
					await js(
						"document.querySelector('.monitor-settings').scrollIntoView({block:'start'});null;",
					);
					await capture(`${theme}-screen-monitor`);
					await js("document.querySelector('.content').scrollTo(0,0);null;");
				}
				assert.equal(
					await js("document.documentElement.scrollWidth > innerWidth"),
					false,
					`${theme}/${page} overflows window`,
				);
			}
			await activate("openclaw");
			await js("document.getElementById('agents-tab-settings').click();null;");
			await capture(`${theme}-dkclaw`);
			await js(
				"document.querySelector('.mc-channel-grid').scrollIntoView({block:'start'});null;",
			);
			await capture(`${theme}-channels`);
			await activate("agents");
			await js(
				"document.querySelector('button[aria-controls=agents-agents]').click();null;",
			);
			const skillTab = await js(
				"Array.from(document.querySelectorAll('button[role=tab]')).find(b=>b.textContent.includes('Skill Management'))?.id",
			);
			void skillTab;
			await js(
				"Array.from(document.querySelectorAll('#agents-agents button[role=tab]')).find(b=>b.textContent.includes('Skill'))?.click();null;",
			);
			assert.equal(
				await js(
					"getComputedStyle(document.querySelector('#agents-agents .mc-split')).display",
				),
				"none",
			);
			await capture(`${theme}-skills`);
		}
		await js(
			"document.querySelector('button[title=\"UI Settings\"]').click();null;",
		);
		await js(
			"document.querySelector('input[name=mc-theme][value=grey]').click();null;",
		);
		for (const scale of ["small", "medium", "large"]) {
			await js(
				`document.querySelector('input[name=mc-font][value=${scale}]').click();null;`,
			);
			assert.equal(
				await js("document.documentElement.dataset.fontScale"),
				scale,
			);
		}
		await js(
			"document.querySelector('input[name=mc-font][value=small]').click();document.querySelector('button[title=\"UI Settings\"]').click();null;",
		);
		await activate("emoji");
		win.setContentSize(820, 960);
		await settle();
		assert(
			(await js(
				"document.querySelector('.content').getBoundingClientRect().width",
			)) > 600,
			"Narrow rail must retain visible page content",
		);
		await capture("grey-narrow-rail");
		assert.equal(
			await js("getComputedStyle(document.querySelector('.sidebar')).width"),
			"82px",
		);
		win.setContentSize(1320, 960);
		await settle();
		const widthBefore = await js(
			"document.querySelector('.sidebar').getBoundingClientRect().width",
		);
		await js(
			"document.querySelector('.mc-resizer').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));null;",
		);
		await settle();
		assert.equal(
			await js(
				"document.querySelector('.sidebar').getBoundingClientRect().width",
			),
			widthBefore + 8,
		);
		await js(
			"document.querySelector('.mc-resizer').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));null;",
		);
		const rejected: unknown = await panel.webContents.executeJavaScript(
			"window.quakeAgents.request({type:'create',id:'spoof',name:'Spoof',emoji:''})",
		);
		assert(Schema.is(AgentReply)(rejected) && rejected._tag === "rejected");
		const denied: unknown = await panel.webContents.executeJavaScript(
			"window.quakeIntegrations.request({type:'ha.allowlist',ids:[]})",
		);
		assert(Schema.is(IntegrationReply)(denied) && denied.type === "error");
		assert.equal(
			await panel.webContents.executeJavaScript(
				"window.quakeManagement.setTheme({base:'light',background:'#ffffff',titlebar:'#ffffff',symbol:'#000000'})",
			),
			false,
		);
		assert.deepEqual(errors, []);
		process.stdout.write(
			`Management native smoke PASS: ${(await readdir(artifacts)).filter((name) => name.endsWith(".png")).length} screenshots; real IPC, caption, placement, protected main, HA REST/live/AI allowlist, permissions, nativeTheme.\n`,
		);
	} finally {
		hardware();
		await monitor.dispose();
		lifecycle();
		await lifecycleRuntime.dispose();
		await knob.dispose();
		appearance();
		await emoji.dispose();
		await integrations.dispose();
		await agents.dispose();
		await profiles.dispose();
		await clock.dispose();
		await media.dispose();
		win.destroy();
		panel.destroy();
	}
}
void smoke()
	.catch((error: unknown) => {
		process.stderr.write(
			`${String(error)}\n${error instanceof Error ? error.stack : ""}\n`,
		);
		process.exitCode = 1;
	})
	.finally(async () => {
		if (server.listening)
			await new Promise<void>((done) => server.close(() => done()));
		await rm(directory, { recursive: true, force: true });
		app.quit();
	});
