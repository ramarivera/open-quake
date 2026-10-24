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
	ProfileReplySchema,
	type ProfileRequest,
} from "../../shared/profile-manager";
import { ClockLive, registerClock, registerClockScheme } from "../clock";
import { registerKnob } from "../knob";
import { knobProfileBinding } from "../knob/profile-binding";
import { DeviceLifecycle } from "../lifecycle/lifecycle-service";
import { registerLifecycle } from "../lifecycle/registration";
import { MediaLive, registerMedia } from "../media";
import { nativeForegroundApp } from "./foreground-app";
import { registerProfiles } from "./index";
import { loadInstalledProfileApps } from "./installed-apps";
import { reportSmokeFailure } from "./smoke-failure";

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
		const deliveries: string[] = [];
		profiles = registerProfiles(
			() => management,
			undefined,
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
			"Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.includes('Knob Profile')).click()",
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
			"Array.from(document.querySelectorAll('nav button')).find(b=>b.textContent.includes('Knob Profile')).click()",
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
			assert.equal(batch.view.progress.failed, 0);
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
		management.setContentSize(520, 1000);
		await management.webContents.executeJavaScript(
			"document.querySelector('.profiles-manager').scrollIntoView({behavior:'instant',block:'start'}); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
		);
		assert(
			await management.webContents.executeJavaScript(
				"document.documentElement.scrollWidth <= innerWidth",
			),
			"Narrow management must not overflow horizontally",
		);
		await writeFile(
			join(scratch, "manager-narrow.png"),
			(await management.webContents.capturePage()).toPNG(),
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
		profiles = registerProfiles(() => management);
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
		await disposeLifecycle();
		await knob?.dispose();
		await profiles?.dispose();
		await media?.dispose();
		await clock?.dispose();
		for (const win of BrowserWindow.getAllWindows()) win.destroy();
		await rm(directory, { recursive: true, force: true });
		app.exit(Number(process.exitCode ?? 0));
	}
}
void smoke();
