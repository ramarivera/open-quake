/** Native renderer/preload/main proof. Run only with OPEN_QUAKE_MOCK_DEVICE=1. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, ManagedRuntime, Schema } from "effect";
import { app, BrowserWindow } from "electron";
import { KnobReply } from "../../shared/knob-contracts";
import {
	PROFILE_FOREGROUND_GUIDANCE,
	ProfileReplySchema,
	type ProfileRequest,
} from "../../shared/profile-manager";
import { ClockLive, registerClock, registerClockScheme } from "../clock";
import { registerKnob } from "../knob";
import { knobProfileBinding } from "../knob/profile-binding";
import { DeviceLifecycle } from "../lifecycle/lifecycle-service";
import { registerLifecycle } from "../lifecycle/registration";
import { MediaLive, registerMedia } from "../media";
import { registerAppLocale } from "../settings/registration";
import { nativeForegroundApp } from "./foreground-app";
import { registerProfiles } from "./index";
import { loadInstalledProfileApps } from "./installed-apps";
import { assertPropertyContrast } from "./smoke-contrast";
import { reportSmokeFailure } from "./smoke-failure";

if (process.platform === "darwin") app.setActivationPolicy("prohibited");
registerClockScheme();

async function smoke(): Promise<void> {
	const scratch = resolve(
		process.argv[2] ?? join(tmpdir(), "open-quake-profiles-smoke"),
	);
	assert.equal(process.env.OPEN_QUAKE_MOCK_DEVICE, "1");
	await mkdir(scratch, { recursive: true });
	const directory = await mkdtemp(join(scratch, "native-smoke-"));
	app.setPath("userData", directory);
	const request = async (win: BrowserWindow, command: ProfileRequest) =>
		Schema.decodeUnknownSync(ProfileReplySchema)(
			await win.webContents.executeJavaScript(
				`window.quakeProfileManager.request(${JSON.stringify(command)})`,
			),
		);
	const ready = async (win: BrowserWindow, selector: string): Promise<void> => {
		await win.webContents.executeJavaScript(
			`new Promise((resolve,reject)=>{const check=()=>document.querySelector(${JSON.stringify(selector)})?resolve(true):setTimeout(check,20);check();setTimeout(()=>reject(new Error('UI timeout')),5000);})`,
		);
	};
	let managementDebug: BrowserWindow | undefined;
	let profiles: ReturnType<typeof registerProfiles> | undefined;
	let knob: ReturnType<typeof registerKnob> | undefined;
	let disposeLifecycle = async (): Promise<void> => {};
	let media: ReturnType<typeof registerMedia> | undefined;
	let clock: ReturnType<typeof registerClock> | undefined;
	let localeRegistration: ReturnType<typeof registerAppLocale> | undefined;
	try {
		await app.whenReady();
		process.stdout.write("profiles smoke: app ready\n");
		if (process.platform === "darwin") {
			const foreground = await nativeForegroundApp("darwin");
			assert(
				foreground._tag === "Some" && foreground.value.path.endsWith(".app"),
			);
			assert((await loadInstalledProfileApps("darwin")).length > 0);
			process.stdout.write(
				"profiles smoke: native macOS foreground identity and installed apps passed\n",
			);
		}
		const options = {
			show: false,
			width: 1280,
			height: 1000,
			webPreferences: {
				preload: resolve("out/preload/index.mjs"),
				sandbox: false,
				contextIsolation: true,
				nodeIntegration: false,
			},
		};
		const management = new BrowserWindow(options),
			panel = new BrowserWindow({ ...options, width: 960, height: 240 });
		managementDebug = management;
		const lifecycleRuntime = ManagedRuntime.make(
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
					prompt: () => Effect.die("Smoke must never prompt"),
					native: () => Effect.die("Smoke must never arrange displays"),
					openSettings: () => Effect.void,
				},
			}),
		);
		const removeLifecycle = registerLifecycle(
			lifecycleRuntime,
			() => management,
			pathToFileURL(resolve("out/renderer/index.html")).href,
		);
		disposeLifecycle = async () => {
			removeLifecycle();
			await lifecycleRuntime.dispose();
		};
		localeRegistration = registerAppLocale({
			directory,
			osLocale: "en-US",
			renderer: pathToFileURL(resolve("out/renderer/index.html")).href,
			windows: () => [management, panel],
		});
		const deliveries: string[] = [];
		profiles = registerProfiles(
			() => management,
			pathToFileURL(resolve("out/renderer/index.html")).href,
			async (serial, profile) => {
				deliveries.push(`${serial}:${profile.id}`);
			},
		);
		knob = registerKnob(
			() => panel,
			() => [panel, management],
			{
				profiles: knobProfileBinding(profiles.runtime, profiles.select),
			},
		);
		media = registerMedia(
			ManagedRuntime.make(MediaLive(join(directory, "wallpaper-v1"))),
			() => management,
		);
		clock = registerClock(
			ManagedRuntime.make(ClockLive(directory)),
			() => management,
		);
		await Promise.all([
			management.loadFile(resolve("out/renderer/index.html")),
			panel.loadFile(resolve("out/renderer/index.html"), {
				query: { surface: "panel" },
			}),
		]);
		process.stdout.write("profiles smoke: windows loaded\n");
		await management.webContents.executeJavaScript(
			"document.querySelector('.nav-item[data-nav-page=profiles]').click()",
		);
		await ready(management, ".profiles-manager");
		const first = await request(management, { type: "read", locale: "en" });
		assert.equal(first._tag, "success");
		if (first._tag !== "success") throw new Error("read failed");
		assert.equal(first.view.envelope.profiles.length, 9);
		assert(!first.view.envelope.profiles.some((p) => p.id === "local-profile"));
		if (process.platform === "darwin") {
			assert.equal(
				first.view.envelope.activeByDevice["desktop-preview"],
				undefined,
			);
			await ready(panel, '[data-theme="meetingAssistantTheme"]');
			process.stdout.write(
				"profiles smoke: fresh macOS panel uses visible MeetAI\n",
			);
		}
		await panel.loadFile(resolve("out/renderer/index.html"), {
			query: { surface: "management" },
		});
		assert.equal(
			(await request(panel, { type: "manage", command: { type: "create" } }))
				._tag,
			"rejected",
		);
		assert.equal(
			(await request(panel, { type: "run-command", id: "1-2", keyCode: "1,7" }))
				._tag,
			"rejected",
		);
		await panel.loadFile(resolve("out/renderer/index.html"), {
			query: { surface: "panel" },
		});
		await management.loadFile(resolve("out/renderer/index.html"), {
			query: { surface: "foreign" },
		});
		assert.deepEqual(
			await request(management, {
				type: "manage",
				command: { type: "create" },
			}),
			{ _tag: "rejected", reason: "unauthorized" },
		);
		assert.deepEqual(
			await request(management, {
				type: "run-command",
				id: "1-2",
				keyCode: "1,7",
			}),
			{ _tag: "rejected", reason: "unauthorized" },
		);
		await management.loadFile(resolve("out/renderer/index.html"));
		await management.webContents.executeJavaScript(
			"document.querySelector('.nav-item[data-nav-page=profiles]').click()",
		);
		await profiles.connect("desktop-preview", "1-2");
		await ready(panel, '.strip-slot[data-state="tile"]');
		assert.equal(
			await panel.webContents.executeJavaScript(
				"document.querySelectorAll('.strip-slot[data-state=tile]').length",
			),
			16,
		);
		for (const profile of first.view.envelope.profiles.filter((p) =>
			p.pages.some((page) =>
				page.keys.some((key) => key.config.type === "dkDesktopClock"),
			),
		)) {
			const knobSelection = await profiles.select(profile.id);
			assert.equal(
				knobSelection.activeByDevice["desktop-preview"]?.profileId,
				profile.id,
			);
			await knob.refresh();
			const knobRead = Schema.decodeUnknownSync(KnobReply)(
				await panel.webContents.executeJavaScript(
					'window.quakeKnob.request({_tag:"Read"})',
				),
			);
			assert.equal(knobRead._tag, "success");
			if (knobRead._tag === "success")
				assert.equal(knobRead.snapshot.context.session.profileId, profile.id);
			await ready(panel, ".oq-clock .oq-clock-stage");
			await writeFile(
				join(scratch, `built-in-clock-${profile.id}.png`),
				(await panel.webContents.capturePage()).toPNG(),
			);
		}
		await request(management, {
			type: "manage",
			command: { type: "select", id: "1-2" },
		});
		await ready(management, "button");
		await management.webContents.executeJavaScript(
			"Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Add Item').click()",
		);
		await ready(management, 'input[aria-label="Rename Custom1"]');
		process.stdout.write("profiles smoke: create visible\n");
		await management.webContents.executeJavaScript(
			"const input=document.querySelector('input[aria-label=\"Rename Custom1\"]');input.focus();input.value='My apps';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));",
		);
		await ready(management, 'input[aria-label="Rename My apps"]');
		process.stdout.write("profiles smoke: rename visible\n");
		const created = await request(management, { type: "read", locale: "en" });
		assert.equal(created._tag, "success");
		if (created._tag !== "success") throw new Error("create failed");
		assert(created.view.envelope.profiles.some((p) => p.name === "My apps"));
		await ready(panel, '.strip-screen[data-profiles="ready"]');
		const panelRead = await panel.webContents.executeJavaScript(
			"window.quakeProfiles.read()",
		);
		assert.equal(
			panelRead.envelope.activeByDevice["desktop-preview"].profileId,
			"custom-1",
		);
		assert(deliveries.includes("desktop-preview:custom-1"));
		await panel.loadFile(resolve("out/renderer/index.html"), {
			query: { surface: "panel" },
		});
		await ready(panel, '.strip-screen[data-profiles="ready"]');
		const reloaded = await panel.webContents.executeJavaScript(
			"window.quakeProfiles.read()",
		);
		assert.equal(
			reloaded.envelope.activeByDevice["desktop-preview"].profileId,
			"custom-1",
		);
		process.stdout.write("profiles smoke: UI create and rename passed\n");
		for (const [name, id] of [
			["Quick", "custom-2"],
			["My apps", "custom-3"],
		] as const) {
			await management.webContents.executeJavaScript(
				`document.querySelector('button[aria-label=${JSON.stringify(`Duplicate ${name}`)}]').click()`,
			);
			await ready(
				management,
				`input[aria-label=${JSON.stringify(`Rename ${name} - Copy1`)}]`,
			);
			const duplicate = await request(management, {
				type: "read",
				locale: "en",
			});
			assert(
				duplicate._tag === "success" &&
					duplicate.view.envelope.profiles.some(
						(p) => p.id === id && p.name.startsWith(`${name} - Copy`),
					),
			);
			await request(management, {
				type: "manage",
				command: { type: "delete", id: id ?? "", confirmed: true },
			});
		}
		process.stdout.write(
			"profiles smoke: exact document authority, built-in clock rendering and UI duplicate passed\n",
		);
		const thumbnail = await request(management, {
			type: "thumbnail",
			id: "1-2",
			locale: "en",
		});
		assert.equal(thumbnail._tag, "success");
		if (thumbnail._tag === "success")
			assert(
				thumbnail.view.thumbnails["1-2"]?.startsWith("data:image/png;base64,"),
			);
		const batch = await request(management, { type: "thumbnails" });
		assert.equal(batch._tag, "success");
		if (batch._tag === "success") {
			assert.equal(
				batch.view.progress.failed,
				0,
				JSON.stringify({
					progress: batch.view.progress,
					missing: batch.view.envelope.profiles
						.filter((profile) => !batch.view.thumbnails[profile.id])
						.map((profile) => profile.id),
				}),
			);
			assert.equal(batch.view.progress.done, 9);
		}
		await management.webContents.executeJavaScript(
			"document.querySelector('.profiles-manager').scrollIntoView()",
		);
		await writeFile(
			join(scratch, "manager.png"),
			(await management.webContents.capturePage()).toPNG(),
		);
		await writeFile(
			join(scratch, "selected-profile.png"),
			(await panel.webContents.capturePage()).toPNG(),
		);
		await management.webContents.executeJavaScript(
			"document.querySelector('.profile-settings').scrollIntoView({behavior:'instant',block:'start'}); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
		);
		await writeFile(
			join(scratch, "profile-settings.png"),
			(await management.webContents.capturePage()).toPNG(),
		);
		// MGMT-337: hidden Chromium windows emulate keyboard focus without OS input.
		management.webContents.debugger.attach("1.3");
		await management.webContents.debugger.sendCommand("DOM.enable");
		await management.webContents.debugger.sendCommand("CSS.enable");
		const documentNode =
			await management.webContents.debugger.sendCommand("DOM.getDocument");
		const propertyNode = await management.webContents.debugger.sendCommand(
			"DOM.querySelector",
			{
				nodeId: documentNode.root.nodeId,
				selector: ".profile-settings select",
			},
		);
		await management.webContents.debugger.sendCommand("CSS.forcePseudoState", {
			nodeId: propertyNode.nodeId,
			forcedPseudoClasses: ["focus", "focus-visible"],
		});
		for (const locale of ["en", "de"] as const) {
			await management.webContents.executeJavaScript(`(() => {
				const select = document.querySelector('.profiles-manager > header select');
				select.value = ${JSON.stringify(locale)};
				select.dispatchEvent(new Event('change', {bubbles:true}));
			})()`);
			await ready(
				management,
				`html[lang="${locale}"] [data-profile-ready="1-2"]`,
			);
			assert.equal(
				await management.webContents.executeJavaScript(
					"document.documentElement.lang",
				),
				locale,
			);
			for (const width of [1280, 390]) {
				management.setContentSize(width, 1000);
				await management.webContents.executeJavaScript(
					"document.querySelector('.profile-settings select').focus()",
				);

				const fields =
					await management.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
					const field = document.querySelector('.profile-settings select');
					field.scrollIntoView({behavior:'instant',block:'center'});
					const style = getComputedStyle(field), rect = field.getBoundingClientRect();
					resolve({focused:document.activeElement === field, width:rect.width,
						left:rect.left,right:rect.right,color:style.color,background:style.backgroundColor,
						fontSize:parseFloat(style.fontSize),outline:style.outlineStyle,shadow:style.boxShadow,
						overflow:document.documentElement.scrollWidth > innerWidth});
				})))`);
				assert(
					fields.focused &&
						fields.width > 0 &&
						fields.left >= 0 &&
						fields.right <= width,
				);
				const contrast = assertPropertyContrast(
					fields.color,
					fields.background,
				);
				process.stdout.write(
					`profiles smoke: ${locale} ${width}px property contrast ${contrast.toFixed(2)}:1\n`,
				);
				assert(fields.fontSize >= 12, "Property text must remain readable");
				assert(
					fields.outline !== "none" || fields.shadow !== "none",
					`Focused property needs a visible indicator: ${JSON.stringify(fields)}`,
				);
				assert(!fields.overflow, "Management must not overflow horizontally");
				await writeFile(
					join(scratch, `profile-settings-${locale}-${width}.png`),
					(await management.webContents.capturePage()).toPNG(),
				);
				management.webContents.send(
					PROFILE_FOREGROUND_GUIDANCE,
					"accessibility-denied",
				);
				await ready(management, ".profiles-manager [role=alert]");
				const guidance =
					await management.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
					const alert = document.querySelector('.profiles-manager [role=alert]');
					alert.scrollIntoView({behavior:'instant',block:'center'});
					resolve({text:alert.textContent,overflow:document.documentElement.scrollWidth > innerWidth});
				})))`);
				assert(
					guidance.text.includes(
						locale === "de" ? "Bedienungshilfen" : "Accessibility",
					),
				);
				assert(!guidance.overflow);
				await writeFile(
					join(scratch, `foreground-guidance-${locale}-${width}.png`),
					(await management.webContents.capturePage()).toPNG(),
				);
				management.webContents.send(PROFILE_FOREGROUND_GUIDANCE, "available");
				assert(
					await management.webContents.executeJavaScript(
						`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(!document.querySelector('.profiles-manager [role=alert]')))))`,
					),
				);
			}
		}
		management.webContents.debugger.detach();
		process.stdout.write(
			"profiles smoke: MGMT-337 EN/DE fields, focus and 390px layout passed\n",
		);
		management.setContentSize(1280, 1000);
		const startup = await request(management, {
			type: "manage",
			command: { type: "startup", id: "1-2", enabled: true, confirmed: true },
		});
		assert.equal(startup._tag, "success");
		await knob.dispose();
		await profiles.dispose();
		managementDebug = management;
		profiles = registerProfiles(
			() => management,
			pathToFileURL(resolve("out/renderer/index.html")).href,
		);
		knob = registerKnob(
			() => panel,
			() => [panel, management],
			{
				profiles: knobProfileBinding(profiles.runtime, profiles.select),
			},
		);
		await profiles.connect("desktop-preview", "1-1");
		await management.loadFile(resolve("out/renderer/index.html"));
		const restarted = await request(management, { type: "read", locale: "en" });
		assert.equal(restarted._tag, "success");
		if (restarted._tag === "success") {
			assert(
				restarted.view.envelope.profiles.some((p) => p.name === "My apps"),
			);
			assert.equal(
				restarted.view.envelope.activeByDevice["desktop-preview"]?.profileId,
				"1-2",
			);
			assert(restarted.view.thumbnails["1-2"]);
		}
		process.stdout.write(
			"Profiles native smoke PASS: nine-resource install; UI create/rename; panel delivery; protected IPC; real capture/batch; restart/default persistence.\n",
		);
	} catch (cause) {
		await reportSmokeFailure(cause, async () => {
			if (managementDebug && !managementDebug.isDestroyed()) {
				await writeFile(
					join(scratch, "failure.png"),
					(await managementDebug.webContents.capturePage()).toPNG(),
				);
				await writeFile(
					join(scratch, "failure.txt"),
					String(
						await managementDebug.webContents.executeJavaScript(
							"document.body.innerText",
						),
					),
				);
			}
		});
	} finally {
		// Stop renderer reads before draining registration-owned requests.
		for (const win of BrowserWindow.getAllWindows()) win.destroy();
		await disposeLifecycle();
		await knob?.dispose();
		await profiles?.dispose();
		await media?.dispose();
		await clock?.dispose();
		await localeRegistration?.dispose();
		await rm(directory, { recursive: true, force: true });
		app.exit(Number(process.exitCode ?? 0));
	}
}
void smoke();
