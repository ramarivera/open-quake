import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import { app, BrowserWindow } from "electron";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts";
import { installProfileCatalog } from "../../../../../packages/device/src/profiles/profile-manager-invariants";
import { ProfileManager } from "../../../../../packages/device/src/profiles/profile-manager-service";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service";
import {
	ProfileSwitching,
	ProfileSwitchingPort,
} from "../../../../../packages/device/src/profiles/profile-switching-service";
import { HaKey } from "../../../../../packages/edge/src/home-assistant/ha-contracts";
import { AgentReply } from "../../shared/agents";
import {
	IntegrationReply,
	type IntegrationRequest,
} from "../../shared/integrations";
import { registerAgents } from "../agents";
import { ManagementProfileContractsLive } from "../management/profile-contracts";
import { decodeHaServices } from "./ha-rest";
import { registerIntegrations } from "./index";
import { keyHaConfig } from "./profiles";
import { groupedServices } from "./review-grouped-services";
import { entity, fakeChannels, fakeVault } from "./test-fixtures";

async function main() {
	const smokeDirectory = fileURLToPath(new URL(".", import.meta.url));
	const scratch = process.env.OPEN_QUAKE_SMOKE_SCRATCH;
	assert(scratch);
	assert(
		process.env.OPEN_QUAKE_MOCK_DEVICE === "1" &&
			!process.env.ELECTRON_RUN_AS_NODE,
	);
	assert(
		scratch?.startsWith("/Volumes/ExtSSD/") &&
			scratch.includes("management-center/review-round-1/"),
	);
	await mkdir(scratch, { recursive: true });
	await mkdir(join(scratch, "synthetic-user-data"), { recursive: true });
	await mkdir(join(scratch, "synthetic-session-data/Shared Dictionary/cache"), {
		recursive: true,
	});
	app.setPath("userData", join(scratch, "synthetic-user-data"));
	app.setPath("sessionData", join(scratch, "synthetic-session-data"));
	await app.whenReady();
	const deliveries: { serial: string; profileId: string }[] = [];
	let saved = encodeProfileEnvelope(
		installProfileCatalog(createInitialProfileEnvelope(), "darwin"),
	);
	const profiles = ManagedRuntime.make(
		Layer.mergeAll(
			ProfileService.DefaultWithoutDependencies,
			ProfileManager.DefaultWithoutDependencies,
			ProfileSwitching.DefaultWithoutDependencies,
		).pipe(
			Layer.provideMerge(
				ProfileRepository.DefaultWithoutDependencies.pipe(
					Layer.provide(
						Layer.mergeAll(
							ManagementProfileContractsLive,
							profileStorageLayer({
								read: async () => saved,
								write: async (next) => {
									saved = next;
								},
							}),
						),
					),
				),
			),
			Layer.provide(
				Layer.succeed(ProfileSwitchingPort, {
					platform: "darwin",
					foreground: () => Effect.succeed(Option.none()),
					push: (serial, profile) =>
						Effect.sync(() => {
							deliveries.push({ serial, profileId: profile.id });
						}),
				}),
			),
		),
	);
	const renderer = pathToFileURL(
		join(smokeDirectory, "../management-review-renderer/index.html"),
	).href;
	const makeWindow = () =>
		new BrowserWindow({
			width: 1180,
			height: 850,
			show: false,
			webPreferences: {
				backgroundThrottling: false,
				preload: join(smokeDirectory, "../management-review-preload/index.mjs"),
				sandbox: false,
				contextIsolation: true,
				nodeIntegration: false,
			},
		});
	const management = makeWindow();
	const panel = makeWindow();
	const stranger = makeWindow();
	for (const win of [management, panel, stranger]) {
		win.webContents.on("preload-error", (_event, _path, error) =>
			process.stderr.write(`Synthetic preload error: ${String(error)}\n`),
		);
	}
	const vault = fakeVault();
	const channelRuntime = fakeChannels();
	let executions = 0;
	const outbound: unknown[] = [];
	let droppedDisplayAttributes = false;
	let closes = 0;
	let release: (() => void) | undefined;
	let started: (() => void) | undefined;
	let block = false;
	const entered = new Promise<void>((resolve) => {
		started = resolve;
	});
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	const integrations = registerIntegrations({
		management: () => management,
		panel: () => panel,
		rendererURL: renderer,
		profileRuntime: profiles,
		vault: vault.port,
		channelRuntime: channelRuntime.port,
		openHa: async () => ({
			entities: async () => [entity, { ...entity, entity_id: "light.private" }],
			services: async () => decodeHaServices(groupedServices),
			states: async (ids) =>
				ids.map((id) => ({
					...entity,
					entity_id: id,
					attributes: droppedDisplayAttributes ? {} : entity.attributes,
				})),
			execute: async (domain, service, data) => {
				outbound.push({ domain, service, data });
				executions++;
				if (block) {
					started?.();
					await blocked;
				}
			},
			close: () => {
				closes++;
			},
		}),
	});

	const agents = registerAgents({
		management: () => management,
		renderer,
		profiles,
	});
	const request = async (win: BrowserWindow, input: IntegrationRequest) =>
		Schema.decodeUnknownSync(IntegrationReply)(
			await win.webContents.executeJavaScript(
				`window.quakeIntegrations.request(${JSON.stringify(input)})`,
			),
		);
	const captures: {
		file: string;
		sha256: string;
		width: number;
		height: number;
	}[] = [];
	const capture = async (name: string) => {
		await management.webContents.executeJavaScript(
			"document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))",
		);
		await new Promise((resolve) => setTimeout(resolve, 80));
		const captured = await management.webContents.capturePage();
		const { width, height } = captured.getSize();
		const bytes = captured.toPNG();
		const file = join(scratch, `${name}.png`);
		await writeFile(file, bytes);
		captures.push({
			file,
			width,
			height,
			sha256: createHash("sha256").update(bytes).digest("hex"),
		});
	};
	const wait = async (script: string) => {
		const end = Date.now() + 8000;
		while (!(await management.webContents.executeJavaScript(script))) {
			assert(Date.now() < end, `UI wait expired: ${script}`);
			await new Promise((resolve) => setTimeout(resolve, 40));
		}
	};

	const uiRound2 = (code: string) =>
		management.webContents.executeJavaScript(code);
	const agentRound2 = async (input: unknown) => {
		const reply = Schema.decodeUnknownSync(AgentReply)(
			await uiRound2(`window.quakeAgents.request(${JSON.stringify(input)})`),
		);
		assert(reply._tag === "success");
		return reply.view;
	};
	const workspaceRound2 = async () => {
		await agentRound2({
			type: "create",
			id: "workspace-proof",
			name: "Workspace proof",
			emoji: "🦉",
		});
		await uiRound2(`document.querySelector('[data-page="agents"]').click()`);
		await wait(`document.body.innerText.includes('Workspace proof')`);
		await uiRound2(
			`[...document.querySelectorAll('.mc-card')].find(c=>c.textContent.includes('Workspace proof')).querySelector('button[aria-label^="Edit"]').click()`,
		);
		await wait(
			`document.querySelector('dialog[open] textarea[spellcheck="false"]')`,
		);
		for (const file of ["IDENTITY.md", "SOUL.md", "AGENTS.md"]) {
			await uiRound2(
				`[...document.querySelectorAll('dialog[open] nav button')].find(b=>b.textContent===${JSON.stringify(file)}).click()`,
			);
			await wait(
				`document.querySelector('dialog[open] nav button[data-active="true"]').textContent===${JSON.stringify(file)}`,
			);
			await uiRound2(
				`(()=>{const el=document.querySelector('dialog[open] textarea[spellcheck="false"]');el.focus();el.select()})()`,
			);
			await management.webContents.insertText(`round-two saved ${file}`);
		}
		await capture("round-two-workspace-dirty-tabs");
		await uiRound2(
			`document.querySelector('dialog[open] button[type="submit"]').click()`,
		);
		await wait(`!document.querySelector('dialog[open]')`);
		const view = await agentRound2({ type: "read" });
		const files = view.agents.find((a) => a.id === "workspace-proof")?.files;
		for (const file of ["IDENTITY.md", "SOUL.md", "AGENTS.md"])
			assert.equal(files?.[file], `round-two saved ${file}`);
		await management.reload();
		await wait(`document.querySelector('[data-page="agents"]')`);
		await uiRound2(`document.querySelector('[data-page="agents"]').click()`);
		await wait(`document.body.innerText.includes('Workspace proof')`);
		await uiRound2(
			`[...document.querySelectorAll('.mc-card')].find(c=>c.textContent.includes('Workspace proof')).querySelector('button[aria-label^="Edit"]').click()`,
		);
		await wait(
			`document.querySelector('dialog[open] textarea[spellcheck="false"]')`,
		);
		for (const file of ["IDENTITY.md", "SOUL.md", "AGENTS.md"]) {
			await uiRound2(
				`[...document.querySelectorAll('dialog[open] nav button')].find(b=>b.textContent===${JSON.stringify(file)}).click()`,
			);
			await wait(
				`document.querySelector('dialog[open] textarea[spellcheck="false"]').value===${JSON.stringify(`round-two saved ${file}`)}`,
			);
			await wait(
				`(()=>{const r=document.querySelector('dialog[open]').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight})()`,
			);
			await capture(
				`round-two-workspace-reloaded-${file.replace(".md", "").toLowerCase()}`,
			);
		}
		await capture("round-two-workspace-reloaded");
		await uiRound2(
			`document.querySelector('dialog[open] button[type="submit"]').click()`,
		);
		await wait(`!document.querySelector('dialog[open]')`);
		await uiRound2(
			`[...document.querySelectorAll('#agents-agents [role="tab"]')].find(b=>b.textContent==='Skill management').click()`,
		);
		for (const name of ["3D tools", "网页搜索", "网页搜索"]) {
			await uiRound2(
				`[...document.querySelectorAll('#agents-agents button')].find(b=>b.textContent==='Create Skill').click()`,
			);
			await wait(`document.querySelector('dialog[open] input')`);
			await uiRound2(`document.querySelector('dialog[open] input').focus()`);
			await management.webContents.insertText(name);
			await uiRound2(
				`document.querySelector('dialog[open] button[type="submit"]').click()`,
			);
			await wait(`!document.querySelector('dialog[open]')`);
		}
		const skillView = await agentRound2({ type: "read" });
		const skills = skillView.skills;
		assert.deepEqual(
			skills.map((skill) => skill.name),
			["3D tools", "网页搜索", "网页搜索"],
		);
		assert.equal(new Set(skills.map((skill) => skill.folder)).size, 3);
		assert(skills.every((skill) => /^[a-z][a-z0-9-]*$/.test(skill.folder)));
		management.setContentSize(1180, 1100);
		await wait(`innerHeight>=1100`);
		await uiRound2(
			`document.querySelector('[aria-label="Skill management"]').scrollIntoView({block:'start'})`,
		);
		await wait(
			`(()=>{const r=document.querySelector('[aria-label="Skill management"]').getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight})()`,
		);
		await capture("round-two-skill-folders");
		management.setContentSize(1180, 850);
		await wait(`innerHeight===850`);
		await uiRound2(`document.querySelector('[data-page="channels"]').click()`);
	};
	try {
		await Promise.all([
			management.loadURL(renderer),
			panel.loadURL(renderer),
			stranger.loadURL(renderer),
		]);
		await workspaceRound2();
		assert.equal((await request(stranger, { type: "ha.live" })).type, "error");
		assert.equal(
			(await request(panel, { type: "channels.list" })).type,
			"error",
		);
		assert.equal((await request(panel, { type: "ha.live" })).type, "live");
		assert.equal(
			(
				await request(management, {
					type: "channels.save",
					id: "feishu",
					fields: {
						appId: "synthetic-app",
						appSecret: "synthetic-only",
						domain: "feishu",
					},
					session: "",
				})
			).type,
			"channels",
		);
		assert.equal(
			(
				await request(management, {
					type: "channels.save",
					id: "feishu",
					fields: { appId: "updated-app", domain: "lark" },
					session: "",
				})
			).type,
			"channels",
		);
		assert.equal(vault.values.size, 1);
		await management.webContents.executeJavaScript(
			`document.querySelector('[data-page="channels"]').click()`,
		);
		await wait(`document.body.innerText.includes('Feishu')`);
		await management.webContents.executeJavaScript(
			`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Refresh').click()`,
		);
		await wait(`document.body.innerText.includes('Configured')`);
		await capture("base-channels");
		assert.equal(
			(
				await request(management, {
					type: "ha.connect",
					allowInsecureHttp: false,
					origin: "https://synthetic-ha.test",
					token: "synthetic-only",
				})
			).type,
			"ha",
		);
		await request(management, { type: "ha.allowlist", ids: ["light.desk"] });
		const key = Schema.decodeUnknownSync(HaKey)({
			entity_id: "light.private",
			service: "turn_on",
			service_data: { brightness: 12, transition: 3 },
			custom_display_type: "default",
			custom_display_settings: { fontSize: 40 },
			custom_display_detail: [],
		});
		await assert.rejects(integrations.executeHa(key));
		assert.equal(executions, 0);
		await integrations.executeHa({ ...key, entity_id: "light.desk" });
		assert.equal(executions, 1);
		await integrations.executeHaFromKey(key, new AbortController().signal);
		assert.equal(executions, 2);
		await assert.rejects(integrations.executeHa(key));
		assert.equal(executions, 2);
		await profiles.runPromise(
			Effect.flatMap(ProfileManager, (manager) =>
				manager.command({ type: "create" }),
			),
		);
		const haTargets = await request(management, { type: "ha.targets" });
		assert(haTargets.type === "targets" && haTargets.targets[0]);
		const haTarget = haTargets.targets[0];
		await management.webContents.executeJavaScript(
			`document.querySelector('[data-page="ha"]').click()`,
		);
		await wait(
			`document.querySelector('[aria-label="Key configuration"] select')?.options.length > 1`,
		);
		const choose = async (selector: string, value: string) => {
			await management.webContents.executeJavaScript(
				`(()=>{const select=document.querySelector(${JSON.stringify(selector)});select.value=${JSON.stringify(value)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`,
			);
		};
		await choose(
			'[aria-label="Key configuration"] select',
			`${haTarget.profileId}/${haTarget.pageId}/${haTarget.keyCode}`,
		);
		await choose(
			'[aria-label="Key configuration"] fieldset select',
			"light.desk",
		);
		await wait(
			`document.querySelectorAll('[aria-label="Key configuration"] fieldset select')[1]?.options.length > 1`,
		);
		await choose(
			'[aria-label="Key configuration"] fieldset label:nth-of-type(2) select',
			"turn_on",
		);
		await wait(
			`document.querySelector('#ha-field-effect') !== null && document.querySelector('#ha-field-transition') !== null`,
		);
		assert.equal(
			await uiRound2(`document.querySelector('#ha-field-advanced_fields')`),
			null,
		);
		await uiRound2(
			`(()=>{const el=document.querySelector('#ha-field-transition');el.focus();el.select()})()`,
		);
		await management.webContents.insertText("7");
		await choose("#ha-field-effect", "rainbow");
		await wait(
			`document.querySelector('#ha-field-effect').value === 'rainbow'`,
		);
		await choose("#ha-field-effect", "");
		await management.webContents.executeJavaScript(
			`document.querySelector('[aria-label="Key configuration"] button[data-primary]').click()`,
		);
		await wait(
			`document.querySelector('[aria-label="Home Assistant Settings"]').innerText.includes('Saved')`,
		);
		const optionalProfile = await profiles.runPromise(
			ProfileService.getProfile(haTarget.profileId),
		);
		const optionalKey = optionalProfile.pages
			.find((p) => p.id === haTarget.pageId)
			?.keys.find((k) => k.keyCode === haTarget.keyCode);
		assert(optionalKey);
		assert.deepEqual(keyHaConfig(optionalKey)?.service_data, {
			brightness: 0,
			transition: 7,
		});
		const savedHa = keyHaConfig(optionalKey);
		assert(savedHa);
		await integrations.executeHaFromKey(savedHa, new AbortController().signal);
		assert.deepEqual(outbound.at(-1), {
			domain: "light",
			service: "turn_on",
			data: { entity_id: "light.desk", brightness: 0, transition: 7 },
		});
		const displayKey = {
			...savedHa,
			custom_display_type: "custom",
			custom_display_detail: [
				{ displayItemKey: "brightness", displayAlias: "Level" },
			],
		} as const;
		assert.equal(
			(
				await request(management, {
					type: "ha.key",
					target: {
						profileId: haTarget.profileId,
						pageId: haTarget.pageId,
						keyCode: haTarget.keyCode,
					},
					key: displayKey,
				})
			).type,
			"ok",
		);
		droppedDisplayAttributes = true;
		await wait(
			`window.quakeIntegrations.request({type:"ha.live"}).then(reply=>reply.type === "live" && reply.live.states.some(entity=>entity.entity_id === "light.desk" && !Object.hasOwn(entity.attributes,"brightness")))`,
		);
		await integrations.executeHaFromKey(
			displayKey,
			new AbortController().signal,
		);
		await integrations.executeHa(displayKey);
		assert.equal(
			(
				await request(management, {
					type: "ha.key",
					target: {
						profileId: haTarget.profileId,
						pageId: haTarget.pageId,
						keyCode: haTarget.keyCode,
					},
					key: displayKey,
				})
			).type,
			"error",
		);

		await management.webContents.executeJavaScript(
			`document.querySelector('#ha-field-effect').scrollIntoView({block:'center'})`,
		);
		await wait(
			`(()=>{const rect=document.querySelector('#ha-field-effect').getBoundingClientRect();return rect.top>=0 && rect.bottom<=innerHeight})()`,
		);
		await capture("base-ha-optional-cleared");
		await request(management, {
			type: "ha.revoke",
			origin: "https://synthetic-ha.test",
		});
		await management.webContents.executeJavaScript(
			`document.querySelector('[data-page="ha"]').click()`,
		);
		await wait(
			`document.querySelector('[aria-label="Home Assistant Settings"] h1')?.textContent === 'Home Assistant' && document.body.innerText.includes('Disconnected')`,
		);
		await wait(
			`document.querySelector('input[type="url"]')?.value === 'https://synthetic-ha.test' || [...document.querySelectorAll('input')].some(i=>i.value==='https://synthetic-ha.test')`,
		);
		await management.webContents.executeJavaScript("window.scrollTo(0,0)");
		await capture("base-ha-revoked");
		const raw = await readFile(
			join(app.getPath("userData"), "integrations-v1/channels.json"),
			"utf8",
		);
		assert(!raw.includes("synthetic-only"));
		await management.webContents.executeJavaScript(
			`document.querySelector('[data-page="shortcuts"]').click()`,
		);
		await wait(`document.querySelector('[aria-label="Shortcut Library"]')`);
		await uiRound2(
			`[...document.querySelectorAll('button')].find(b=>b.textContent==='Add shortcut').click()`,
		);
		await wait(`document.querySelector('tbody tr button[aria-label^="Edit"]')`);
		await uiRound2(
			`document.querySelector('tbody tr button[aria-label^="Edit"]').click()`,
		);
		await wait(`document.querySelector('tbody tr input[aria-label^="Edit"]')`);
		await uiRound2(
			`document.querySelector('tbody tr input[aria-label^="Edit"]').focus()`,
		);
		await management.webContents.insertText("control+c");
		await uiRound2(
			`document.querySelector('tbody tr input[aria-label^="Edit"]').dispatchEvent(new FocusEvent("focusout",{bubbles:true}))`,
		);
		await wait(`!document.querySelector('tbody tr input[aria-label^="Edit"]')`);
		await uiRound2(
			`[...document.querySelectorAll('button')].find(b=>b.textContent==='Add to shortcut pack').click()`,
		);
		await wait(
			`document.querySelector('[aria-label="Shortcut Library"]').textContent.includes('Adobe')`,
		);
		const defaults = await request(management, { type: "shortcuts.list" });
		assert(defaults.type === "libraries" && defaults.libraries[0]);
		const defaultLibrary = defaults.libraries[0];
		assert.equal(defaultLibrary.name, "Adobe Phot");
		assert.equal(defaultLibrary.app, "Adobe Photoshop");
		assert.equal(defaultLibrary.rows[0]?.app, "Adobe Photoshop");
		const syncedDefault = await request(management, {
			type: "shortcuts.sync",
			id: defaultLibrary.id,
		});
		assert.equal(syncedDefault.type, "ok");
		const syncedProfile = await profiles.runPromise(
			ProfileService.getProfile(`shortcuts-${defaultLibrary.id}`),
		);
		assert.equal(syncedProfile.name, "Adobe Phot");
		await uiRound2(
			`document.querySelector('[aria-label="Shortcut Library"]').scrollIntoView({block:'start'})`,
		);
		management.setContentSize(1180, 1000);
		await wait(`innerHeight>=1000`);
		await uiRound2(
			`document.querySelector('[aria-label="Shortcut Library"]').scrollIntoView({block:'start'})`,
		);
		await capture("round-two-default-shortcut-synced");
		management.setContentSize(1180, 850);
		await wait(`innerHeight===850`);
		await request(management, {
			type: "shortcuts.remove",
			id: defaultLibrary.id,
		});
		await uiRound2(`document.querySelector('[data-page="channels"]').click()`);
		for (const name of ["First", "Second"])
			await request(management, {
				type: "shortcuts.save",
				library: {
					id: "",
					name,
					app: "Figma",
					createdAt: "",
					rows: [
						{ id: "copy", name: "Copy", app: "Figma", chord: "control+c" },
					],
				},
			});
		await management.webContents.executeJavaScript(
			`document.querySelector('[data-page="shortcuts"]').click()`,
		);
		await wait(`document.body.innerText.includes('First')`);
		await management.webContents.executeJavaScript(
			`[...document.querySelectorAll('button')].find(b=>b.textContent.trim().endsWith('First')).click()`,
		);
		await wait(`document.querySelector('input[type="checkbox"]') !== null`);
		await management.webContents.executeJavaScript(
			`document.querySelector('input[type="checkbox"]').click()`,
		);
		await management.webContents.executeJavaScript(
			`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Add to shortcut pack').click()`,
		);
		await wait(`document.querySelector('input[placeholder]') !== undefined`);
		await wait(`!document.querySelector('[aria-pressed="true"]')?.disabled`);
		const libraries = await request(management, { type: "shortcuts.list" });
		assert(libraries.type === "libraries" && libraries.libraries.length === 2);
		assert.equal(libraries.libraries[0]?.app, "Figma");
		await capture("base-shortcuts-existing");
		const paging = await request(management, {
			type: "shortcuts.save",
			library: {
				id: "",
				name: "Paging",
				app: "Figma",
				createdAt: "",
				rows: Array.from({ length: 17 }, (_, i) => ({
					id: `page-row-${i}`,
					name: `Key ${i}`,
					app: "Figma",
					chord: "control+c",
				})),
			},
		});
		assert(paging.type === "libraries");
		const pagingLibrary = paging.libraries.find(
			(library) => library.name === "Paging",
		);
		assert(pagingLibrary);
		await request(management, { type: "shortcuts.sync", id: pagingLibrary.id });
		const pagingProfile = `shortcuts-${pagingLibrary.id}`;
		await profiles.runPromise(
			ProfileService.selectProfile({
				deviceId: "desktop-preview",
				profileId: pagingProfile,
				pageId: `${pagingProfile}-2`,
			}),
		);
		await request(management, {
			type: "shortcuts.save",
			library: { ...pagingLibrary, rows: pagingLibrary.rows.slice(0, 16) },
		});
		await request(management, { type: "shortcuts.sync", id: pagingLibrary.id });
		assert.equal(
			(await profiles.runPromise(ProfileService.loadProfiles())).envelope
				.activeByDevice["desktop-preview"]?.pageId,
			`${pagingProfile}-1`,
		);
		const constructorAgent = Schema.decodeUnknownSync(AgentReply)(
			await management.webContents.executeJavaScript(
				"window.quakeAgents.request({type:'create',id:'constructor',name:'Prototype ID',emoji:''})",
			),
		);
		assert.equal(constructorAgent._tag, "success");
		await management.webContents.executeJavaScript(
			`document.querySelector('[data-page="agents"]').click()`,
		);
		await wait(
			`document.querySelector('[aria-label="Agents"]') && document.body.innerText.includes('Main') && !document.body.innerText.includes('Loading Agent configuration') && document.body.innerText.includes('Prototype ID')`,
		);
		await capture("base-agents");
		await profiles.runPromise(
			Effect.flatMap(ProfileSwitching, (service) =>
				Effect.gen(function* () {
					yield* service.connect("claw-unit", "1-8");
					yield* service.connect("other-unit", "1-4");
				}),
			),
		);
		const selectedBefore = (await profiles.runPromise(ProfileManager.read()))
			.activeByDevice;
		const deliveryCount = deliveries.length;
		const sync = Schema.decodeUnknownSync(AgentReply)(
			await management.webContents.executeJavaScript(
				`window.quakeAgents.request({type:'sync-panel',slots:{'1,5':'main','1,6':'main','2,5':'main','2,6':'main'},revision:${constructorAgent._tag === "success" ? constructorAgent.view.revision : -1}})`,
			),
		);
		assert.equal(sync._tag, "success");
		assert.deepEqual(
			(await profiles.runPromise(ProfileManager.read())).activeByDevice,
			selectedBefore,
		);
		assert.deepEqual(deliveries.slice(deliveryCount), [
			{ serial: "claw-unit", profileId: "1-8" },
		]);
		await management.webContents.executeJavaScript(
			"document.getElementById('agents-tab-settings').click()",
		);
		await wait(`document.querySelector('[aria-label="Agent 1,5"]') !== null`);
		await choose('[aria-label="Agent 1,5"]', "constructor");
		await management.webContents.executeJavaScript(
			"document.getElementById('agents-tab-ai').click()",
		);
		await wait("document.querySelector('#agents-ai table')");
		const ui = (code: string) => management.webContents.executeJavaScript(code);
		await ui(
			"[...document.querySelectorAll('#agents-ai button')].find(b=>b.textContent==='Add model').click()",
		);
		await ui(
			"[...document.querySelectorAll('#agents-ai button')].find(b=>b.textContent==='Add model').click()",
		);
		await wait(
			"document.querySelectorAll('#agents-ai table')[0].querySelectorAll('tbody tr').length === 3",
		);
		const setField = async (row: number, column: number, value: string) => {
			await ui(
				`document.querySelectorAll('#agents-ai table')[0].querySelectorAll('tbody tr')[${row}].querySelectorAll('input')[${column}].focus()`,
			);
			await management.webContents.insertText(value);
		};
		await setField(1, 0, "openai");
		await setField(1, 1, "synthetic-saved");
		await setField(2, 0, "openai");
		await setField(2, 1, "synthetic-draft");
		await setField(2, 3, "synthetic-draft-only");
		await ui(
			"document.querySelectorAll('#agents-ai table')[0].querySelectorAll('tbody tr')[1].querySelector('button').click()",
		);
		await wait(
			"!document.querySelectorAll('#agents-ai table')[0].querySelectorAll('tbody tr')[1].querySelector('button').disabled",
		);
		assert(
			await ui(
				"(()=>{const rows=document.querySelectorAll('#agents-ai table')[0].querySelectorAll('tbody tr');return rows.length===3 && rows[2].querySelectorAll('input')[1].value==='synthetic-draft' && rows[2].querySelector('input[type=password]').value==='synthetic-draft-only'})()",
			),
		);

		const readAgents = async () => {
			const reply = Schema.decodeUnknownSync(AgentReply)(
				await ui("window.quakeAgents.request({type:'read'})"),
			);
			assert(reply._tag === "success");
			return reply.view;
		};
		let modelView = await readAgents();
		assert(
			modelView.models.default?.some((row) => row.model === "synthetic-saved"),
		);
		await ui(
			"(()=>{const select=document.querySelectorAll('#agents-ai table')[0].querySelectorAll('tbody tr')[1].querySelector('select');select.value='default';select.dispatchEvent(new Event('change',{bubbles:true}))})()",
		);
		for (let attempt = 0; ; attempt++) {
			modelView = await readAgents();
			if (
				modelView.models.default?.find((row) => row.model === "synthetic-saved")
					?.role === "default"
			)
				break;
			assert(attempt < 100);
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		assert(
			await ui(
				"document.querySelectorAll('#agents-ai table')[0].querySelectorAll('tbody tr')[2].querySelector('input[type=password]').value==='synthetic-draft-only'",
			),
		);
		await capture("base-model-drafts-retained");
		const custom = Schema.decodeUnknownSync(AgentReply)(
			await ui(
				`window.quakeAgents.request({type:'inherit',scope:'constructor',enabled:false,revision:${modelView.revision}})`,
			),
		);
		assert(custom._tag === "success");
		await ui(
			"[...document.querySelectorAll('#agents-ai nav button')].find(b=>b.textContent==='Per-agent models').click()",
		);
		await ui(
			"[...document.querySelectorAll('#agents-ai details')].find(d=>d.querySelector('code')?.textContent==='constructor').open=true",
		);
		const agentTable =
			"[...document.querySelectorAll('#agents-ai table')].find(t=>t.querySelector('caption')?.textContent==='constructor')";
		await wait(`${agentTable}?.querySelectorAll('tbody tr').length === 2`);
		await ui(
			`(()=>{const table=${agentTable};const section=table.parentElement.parentElement;[...section.querySelectorAll('button')].find(b=>b.textContent==='Add model').click()})()`,
		);
		await wait(`${agentTable}.querySelectorAll('tbody tr').length === 3`);
		await ui(
			`${agentTable}.querySelectorAll('tbody tr')[2].querySelectorAll('input')[1].focus()`,
		);
		await management.webContents.insertText("agent-pending");
		await ui(
			`${agentTable}.querySelectorAll('tbody tr')[2].querySelector('input[type=password]').focus()`,
		);
		await management.webContents.insertText("synthetic-agent-only");
		await ui(
			`${agentTable}.querySelectorAll('tbody tr')[1].querySelector('button').click()`,
		);
		await wait(
			`!${agentTable}.querySelectorAll('tbody tr')[1].querySelector('button').disabled`,
		);
		assert(
			await ui(
				`${agentTable}.querySelectorAll('tbody tr').length === 3 && ${agentTable}.querySelectorAll('tbody tr')[2].querySelector('input[type=password]').value==='synthetic-agent-only'`,
			),
		);
		await capture("base-agent-model-drafts-retained");
		await ui("document.getElementById('agents-tab-settings').click()");
		await wait(
			`document.querySelector('[aria-label="Agent 1,5"]').value === 'constructor'`,
		);
		await capture("base-slot-drafts-retained");
		await ui(
			"document.querySelector('#agents-settings .mc-panel button').click()",
		);
		for (let attempt = 0; ; attempt++) {
			const latest = await readAgents();
			if (latest.slots["1,5"] === "constructor") break;
			assert(attempt < 100, "Pending slot assignment was not committed");
			await new Promise((resolve) => setTimeout(resolve, 20));
		}

		await request(management, {
			type: "ha.connect",
			allowInsecureHttp: false,
			origin: "https://synthetic-ha.test",
			token: "",
		});
		block = true;
		const inFlight = integrations.executeHa({
			...key,
			entity_id: "light.desk",
		});
		await entered;
		const first = integrations.dispose();
		assert.equal(first, integrations.dispose());
		let finished = false;
		void first.then(() => {
			finished = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 40));
		assert.equal(finished, false);
		release?.();
		await inFlight;
		await first;
		assert.equal(closes, 2);
		await writeFile(
			join(scratch, "proof.json"),
			JSON.stringify(
				{
					passed: true,
					source: process.env.OPEN_QUAKE_SOURCE_HEAD,
					ownership: true,
					allowlist: true,
					awaitableShutdown: true,
					modelScopeAndShortcutRepair: true,
					directKeyAndAiCapabilities: true,
					modelDraftRetention: true,
					serialScopedClawDelivery: true,
					optionalSelectCleared: true,
					unsyncedSlotDraftsRetained: true,
					allWorkspaceTabsPersisted: true,
					nonAsciiAndNumericSkillFolders: true,
					groupedHaFieldsSavedAndExecuted: true,
					ephemeralDisplayDoesNotBlockAction: true,
					defaultShortcutSavedAndSynced: true,
					captures,
				},
				null,
				2,
			),
		);
		process.stdout.write(
			"PR33 native mock production IPC, ownership, allowlist, persisted secrets, UI and disposal passed\n",
		);
	} catch (error) {
		await capture("base-failure");
		throw error;
	} finally {
		release?.();
		await integrations.dispose();
		await agents.dispose();
		await profiles.dispose();
		for (const win of [management, panel, stranger])
			if (!win.isDestroyed()) win.destroy();
		app.quit();
	}
}
void main().catch((error: unknown) => {
	process.stderr.write(`${String(error)}\n`);
	app.exit(1);
});
