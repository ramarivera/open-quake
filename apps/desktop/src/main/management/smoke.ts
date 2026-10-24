/** Production preload/renderer and real main handlers. Electron only, mock hardware required. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import {
	app,
	BrowserWindow,
	dialog,
	nativeImage,
	nativeTheme,
	shell,
} from "electron";
import { Profile } from "../../../../../packages/device/src/profiles/profile-contracts";
import { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service";
import { QUAKE_EVENT_CHANNEL, type QuakeEvent } from "../../preload/quake";
import { managementActivation } from "../../renderer/src/management/navigation";
import {
	APPEARANCE_STORAGE_KEY,
	defaultAppearance,
	LEGACY_APPEARANCE_STORAGE_KEY,
	parseAppearance,
} from "../../renderer/src/theme/appearance";
import { AgentReply } from "../../shared/agents";
import { EmojiReply } from "../../shared/emoji";
import { encodeGif } from "../../shared/gif";
import { IntegrationReply } from "../../shared/integrations";
import { MANAGEMENT_ACTIVATE } from "../../shared/management";
import { registerAgents } from "../agents";
import { ClockLive, registerClock, registerClockScheme } from "../clock";
import { registerEmoji } from "../emoji";
import { proveEmojiRestore } from "../emoji/backup-proof";
import { emojiFiles } from "../emoji/files";
import { registerHardware } from "../hardware";
import { registerIntegrations } from "../integrations";
import { registerKnob } from "../knob";
import { DeviceLifecycle } from "../lifecycle/lifecycle-service";
import { registerLifecycle } from "../lifecycle/registration";
import { registerMaintenance } from "../maintenance";
import { prepareRestore } from "../maintenance/backup-store";
import { MediaLive, registerMedia } from "../media";
import { registerMeetings } from "../meetings";
import { registerMonitor } from "../monitor";
import { registerProfiles } from "../profiles";
import { createToneRecorder, registerVoiceSurface } from "../voice";
import { registerWeatherMedia } from "../weather-media";
import { WeatherMediaController } from "../weather-media/controller";
import { weatherSettingsLive } from "../weather-media/settings-repository";
import { systemMediaStub } from "../weather-media/system-media";
import { WeatherNetwork } from "../weather-media/weather-network";
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
const backupFile = join(directory, "synthetic-native-backup.zip");
dialog.showSaveDialog = async () => ({ canceled: false, filePath: backupFile });
shell.showItemInFolder = () => {};
app.setPath("userData", directory);
let selectedFile: string | undefined;
dialog.showOpenDialog = async () => ({
	canceled: selectedFile === undefined,
	filePaths: selectedFile ? [selectedFile] : [],
});
const artifacts = process.env.OPEN_QUAKE_SMOKE_SCRATCH ?? process.argv[2] ?? "";
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
			backgroundThrottling: false,
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
	let weatherRequests = 0;
	const weatherMedia = registerWeatherMedia(
		ManagedRuntime.make(
			WeatherMediaController.Default.pipe(
				Layer.provide(
					Layer.mergeAll(
						weatherSettingsLive(directory),
						systemMediaStub(process.platform),
						Layer.succeed(WeatherNetwork, {
							json: () =>
								Effect.sync(() => {
									weatherRequests++;
									return {};
								}),
						}),
					),
				),
			),
		),
		() => win,
	);
	const profiles = registerProfiles(() => win, renderer);
	const agents = registerAgents({
		management: () => win,
		renderer,
		profiles: profiles.runtime,
		credentials: managementAgentCredentials(
			join(directory, "agent-credentials"),
		),
	});
	const maintenance = registerMaintenance({
		root: directory,
		mock: true,
		renderer,
		hardware: () => undefined,
		management: () => win,
		stopWriters: async () => {},
	});
	const meetings = registerMeetings({
		userData: directory,
		mock: true,
		hardware: () => undefined,
	});
	const voice = registerVoiceSurface({
		mock: true,
		tones: createToneRecorder(),
		serial: () => "desktop-preview",
		panel: () => panel,
		management: () => win,
		renderer,
	});
	const integrations = registerIntegrations({
		panel: () => panel,
		management: () => win,
		rendererURL: renderer,
		profileRuntime: profiles.runtime,
	});
	const copiedFiles: string[] = [];
	let generatedBytes = new Uint8Array();
	const emoji = registerEmoji({
		generation: { generate: async () => generatedBytes },
		clipboard: async (path) => {
			copiedFiles.push(path);
		},
		selectionSerial: () => media.selectionSerial(),
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
		{
			collect: () =>
				Effect.succeed({ state: "unsupported" as const, values: {} }),
		},
		renderer,
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
	const waitFor = async (condition: string, timeout = 8000): Promise<void> => {
		const until = Date.now() + timeout;
		while (!(await js(`Boolean(${condition})`))) {
			assert(Date.now() < until, `Saved UI state timed out: ${condition}`);
			await settle(30);
		}
	};
	const activate = async (name: string) => {
		const activation = managementActivation(name);
		assert(activation);
		win.webContents.send(MANAGEMENT_ACTIVATE, name);
		await waitFor(
			`document.querySelector('.content-inner')?.dataset.page === ${JSON.stringify(activation.page)}`,
		);
		if (activation.agentTab)
			await waitFor(
				`document.querySelector('#agents-tab-${activation.agentTab}')?.getAttribute('aria-selected') === 'true'`,
			);
		if (activation.page === "agents")
			await waitFor(
				"document.querySelector('#agents-agents .mc-aside') && !document.querySelector('.content-inner')?.textContent.includes('Loading agent workspace')",
			);
		if (activation.page === "shortcuts")
			await waitFor(
				"Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('Creative'))",
			);
		if (activation.page === "home-assistant")
			await waitFor(
				"document.querySelector('[aria-label=\"Home Assistant Settings\"] [role=status]')?.textContent === 'Connected'",
			);
		if (activation.page === "emoji")
			await waitFor("document.querySelector('button[title=\"Edit Hello\"]')");
		await settle();
	};
	const capture = async (name: string) => {
		await js("document.fonts.ready");
		await waitFor(
			"!document.querySelector('.emoji-page') || !document.querySelector('.emoji-notice')?.textContent.includes('Working')",
		);
		await js(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		);
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
		for (const [query, page, agentTab] of [
			["page=meetings", "meetings", undefined],
			["page=meetings&activeTab=emoji", "emoji", undefined],
			["page=meetings&activeTab=openclaw-ai", "agents", "ai"],
			["page=meetings&activeTab=unknown", "overview", undefined],
			["page=unknown", "overview", undefined],
		] as const) {
			await win.loadURL(`${renderer}?${query}`);
			await waitFor(
				`document.querySelector('.content-inner')?.dataset.page === ${JSON.stringify(page)}`,
			);
			if (agentTab)
				await waitFor(
					`document.querySelector('#agents-tab-${agentTab}')?.getAttribute('aria-selected') === 'true'`,
				);
		}
		// Upgrade without editing preferences, then export through the actual maintenance consumer.
		const legacy = {
			version: 1,
			theme: "custom",
			customTheme: {
				version: 1,
				name: "Synthetic palette",
				base: "light",
				colors: { background: "#eae5df", accent: "#335577" },
			},
			motion: "reduce",
		};
		const migrated = parseAppearance(JSON.stringify(legacy));
		assert(migrated);
		await js(
			`localStorage.removeItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)});localStorage.setItem(${JSON.stringify(LEGACY_APPEARANCE_STORAGE_KEY)},${JSON.stringify(JSON.stringify(legacy))});null;`,
		);
		await win.loadURL(renderer);
		await waitFor("document.documentElement.dataset.theme === 'custom'");
		assert.equal((await maintenance.request({ action: "export" })).ok, true);
		const appearanceRoot = join(directory, "oq-fixture-appearance-restored");
		await mkdir(appearanceRoot);
		await writeFile(
			join(appearanceRoot, "profiles-v1.json"),
			await readFile(join(directory, "profiles-v1.json")),
		);
		const appearanceRestore = await prepareRestore(
			await readFile(backupFile),
			"synthetic.zip",
		);
		await appearanceRestore.validate(appearanceRoot);
		await appearanceRestore.commit(appearanceRoot);
		assert.deepEqual(
			JSON.parse(
				await readFile(join(appearanceRoot, "appearance.json"), "utf8"),
			),
			migrated,
		);
		await writeFile(
			join(directory, "appearance.json"),
			await readFile(join(appearanceRoot, "appearance.json")),
		);
		await js("localStorage.clear();null;");
		await win.loadURL(renderer);
		await waitFor(
			`localStorage.getItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)}) === ${JSON.stringify(JSON.stringify(migrated))}`,
		);
		await waitFor(
			"document.documentElement.dataset.theme === 'custom' && document.documentElement.dataset.motion === 'reduce'",
		);
		await capture("legacy-appearance-restored-before-edits");
		await js(
			`localStorage.setItem(${JSON.stringify(APPEARANCE_STORAGE_KEY)},${JSON.stringify(JSON.stringify(defaultAppearance))});localStorage.removeItem(${JSON.stringify(LEGACY_APPEARANCE_STORAGE_KEY)});null;`,
		);
		await win.loadURL(renderer);
		await settle(400);
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
		generatedBytes = Uint8Array.from(bytes);
		selectedFile = join(
			directory,
			"synthetic-static-filename-longer-than-thirty-characters.png",
		);
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
		await win.webContents.insertText("Hi!");
		await js(
			"Array.from(document.querySelectorAll('.mc-dialog button')).find(b=>b.textContent.trim()==='Save').click();null;",
		);
		await waitFor(
			"!document.querySelector('.mc-dialog') && document.querySelector('.emoji-notice')?.textContent === 'Caption saved.'",
		);
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
		assert(copiedFiles[0]?.endsWith(".gif"));
		const copied = await readFile(copiedFiles[0] ?? "");
		assert.equal(
			createHash("sha256").update(copied).digest("hex"),
			em.store.items[0]?.rendered,
		);
		assert.equal((await maintenance.request({ action: "export" })).ok, true);
		const renderedItem = em.store.items[0],
			staticAsset = em.store.staticAssets[0];
		assert(renderedItem && staticAsset);
		const sourceFiles = emojiFiles(join(directory, "emoji-v1"));
		const backupProof = await proveEmojiRestore(
			await readFile(backupFile),
			join(directory, "oq-fixture-emoji-restored"),
			{
				itemId: renderedItem.id,
				original: renderedItem.original,
				rendered: renderedItem.rendered,
				originalBytes: await sourceFiles.get(renderedItem.original),
				renderedBytes: await sourceFiles.get(renderedItem.rendered),
				staticHash: staticAsset.hash,
				staticBytes: await sourceFiles.get(staticAsset.hash),
			},
		);
		await writeFile(
			join(artifacts, "backup-restore-proof.json"),
			JSON.stringify(
				{
					source: process.env.OPEN_QUAKE_SOURCE_HEAD,
					...backupProof,
					legacyAppearanceBeforeEdits: migrated,
				},
				null,
				2,
			),
		);
		// Panel receives only pinned current-page bytes, without private library metadata.
		const publicAsset = await panel.webContents.executeJavaScript(
			`window.quakeEmoji.request({type:"asset",hash:${JSON.stringify(em.store.items[0]?.rendered)}})`,
		);
		assert(Schema.is(EmojiReply)(publicAsset) && publicAsset._tag === "ready");
		assert.equal(publicAsset.store.items.length, 0);
		const privateAsset = await panel.webContents.executeJavaScript(
			`window.quakeEmoji.request({type:"asset",hash:${JSON.stringify(em.store.staticAssets[0]?.hash)}})`,
		);
		assert(
			Schema.is(EmojiReply)(privateAsset) && privateAsset._tag === "failure",
		);
		const libraryDenied = await panel.webContents.executeJavaScript(
			"window.quakeEmoji.request({type:'read'})",
		);
		assert(
			Schema.is(EmojiReply)(libraryDenied) && libraryDenied._tag === "failure",
		);
		selectedFile = artifacts;
		await emot({ type: "export", id: "daily" });
		await emot({ type: "export", id: "daily" });
		selectedFile = undefined;
		assert.equal(
			(await readdir(artifacts)).filter((name) =>
				name.startsWith("Emoji-Daily-"),
			).length,
			2,
		);
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
		const copiedBeforeCancel = copiedFiles.length;
		touch(1);
		await settle(30);
		panel.webContents.send(QUAKE_EVENT_CHANNEL, {
			source: "mock",
			kind: "status",
			state: "disconnected",
			reason: "transport-ended",
		} satisfies QuakeEvent);
		await settle(100);
		assert.equal(
			copiedFiles.length,
			copiedBeforeCancel,
			"Cancelled releases must not copy emoji",
		);
		panel.webContents.send(QUAKE_EVENT_CHANNEL, {
			source: "mock",
			kind: "status",
			state: "connected",
		} satisfies QuakeEvent);
		// A down-time owner must survive neither a page/profile switch nor an away-and-back switch.
		const pageId = `${profileId}-page`,
			otherPageId = `${profileId}-other`;
		await profiles.runtime.runPromise(
			Effect.flatMap(ProfileRepository, (repo) =>
				repo.transact((envelope) => {
					const source = envelope.profiles.find((p) => p.id === profileId);
					assert(source);
					const encoded = Schema.encodeSync(Profile)(source),
						first = encoded.pages[0];
					assert(first);
					const otherPage = {
						...first,
						id: otherPageId,
						keys: first.keys.map((key) => ({
							...key,
							config: {
								...key.config,
								title: { ...key.config.title, text: "Other page" },
							},
						})),
					};
					const updated = Schema.decodeUnknownSync(Profile)({
						...encoded,
						pages: [...encoded.pages, otherPage],
					});
					const alternate = Schema.decodeUnknownSync(Profile)({
						...encoded,
						id: "synthetic-other",
						name: "Other",
						pages: [{ ...otherPage, id: "synthetic-other-page" }],
					});
					return Effect.succeed({
						...envelope,
						profiles: [
							envelope.profiles[0],
							...envelope.profiles
								.slice(1)
								.map((p) => (p.id === profileId ? updated : p)),
							alternate,
						],
					});
				}),
			),
		);
		const panelJs = (code: string) => panel.webContents.executeJavaScript(code);
		const selectPage = async (
			targetProfile: string,
			targetPage: string,
			title: string,
		) => {
			await profiles.runtime.runPromise(
				ProfileService.selectProfile({
					deviceId: "desktop-preview",
					profileId: targetProfile,
					pageId: targetPage,
				}),
			);
			const deadline = Date.now() + 4000;
			while (
				!(await panelJs(
					`document.querySelector('[data-key-code="1,1"]')?.textContent.includes(${JSON.stringify(title)})`,
				))
			) {
				assert(Date.now() < deadline);
				await settle(10);
			}
			await panelJs(
				"new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
			);
		};
		await emot({
			type: "command",
			command: { type: "settings", appMatch: false, apps: [], globalMode: 2 },
		});
		const cancelledCases: string[] = [];
		for (const target of [
			[profileId, otherPageId, "page"],
			["synthetic-other", "synthetic-other-page", "profile"],
		] as const) {
			for (const back of [false, true]) {
				await selectPage(profileId, pageId, "Hello");
				const before = copiedFiles.length;
				touch(1);
				await settle(30);
				await selectPage(target[0], target[1], "Other page");
				if (back) await selectPage(profileId, pageId, "Hello");
				touch(0);
				await settle(250);
				assert.equal(
					copiedFiles.length,
					before,
					`Held touch must cancel after ${target[2]} switch, back=${back}`,
				);
				cancelledCases.push(`${target[2]}-held-back-${back}`);
			}
		}
		await selectPage(profileId, pageId, "Hello");
		const beforeBatched = copiedFiles.length;
		touch(1);
		await settle(30);
		await profiles.runtime.runPromise(
			Effect.gen(function* () {
				yield* ProfileService.selectProfile({
					deviceId: "desktop-preview",
					profileId,
					pageId: otherPageId,
				});
				yield* ProfileService.selectProfile({
					deviceId: "desktop-preview",
					profileId,
					pageId,
				});
			}),
		);
		await settle(60);
		touch(0);
		await settle(250);
		assert.equal(
			copiedFiles.length,
			beforeBatched,
			"Rapid away-and-back snapshots must cancel before React batches them",
		);
		cancelledCases.push("rapid-away-back");
		await panelJs(
			"window.__releaseQueue=[];window.__holdRelease=false;window.__nativeSetTimeout=window.setTimeout.bind(window);window.setTimeout=(callback,delay,...args)=>{if(window.__holdRelease&&delay===10){const id=window.__nativeSetTimeout(()=>{},60000);window.__releaseQueue.push(()=>{clearTimeout(id);callback(...args)});return id}return window.__nativeSetTimeout(callback,delay,...args)};null;",
		);
		for (const back of [false, true]) {
			await selectPage(profileId, pageId, "Hello");
			const before = copiedFiles.length;
			touch(1);
			await settle(30);
			await panelJs("window.__holdRelease=true;null;");
			touch(0);
			await settle(20);
			assert.equal(await panelJs("window.__releaseQueue.length"), 1);
			await panelJs("window.__holdRelease=false;null;");
			await selectPage(profileId, otherPageId, "Other page");
			if (back) await selectPage(profileId, pageId, "Hello");
			await panelJs(
				"window.__releaseQueue.splice(0).forEach(run=>run());null;",
			);
			await settle(250);
			assert.equal(
				copiedFiles.length,
				before,
				`Delayed release must cancel, back=${back}`,
			);
			cancelledCases.push(`delayed-back-${back}`);
		}
		await panelJs("window.setTimeout=window.__nativeSetTimeout;null;");
		await selectPage(profileId, pageId, "Hello");
		await emot({
			type: "command",
			command: { type: "settings", appMatch: false, apps: [], globalMode: 0 },
		});
		const beforeNormal = copiedFiles.length;
		touch(1);
		await settle(30);
		touch(0);
		await settle(250);
		assert.equal(
			copiedFiles.length,
			beforeNormal + 1,
			"Subsequent ordinary touch must still copy",
		);
		await writeFile(
			join(artifacts, "touch-ownership-proof.json"),
			JSON.stringify(
				{
					source: process.env.OPEN_QUAKE_SOURCE_HEAD,
					rawFrames: true,
					mountedPanelAndIpc: true,
					cancelledCases,
					subsequentTouchCopied: true,
					modeDuringCancellation: 2,
					realClipboardOrKeyboard: false,
				},
				null,
				2,
			),
		);
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
		await activate("emoji");
		await waitFor(
			"document.querySelector('.emoji-fields input') && document.querySelector('.emoji-thumb')",
		);
		await js(
			"document.querySelector('.emoji-fields input[placeholder=\"e.g. Wave happily\"]').focus();null;",
		);
		await win.webContents.insertText("Waving Cat");
		await js(
			"document.querySelector('.emoji-fields input[placeholder=\"e.g. Go for it!\"]').focus();null;",
		);
		await win.webContents.insertText("Hi Cat!");
		await js(
			"Array.from(document.querySelectorAll('.emoji-actions button')).find(b=>b.textContent.trim()==='Generate Motion Emoji').click();null;",
		);
		await waitFor(
			"document.querySelector('.emoji-notice')?.textContent === 'Generated. Select to add to the pack.'",
		);
		em = await emot({ type: "read" });
		const motion = em.store.items.find((entry) => entry.name === "Waving Cat");
		assert(
			motion &&
				motion.caption.text === "Hi Cat!" &&
				motion.original !== motion.rendered,
		);
		await capture("grey-emoji-motion-metadata");
		await js(
			"Array.from(document.querySelectorAll('.emoji-actions button')).find(b=>b.textContent.trim()==='Use static image').click();null;",
		);
		await waitFor(
			"document.querySelector('.emoji-notice')?.textContent === 'Generated. Select to add to the pack.'",
		);
		// Wait on persistence as well as the visible notice, which can match the previous result.
		for (let attempts = 0; ; attempts++) {
			em = await emot({ type: "read" });
			if (em.store.items.length >= 3) break;
			assert(attempts < 80, "Still creation did not persist");
			await settle(50);
		}
		const still = em.store.items[2];
		assert(
			still &&
				still.caption.text === "Hi Cat!" &&
				still.original !== still.rendered,
		);
		await capture("grey-emoji-still-metadata");
		const beforeBlank = em.store.items.length;
		await js(
			"(()=>{const input=document.querySelector('.emoji-fields input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));})();null;",
		);
		await js(
			"Array.from(document.querySelectorAll('.emoji-actions button')).find(b=>b.textContent.trim()==='Use static image').click();null;",
		);
		for (let attempts = 0; ; attempts++) {
			em = await emot({ type: "read" });
			if (em.store.items.length > beforeBlank) break;
			assert(attempts < 80, "Blank-name still did not persist");
			await settle(50);
		}
		const derivedName = em.store.staticAssets[0]?.name.slice(0, 30);
		assert.equal(em.store.items.at(-1)?.name, derivedName);
		const motionFallback = await request("quakeEmoji", {
			type: "generate",
			assetId: em.store.staticAssets[0]?.hash,
			prompt: "Wave",
			name: "   ",
		});
		assert(
			Schema.is(EmojiReply)(motionFallback) &&
				motionFallback._tag === "generated",
		);
		assert.equal(motionFallback.name, derivedName);
		const longName = "synthetic-motion-filename-longer-than-thirty-characters";
		selectedFile = join(directory, `${longName}.gif`);
		await writeFile(selectedFile, bytes);
		const gifReply = await emot({ type: "import-gif" });
		selectedFile = undefined;
		assert.equal(gifReply.store.items.at(-1)?.name, longName.slice(0, 30));
		for (const input of [
			{
				type: "generate",
				assetId: em.store.staticAssets[0]?.hash,
				prompt: "Wave",
				name: "x".repeat(31),
			},
			{
				type: "create-result",
				base64: Buffer.from(bytes).toString("base64"),
				name: "x".repeat(31),
			},
		]) {
			const rejected = await request("quakeEmoji", input);
			assert(
				Schema.is(EmojiReply)(rejected) &&
					rejected._tag === "failure" &&
					rejected.code === "QUAKE.EMOJI.INVALID",
			);
		}
		await capture("grey-emoji-derived-names");
		await writeFile(
			join(artifacts, "naming-proof.json"),
			JSON.stringify(
				{
					source: process.env.OPEN_QUAKE_SOURCE_HEAD,
					longGifImport: true,
					mountedBlankStaticName: true,
					blankGeneratedName: true,
					explicitLongNamesRejected: true,
					generationFallbackAlreadyNormalized: true,
				},
				null,
				2,
			),
		);
		await integration({
			type: "shortcuts.sync",
			id: libraries.libraries[0].id,
		});
		await integration({
			type: "ha.connect",
			origin,
			token: "smoke-local-fixture",
			allowInsecureHttp: true,
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
		assert.equal(weatherRequests, 0, "Disabled weather never uses network IO");
		assert.deepEqual(errors, []);
		const captures = await Promise.all(
			(await readdir(artifacts))
				.filter((name) => name.endsWith(".png"))
				.map(async (name) => ({
					name,
					sha256: createHash("sha256")
						.update(await readFile(join(artifacts, name)))
						.digest("hex"),
				})),
		);
		await writeFile(
			join(artifacts, "proof.json"),
			JSON.stringify(
				{
					source: process.env.OPEN_QUAKE_SOURCE_HEAD,
					mock: true,
					nativeAppPasteVerified: false,
					clipboardGifFilenameVerified: true,
					captionOriginalAndMetadataVerified: true,
					panelIsolationVerified: true,
					repeatedExportVerified: true,
					captures,
				},
				null,
				2,
			),
		);
		process.stdout.write(
			`Management native smoke PASS: ${(await readdir(artifacts)).filter((name) => name.endsWith(".png")).length} screenshots; real IPC, caption, placement, protected main, HA REST/live/AI allowlist, permissions, nativeTheme.\n`,
		);
	} finally {
		await weatherMedia.dispose();
		hardware();
		await monitor.dispose();
		lifecycle();
		await lifecycleRuntime.dispose();
		await knob.dispose();
		appearance();
		await emoji.dispose();
		await maintenance.dispose();
		await meetings.dispose();
		await voice.dispose();
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
