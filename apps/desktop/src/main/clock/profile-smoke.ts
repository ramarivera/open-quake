/** Hidden production-profile clock acceptance. No native device bus or HID. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ManagedRuntime, Schema } from "effect";
import { app, BrowserWindow } from "electron";
import { builtinProfiles } from "../../../../../packages/device/src/profiles/profile-catalog.js";
import { Profile } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository.js";
import { MediaLive, registerMedia } from "../media";
import { registerProfiles } from "../profiles";
import { ClockLive, registerClock, registerClockScheme } from "./index";

assert.equal(process.env.OPEN_QUAKE_MOCK_DEVICE, "1", "Mock mode is required");
registerClockScheme();
// Keep the process alive while every owner/window is replaced for the restart check.
app.on("window-all-closed", () => {});
async function smoke(): Promise<void> {
	let assertions = 0;
	const check = (value: unknown, message: string): void => {
		assert(value, message);
		assertions++;
	};
	const artifactArgument = process.argv[2];
	assert(artifactArgument, "Screenshot directory is required");
	const artifacts = resolve(artifactArgument);
	await mkdir(artifacts, { recursive: true });
	const root = await mkdtemp(join(artifacts, "native-"));
	app.setPath("userData", root);
	const preset = builtinProfiles("darwin").find((p) =>
		p.pages.some((page) =>
			page.keys.some((k) => k.config.type === "dkDesktopClock"),
		),
	);
	assert(preset);
	const first = {
		...Schema.encodeSync(Profile)(preset),
		id: "clock-a",
		name: "12-hour clock",
	};
	const second = { ...first, id: "clock-b", name: "24-hour clock" };
	await writeFile(
		join(root, "profiles-v1.json"),
		JSON.stringify({
			schemaVersion: 1,
			manager: {
				revision: 0,
				nextId: 1,
				installed: true,
				hidden: [],
				userHasSetDefault: true,
				links: [],
				approvedCommands: [],
			},
			profiles: [first, second],
			activeByDevice: {
				"desktop-preview": { profileId: first.id, pageId: first.pages[0].id },
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
	const evaluate = (win: BrowserWindow, source: string) =>
		win.webContents.executeJavaScript(source);
	const wait = async (win: BrowserWindow, expression: string) =>
		evaluate(
			win,
			`new Promise((resolve,reject)=>{const end=Date.now()+10000;const check=()=>{if(${expression})return resolve(true);if(Date.now()>end)return reject(new Error('Clock profile smoke timeout: '+${JSON.stringify(expression)}));setTimeout(check,25)};check()})`,
		);
	let profiles: ReturnType<typeof registerProfiles> | undefined;
	let clock: ReturnType<typeof registerClock> | undefined;
	let media: ReturnType<typeof registerMedia> | undefined;
	async function start() {
		process.stdout.write("Starting profile owners and hidden windows\n");
		const management = new BrowserWindow(options);
		const panel = new BrowserWindow({ ...options, width: 1920, height: 480 });
		profiles = registerProfiles(() => management);
		clock = registerClock(
			ManagedRuntime.make(ClockLive(root, profiles.runtime)),
			() => management,
		);
		media = registerMedia(
			ManagedRuntime.make(MediaLive(join(root, "wallpaper-v1"))),
			() => management,
		);
		await Promise.all([
			management.loadFile(page),
			panel.loadFile(page, { query: { surface: "panel" } }),
		]);
		await wait(management, "!!document.querySelector('[data-nav-page=keys]')");
		await wait(panel, "!!document.querySelector('.oq-clock')");
		return { management, panel };
	}
	async function stop() {
		await clock?.dispose();
		await profiles?.dispose();
		await media?.dispose();
		for (const win of BrowserWindow.getAllWindows()) win.destroy();
		clock = undefined;
		profiles = undefined;
		media = undefined;
	}
	async function capture(panel: BrowserWindow, name: string) {
		process.stdout.write(`Capturing ${name}\n`);
		await evaluate(panel, "document.fonts.ready");
		await writeFile(
			join(artifacts, `${name}.png`),
			(await panel.webContents.capturePage()).toPNG(),
		);
	}
	try {
		await app.whenReady();
		if (process.platform === "darwin") app.dock?.hide();
		const { management, panel } = await start();
		await evaluate(
			management,
			"document.querySelector('[data-nav-page=keys]').click()",
		);
		await wait(management, "!!document.querySelector('.keys-cells')");
		await evaluate(
			management,
			"[...document.querySelectorAll('.keys-cells button')].find(b=>b.textContent==='1,1').click()",
		);
		await wait(
			management,
			"!!document.querySelector('.clock-settings input[type=radio]') && !document.querySelector('.clock-settings input[type=radio]').disabled",
		);
		const before = await profiles?.runtime.runPromise(ProfileRepository.load());
		assert(before);
		const originalB = before.envelope.profiles.find((p) => p.id === second.id);
		await evaluate(
			management,
			"[...document.querySelectorAll('.clock-settings label')].find(b=>b.textContent==='12-Hour (AM/PM)').click()",
		);
		await wait(panel, "!!document.querySelector('.oq-clock-meridiem')");
		check(
			await evaluate(panel, "!!document.querySelector('.oq-clock-meridiem')"),
			"key editor format reaches the panel",
		);
		await wait(
			management,
			"!![...document.querySelectorAll('.clock-settings label')].find(b=>b.textContent==='On'&&!b.querySelector('input').disabled)",
		);
		await evaluate(
			management,
			"[...document.querySelectorAll('.clock-settings label')].find(b=>b.textContent==='On').click()",
		);
		await wait(panel, "!!document.querySelector('.oq-clock-seconds')");
		check(
			await evaluate(panel, "!!document.querySelector('.oq-clock-seconds')"),
			"second edit after format has fresh profile revision",
		);
		await capture(panel, "profile-a-12h-seconds");
		const after = await profiles?.runtime.runPromise(ProfileRepository.load());
		assert(after);
		check(
			JSON.stringify(originalB) ===
				JSON.stringify(after.envelope.profiles.find((p) => p.id === second.id)),
			"profile B remains byte-identical",
		);
		const originalKey = before.envelope.profiles[0].pages[0].keys[0];
		const editedKey = after.envelope.profiles[0].pages[0].keys[0];
		check(
			JSON.stringify({ ...originalKey?.config, actions: [] }) ===
				JSON.stringify({ ...editedKey?.config, actions: [] }),
			"unrelated clock key fields remain unchanged",
		);
		check(
			after.envelope.clockConfigVersion === 1,
			"migration marker is committed",
		);
		check(
			!(await evaluate(
				management,
				"(async()=>{const r=await window.quakeWallpaper.request({_tag:'read'});return r.snapshot.saved.clock.actions[0].value==='12h'})()",
			)),
			"key editor leaves legacy wallpaper format unchanged",
		);
		await profiles?.select(second.id);
		await wait(
			panel,
			"!!document.querySelector('.oq-clock') && !document.querySelector('.oq-clock-meridiem') && !document.querySelector('.oq-clock-seconds')",
		);
		await capture(panel, "profile-b-24h-minutes");
		check(
			await evaluate(
				panel,
				"!document.querySelector('.oq-clock-meridiem') && !document.querySelector('.oq-clock-seconds')",
			),
			"profile B renders 24h without seconds",
		);
		await stop();
		const restarted = await start();
		await wait(
			restarted.panel,
			"!document.querySelector('.oq-clock-meridiem')",
		);
		check(
			await evaluate(
				restarted.panel,
				"!document.querySelector('.oq-clock-meridiem') && !document.querySelector('.oq-clock-seconds')",
			),
			"profile B survives owner restart",
		);
		await profiles?.select(first.id);
		await wait(
			restarted.panel,
			"!!document.querySelector('.oq-clock-meridiem') && !!document.querySelector('.oq-clock-seconds')",
		);
		await capture(restarted.panel, "profile-a-after-restart");
		check(
			await evaluate(
				restarted.panel,
				"!!document.querySelector('.oq-clock-meridiem') && !!document.querySelector('.oq-clock-seconds')",
			),
			"profile A survives owner restart",
		);
		const disk = JSON.parse(
			await readFile(join(root, "profiles-v1.json"), "utf8"),
		);
		check(
			disk.clockConfigVersion === 1 && disk.profiles.length === 2,
			"canonical profile file holds both clocks",
		);
		await stop();
		check(
			BrowserWindow.getAllWindows().length === 0,
			"all hidden windows are closed",
		);
		await writeFile(
			join(artifacts, "profile-smoke-result.json"),
			JSON.stringify(
				{
					assertions,
					root,
					hardware: "unverified",
					screenshots: [
						"profile-a-12h-seconds.png",
						"profile-b-24h-minutes.png",
						"profile-a-after-restart.png",
					],
				},
				null,
				2,
			),
		);
		process.stdout.write(
			`Clock profile native smoke PASS: ${assertions} assertions, 3 screenshots, hardware unverified.\n`,
		);
		app.quit();
	} catch (cause) {
		process.stderr.write(
			`${cause instanceof Error ? cause.stack : String(cause)}\n`,
		);
		for (const [index, win] of BrowserWindow.getAllWindows().entries()) {
			if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
			try {
				await writeFile(
					join(artifacts, `failed-${index}.html`),
					await evaluate(win, "document.documentElement.outerHTML"),
				).catch(() => {});
				await writeFile(
					join(artifacts, `failed-${index}.png`),
					(await win.webContents.capturePage()).toPNG(),
				).catch(() => {});
			} catch {}
		}
		await stop();
		app.exit(1);
	}
}
void smoke().catch((cause) => {
	process.stderr.write(
		`${cause instanceof Error ? cause.stack : String(cause)}\n`,
	);
	app.exit(1);
});
