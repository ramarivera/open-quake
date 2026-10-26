/** Native meeting proof with real renderer/preload/main and synthetic capture/providers. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
	chmod,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { HardwareControls } from "@open-quake/device";
import { Effect, Exit, ManagedRuntime, Option, Schema, Scope } from "effect";
import { app, BrowserWindow, dialog, nativeTheme } from "electron";
import { builtinProfiles } from "../../../../../packages/device/src/profiles/profile-catalog";
import { Profile } from "../../../../../packages/device/src/profiles/profile-contracts";
import type { MeetingAdapter } from "../../../../../packages/edge/src/ai/meeting-adapter";
import {
	type MeetingCommand,
	MeetingId,
	MeetingReply,
	MeetingStore,
} from "../../../../../packages/edge/src/meetings/meeting-contracts";
import { meetingError } from "../../../../../packages/edge/src/meetings/meeting-errors";
import { exportArtifact } from "../../../../../packages/edge/src/meetings/meeting-invariants";
import { MeetingService } from "../../../../../packages/edge/src/meetings/meeting-service";
import {
	APPEARANCE_STORAGE_KEY,
	defaultAppearance,
} from "../../renderer/src/theme/appearance";
import { registerAgents } from "../agents";
import { registerHardware } from "../hardware";
import { startMockHardwareBus } from "../hardware/bus";
import { registerKnob } from "../knob";
import { DeviceLifecycle } from "../lifecycle/lifecycle-service";
import { registerLifecycle } from "../lifecycle/registration";
import { registerMaintenance } from "../maintenance";
import { registerManagementAppearance } from "../management/appearance";
import { MediaLive, registerMedia } from "../media";
import { registerMonitor } from "../monitor";
import { registerProfiles } from "../profiles";
import { reportSmokeFailure } from "../profiles/smoke-failure";
import { registerAppLocale } from "../settings/registration";
import { stripFixtureEnvelope } from "../test/strip-fixtures";
import { createToneRecorder, registerVoiceSurface } from "../voice";
import { audioFiles } from "./audio-files";
import { mockMeetingAdapter, registerMeetings } from "./index";
import { meetingStorage } from "./storage";

app.on("window-all-closed", () => {});

async function smoke(): Promise<void> {
	assert.equal(process.env.OPEN_QUAKE_MOCK_DEVICE, "1");
	assert(process.argv[2], "Pass the lane scratch directory");
	const scratch = resolve(process.argv[2]);
	await mkdir(scratch, { recursive: true });
	const directory = await mkdtemp(join(scratch, "native-meetings-"));
	app.setPath("userData", directory);
	const renderer = pathToFileURL(resolve("out/renderer/index.html")).href;
	let failAsr = false;
	let submissions = 0;
	const hardwareRuntime = ManagedRuntime.make(HardwareControls.Default);
	const hardwareScope = await Effect.runPromise(Scope.make());
	const adapter: MeetingAdapter = {
		...mockMeetingAdapter,
		submit: (request) => {
			submissions++;
			return mockMeetingAdapter.submit(request);
		},
		poll: () =>
			Effect.sleep(1500).pipe(
				Effect.zipRight(
					failAsr
						? Effect.fail(meetingError("TranscriptionFailed"))
						: mockMeetingAdapter.poll("mock-task"),
				),
			),
	};
	let meetings: ReturnType<typeof registerMeetings> | undefined;
	let profiles: ReturnType<typeof registerProfiles> | undefined;
	let media: ReturnType<typeof registerMedia> | undefined;
	let knob: ReturnType<typeof registerKnob> | undefined;
	let voice: ReturnType<typeof registerVoiceSurface> | undefined;
	let maintenance: ReturnType<typeof registerMaintenance> | undefined;
	let monitor: ReturnType<typeof registerMonitor> | undefined;
	let agents: ReturnType<typeof registerAgents> | undefined;
	let disposeAppearance = () => {};
	let locale: ReturnType<typeof registerAppLocale> | undefined;
	let unregisterHardware = () => {};
	let disposeLifecycle = async () => {};
	let exitCode = 0;
	const errors: string[] = [];
	const request = async (win: BrowserWindow, command: MeetingCommand) => {
		const reply = Schema.decodeUnknownSync(MeetingReply)(
			await win.webContents.executeJavaScript(
				`window.quakeMeetings.request(${JSON.stringify(command)})`,
			),
		);
		assert.equal(reply._tag, "ready", JSON.stringify(reply));
		if (reply._tag !== "ready") throw new Error("Meeting request failed");
		return reply.snapshot;
	};
	const wait = async (win: BrowserWindow, predicate: string) => {
		await win.webContents.executeJavaScript(
			`new Promise((resolve,reject)=>{const deadline=Date.now()+12000;const check=()=>{if(${predicate})resolve(true);else if(Date.now()>deadline)reject(new Error('Meeting UI timeout: '+${JSON.stringify(predicate)}));else setTimeout(check,20)};check()})`,
		);
	};
	const click = async (win: BrowserWindow, selector: string) => {
		await win.webContents.executeJavaScript(
			`document.querySelector(${JSON.stringify(selector)}).click(); null;`,
		);
	};
	const capture = async (win: BrowserWindow, name: string) => {
		await win.webContents.executeJavaScript(
			"new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
		);
		await writeFile(
			join(scratch, `${name}.png`),
			(await win.webContents.capturePage()).toPNG(),
		);
	};
	// AI-333: computed styles on actual mounted states, with both motion owners.
	const reducedMotion = async (
		win: BrowserWindow,
		selectors: readonly string[],
	) => {
		win.webContents.debugger.attach("1.3");
		try {
			for (const mode of ["os", "app"] as const) {
				await win.webContents.debugger.sendCommand(
					"Emulation.setEmulatedMedia",
					{
						features: [
							{
								name: "prefers-reduced-motion",
								value: mode === "os" ? "reduce" : "no-preference",
							},
						],
					},
				);
				await win.webContents.executeJavaScript(
					`new BroadcastChannel(${JSON.stringify(APPEARANCE_STORAGE_KEY)}).postMessage(${JSON.stringify({ ...defaultAppearance, motion: mode === "app" ? "reduce" : "system" })});null;`,
				);
				await wait(
					win,
					`document.documentElement.dataset.motion==='reduce' && matchMedia('(prefers-reduced-motion: reduce)').matches===${mode === "os"}`,
				);
				for (const selector of selectors) {
					const style = await win.webContents.executeJavaScript(
						`(() => {const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing motion subject '+${JSON.stringify(selector)});const s=getComputedStyle(e);return {animation:s.animationName,transition:s.transitionDuration};})()`,
					);
					assert.deepEqual(
						style,
						{ animation: "none", transition: "0s" },
						`${mode} reduced motion: ${selector}`,
					);
				}
				assert(
					await win.webContents.executeJavaScript(
						"document.querySelector('.meeting-display').getBoundingClientRect().width>0 && !!document.querySelector('.meeting-animation p, .meeting-translations p, footer')?.textContent",
					),
					"Reduced motion keeps status visible",
				);
			}
		} finally {
			await win.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
				features: [],
			});
			win.webContents.debugger.detach();
			await win.webContents.executeJavaScript(
				`new BroadcastChannel(${JSON.stringify(APPEARANCE_STORAGE_KEY)}).postMessage(${JSON.stringify(defaultAppearance)});null;`,
			);
		}
	};
	try {
		await app.whenReady();
		nativeTheme.themeSource = "dark";
		const run = promisify(execFile);
		const synthetic = join(directory, "synthetic.webm");
		await run("ffmpeg", [
			"-hide_banner",
			"-loglevel",
			"error",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:sample_rate=48000:duration=0.25013",
			"-c:a",
			"libopus",
			"-y",
			synthetic,
		]);
		const files = audioFiles(directory, "ffmpeg");
		const syntheticId = crypto.randomUUID();
		for (const segment of [0, 1])
			for (const track of ["mic", "system"] as const)
				await Effect.runPromise(
					files.write({
						id: syntheticId,
						segment,
						track,
						bytes: new Uint8Array(await readFile(synthetic)),
					}),
				);
		await chmod(join(directory, syntheticId), 0o755);
		for (const name of [
			"merged_0.mp3",
			"merged_1.mp3",
			"final_recording.mp3",
		]) {
			await writeFile(join(directory, syntheticId, name), "old");
			await chmod(join(directory, syntheticId, name), 0o644);
		}
		await Effect.runPromise(files.finalize(syntheticId));
		for (const name of ["merged_0.mp3", "merged_1.mp3", "final_recording.mp3"])
			assert.equal(
				(await stat(join(directory, syntheticId, name))).mode & 0o777,
				0o600,
			);
		assert.equal(
			(await stat(join(directory, syntheticId))).mode & 0o777,
			0o700,
		);
		const recoveredDuration = await Effect.runPromise(
			files.duration(syntheticId),
		);
		assert(
			recoveredDuration >= 450 && recoveredDuration <= 600,
			`Duration ${recoveredDuration}`,
		);
		const probe = await run("ffprobe", [
			"-v",
			"error",
			"-show_entries",
			"stream=sample_rate,channels,codec_name",
			"-of",
			"json",
			join(directory, syntheticId, "final_recording.mp3"),
		]);
		const decoded = Schema.decodeUnknownSync(
			Schema.Struct({
				streams: Schema.Array(
					Schema.Struct({
						sample_rate: Schema.String,
						channels: Schema.Number,
						codec_name: Schema.String,
					}),
				),
			}),
		)(JSON.parse(probe.stdout));
		assert.deepEqual(decoded.streams, [
			{ sample_rate: "48000", channels: 1, codec_name: "mp3" },
		]);
		await writeFile(join(scratch, "audio-finalization.json"), probe.stdout);
		const options = {
			show: false,
			useContentSize: true,
			width: 1440,
			height: 1000,
			webPreferences: {
				preload: resolve("out/preload/index.mjs"),
				sandbox: false,
				contextIsolation: true,
				nodeIntegration: false,
			},
		};
		const management = new BrowserWindow(options);
		const panel = new BrowserWindow({ ...options, width: 1920, height: 480 });
		locale = registerAppLocale({
			directory,
			osLocale: "en-US",
			renderer,
			windows: () => [management, panel],
		});
		management.webContents.setAudioMuted(true);
		panel.webContents.setAudioMuted(true);
		disposeAppearance = registerManagementAppearance(
			() => management,
			directory,
			renderer,
		);
		maintenance = registerMaintenance({
			root: directory,
			mock: true,
			renderer,
			hardware: () => undefined,
			management: () => management,
			stopWriters: async () => {},
		});
		voice = registerVoiceSurface({
			mock: true,
			tones: createToneRecorder(),
			serial: () => "meeting-smoke",
			panel: () => panel,
			management: () => management,
			renderer,
		});
		monitor = registerMonitor(
			directory,
			() => management,
			() => panel,
			{
				collect: () => Effect.succeed({ state: "unavailable", values: {} }),
			},
			renderer,
		);
		for (const win of [management, panel])
			win.webContents.on("console-message", (event) => {
				const message = event.message;
				if (event.level === "error")
					process.stderr.write(`renderer: ${message}\n`);
				if (
					message.includes("No handler registered") ||
					message.includes("Uncaught")
				)
					errors.push(message);
			});
		const mockBus = await hardwareRuntime.runPromise(
			startMockHardwareBus().pipe(
				Effect.provideService(Scope.Scope, hardwareScope),
			),
		);
		meetings = registerMeetings({
			userData: directory,
			hardware: () => mockBus.hardware(),
			mock: true,
			renderer,
			adapter,
		});
		const runtime = meetings.runtime;
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
					prompt: () => Effect.die("No smoke prompts"),
					native: () => Effect.die("No native arrangement"),
					openSettings: () => Effect.void,
				},
			}),
		);
		const removeLifecycle = registerLifecycle(
			lifecycleRuntime,
			() => management,
			renderer,
		);
		disposeLifecycle = async () => {
			removeLifecycle();
			await lifecycleRuntime.dispose();
		};
		const profile = builtinProfiles("darwin", "en").find((p) => p.id === "1-1");
		assert(profile);
		const envelope = stripFixtureEnvelope(
			Schema.encodeSync(Profile)(profile),
			"meeting-smoke",
		);
		await writeFile(
			join(directory, "profiles-v1.json"),
			JSON.stringify(envelope),
		);
		profiles = registerProfiles(() => management, renderer);
		agents = registerAgents({
			management: () => management,
			renderer,
			profiles: profiles.runtime,
		});
		media = registerMedia(
			ManagedRuntime.make(MediaLive(join(directory, "wallpaper-v1"))),
			() => management,
		);
		knob = registerKnob(
			() => panel,
			() => [panel, management],
		);
		unregisterHardware = registerHardware(
			() => undefined,
			() => management,
			true,
		);
		await Promise.all([
			management.loadURL(renderer),
			panel.loadURL(`${renderer}?surface=panel`),
		]);
		await management.webContents.executeJavaScript(
			"document.querySelector('.nav-item[data-nav-page=meetings]').click(); null;",
		);
		await wait(management, "!!document.querySelector('.meetings-page')");
		await wait(
			panel,
			"document.querySelectorAll('[data-meeting-action]').length === 5",
		);
		await capture(panel, "meetings-idle");
		await panel.webContents.executeJavaScript(
			"window.__meetingNativeKeys=[];document.getElementById('root').addEventListener('quake-strip-key',event=>window.__meetingNativeKeys.push(event.detail));null;",
		);
		const nativeKey = async (action: string, cancelled = false) => {
			const before = Schema.decodeUnknownSync(Schema.Int)(
				await panel.webContents.executeJavaScript(
					"window.__meetingNativeKeys.length",
				),
			);
			const point = await panel.webContents.executeJavaScript(
				`(() => {const b=document.querySelector('[data-meeting-action="${action}"]').getBoundingClientRect();return {x:b.x+b.width/2,y:480-b.y-b.height/2,keyCode:document.querySelector('[data-meeting-action="${action}"]').closest('[data-key-code]').dataset.keyCode};})()`,
			);
			const decoded = Schema.decodeUnknownSync(
				Schema.Struct({
					x: Schema.Number,
					y: Schema.Number,
					keyCode: Schema.String,
				}),
			)(point);
			for (const state of cancelled ? [1] : [1, 0])
				panel.webContents.send("quake:event", {
					source: "mock",
					kind: "touch",
					points: [{ x: decoded.x, y: decoded.y, action: state }],
				});
			if (cancelled)
				panel.webContents.send("quake:event", {
					source: "mock",
					kind: "status",
					state: "disconnected",
					reason: "synthetic-cancel",
				});
			await wait(
				panel,
				`window.__meetingNativeKeys.length >= ${before + 2} && window.__meetingNativeKeys.at(-1)?.keyCode === ${JSON.stringify(decoded.keyCode)} && window.__meetingNativeKeys.at(-1)?.keyAction === 1 && !!window.__meetingNativeKeys.at(-1)?.voiceTouchEnd === ${!cancelled}`,
			);
		};
		await nativeKey("meetingMinutes", true);
		assert.equal((await request(panel, { _tag: "read" })).records.length, 0);
		await capture(panel, "meetings-cancelled-touch");
		const beforeMic = (await request(panel, { _tag: "read" })).mic;
		await nativeKey("mic");
		await wait(
			panel,
			`document.querySelector('[data-meeting-action="mic"]').getAttribute('aria-pressed') === '${Option.isSome(beforeMic) && !beforeMic.value}'`,
		);
		const afterMic = (await request(panel, { _tag: "read" })).mic;
		assert(
			Option.isSome(beforeMic) &&
				Option.isSome(afterMic) &&
				beforeMic.value !== afterMic.value,
		);
		await capture(panel, "meetings-idle");
		await capture(management, "meetings-history-empty");
		await nativeKey("meetingMinutes");
		await wait(panel, "document.querySelector('[data-animation=recording]')");
		const started = await request(panel, { _tag: "read" });
		assert.equal(started.records.length, 1);
		const id = started.records[0]?.id;
		assert(id);
		// A repeated click during the authoritative five-second cooldown cannot stop capture.
		await nativeKey("meetingMinutes");
		assert.equal(
			(await request(panel, { _tag: "read" })).records[0]?.state,
			"recording",
		);
		await nativeKey("meetingRecordMark");
		await nativeKey("tempMeetingMinutes");
		await wait(
			panel,
			"document.querySelector('.meeting-mark-count')?.textContent === '1'",
		);
		assert.equal(
			(await request(panel, { _tag: "read" })).records.filter(
				(r) => r.state === "recording",
			).length,
			2,
		);
		await click(panel, '[aria-label="Main minutes"]');
		await reducedMotion(panel, [
			".meeting-animation[data-animation=recording] .meeting-orbit i",
			".meeting-start[data-active=true] .meeting-key-glyph",
			".meeting-mark-count",
		]);
		await capture(panel, "meetings-recording-side-mark");
		await nativeKey("liveAudioTranslate");
		await runtime.runPromise(MeetingService.translate(new Uint8Array(14400)));
		await wait(
			panel,
			"document.querySelectorAll('.meeting-translations p').length > 0",
		);
		await click(panel, '[aria-label="Expand toolbar"]');
		// Exercise the real native touch listener, rather than invoking its click handler.
		await panel.webContents.executeJavaScript(
			"const b=document.querySelector('[aria-label=\"Increase font size\"]');b.dispatchEvent(new CustomEvent('quake-sub-touch-start',{detail:{}}));b.dispatchEvent(new CustomEvent('quake-sub-touch-end',{detail:{isEffective:true}}));null;",
		);
		assert.equal(
			await panel.webContents.executeJavaScript(
				"document.querySelector('.meeting-viewer-body').style.fontSize",
			),
			"26px",
		);
		await reducedMotion(panel, [".meeting-display[data-translating=true]"]);
		await capture(panel, "meetings-live-translation");
		await click(panel, '[aria-label="Main minutes"]');
		await new Promise((resolve) => setTimeout(resolve, 5100));
		await nativeKey("meetingMinutes");
		await wait(panel, "document.querySelector('[data-animation=processing]')");
		await reducedMotion(panel, [".meeting-gear", ".meeting-gear.small"]);
		await capture(panel, "meetings-processing");
		await wait(panel, "document.querySelector('[data-animation=success]')");
		assert.equal(
			await panel.webContents.executeJavaScript(
				"document.querySelectorAll('.meeting-firework').length",
			),
			35,
		);
		await reducedMotion(panel, [".meeting-firework"]);
		await capture(panel, "meetings-success");
		await wait(
			management,
			"document.querySelectorAll('.meeting-record [data-state=completed]').length === 2",
		);
		await click(management, ".meeting-record:last-child");
		await click(management, ".meeting-document-tabs [role=tab]:first-child");
		await capture(management, "meetings-history-summary");
		// AI-334: the real owner preserves the forced 5x2 viewer footprint.
		assert.deepEqual(
			await management.webContents.executeJavaScript(`(async () => {
    const state=await window.quakeKeyLibrary.request({type:'read',locale:'en'});
    if(state._tag!=='success')throw new Error('Key read rejected');
    const p=state.envelope.profiles.find(p=>p.id==='1-1'), page=p.pages[0], key=page.keys.find(k=>k.keyCode==='1,1');
    const target={token:'meeting-viewer-size',profileId:p.id,pageId:page.id,keyCode:key.keyCode,revision:p.revision};
    return window.quakeKeyLibrary.request({type:'preview',target,key:{...key,config:{...key.config,size:[3,1]}}});
   })()`),
			{ _tag: "rejected", reason: "layout-locked-or-invalid" },
		);
		for (const tab of ["main", "temp"] as const) {
			await request(panel, { _tag: "tab", tab });
			await wait(panel, "!!document.querySelector('.meeting-safe-text')");
			const target = Schema.decodeUnknownSync(
				Schema.Struct({ x: Schema.Number, y: Schema.Number }),
			)(
				await panel.webContents.executeJavaScript(`(() => {
    const tile=document.querySelector('.meeting-display'),t=tile.getBoundingClientRect(),b=tile.querySelector('[aria-label=Clear]').getBoundingClientRect();
    if(b.x<t.x||b.right>t.right+1||b.y<t.y||b.bottom>t.bottom+1)throw new Error('Clear outside scaled viewer');
    return {x:b.x+b.width/2,y:480-b.y-b.height/2};
   })()`),
			);
			for (const action of [1, 0])
				panel.webContents.send("quake:event", {
					source: "mock",
					kind: "touch",
					points: [{ ...target, action }],
				});
			await wait(panel, "!document.querySelector('.meeting-safe-text')");
			assert(
				(await request(panel, { _tag: "read" })).records.find(
					(r) => r.id === id,
				)?.minutes,
				"Clear erased durable minutes",
			);
		}
		await request(panel, { _tag: "tab", tab: "main" });

		await click(management, 'input[value="executive"]');
		await wait(
			management,
			"document.querySelector('input[value=executive]').checked",
		);
		await management.webContents.executeJavaScript(
			"Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Regenerate with template').click();null;",
		);
		await wait(
			management,
			"document.querySelector('.meeting-generated')?.textContent.includes('Executive')",
		);
		const saved = (await request(management, { _tag: "read" })).records.find(
			(r) => r.id === id,
		);
		assert(
			saved &&
				saved.appliedTemplate._tag === "Some" &&
				saved.appliedTemplate.value === "executive",
		);
		let exportPath: string | undefined = join(scratch, "minutes.md");
		dialog.showSaveDialog = async () => ({
			canceled: !exportPath,
			filePath: exportPath ?? "",
		});
		await writeFile(join(scratch, "minutes.md"), "old public export");
		await chmod(join(scratch, "minutes.md"), 0o644);
		await click(management, ".meeting-document-actions button:nth-child(2)");
		await wait(management, "true");
		// Await the same IPC path to make file completion deterministic.
		await request(management, { _tag: "export", id, artifact: "summary" });
		assert.equal(
			await readFile(join(scratch, "minutes.md"), "utf8"),
			saved.minutes,
		);
		assert.equal((await stat(join(scratch, "minutes.md"))).mode & 0o777, 0o600);
		exportPath = join(scratch, "transcript.txt");
		await request(management, { _tag: "export", id, artifact: "transcript" });
		assert.equal(
			await readFile(exportPath, "utf8"),
			exportArtifact(saved, "transcript").text,
		);
		exportPath = undefined;
		await request(management, { _tag: "export", id, artifact: "summary" });
		exportPath = join(scratch, "missing-parent", "minutes.md");
		const failedExport = Schema.decodeUnknownSync(MeetingReply)(
			await management.webContents.executeJavaScript(
				`window.quakeMeetings.request(${JSON.stringify({ _tag: "export", id, artifact: "summary" })})`,
			),
		);
		assert(
			failedExport._tag === "failure" &&
				failedExport.code === "QUAKE.MEETING.EXPORT_FAILED",
		);
		await click(management, ".meeting-document-tabs [role=tab]:nth-child(2)");
		await capture(management, "meetings-history-transcript");
		// AI-299/304: actual CSS columns and reachable inspector/header at every width.
		for (const width of [1440, 980, 520]) {
			management.setContentSize(width, 1000);
			await management.webContents.executeJavaScript(
				"new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))",
			);
			const layout = await management.webContents.executeJavaScript(`(() => {
    const workspace=document.querySelector('.meeting-workspace'), inspector=document.querySelector('.meeting-inspector'), doc=document.querySelector('.meeting-document');
    const r=inspector.getBoundingClientRect(),d=doc.getBoundingClientRect();
    const controls=[...inspector.querySelectorAll('input,button:not(:disabled)'),...doc.querySelectorAll('header button:not(:disabled)')];
    const reach=controls.map(e=>{e.scrollIntoView({block:'center'});e.focus({preventScroll:true});const b=e.getBoundingClientRect();const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return document.activeElement===e && b.width>0 && b.height>0 && b.x>=0 && b.right<=innerWidth && (hit===e||e.contains(hit));});
    return { columns:getComputedStyle(workspace).gridTemplateColumns.split(' ').length, inspectorBelow:r.top>=d.bottom-1, reach, overflow:document.documentElement.scrollWidth>innerWidth };
   })()`);
			const parsed = Schema.decodeUnknownSync(
				Schema.Struct({
					columns: Schema.Number,
					inspectorBelow: Schema.Boolean,
					reach: Schema.Array(Schema.Boolean),
					overflow: Schema.Boolean,
				}),
			)(layout);
			assert.equal(
				parsed.columns,
				width === 1440 ? 3 : width === 980 ? 2 : 1,
				`history columns at ${width}`,
			);
			assert.equal(
				parsed.inspectorBelow,
				width !== 1440,
				`inspector position at ${width}`,
			);
			assert(
				parsed.reach.length >= 8 && parsed.reach.every(Boolean),
				`keyboard/pointer inspector/header reach at ${width}: ${JSON.stringify(parsed)}`,
			);
			assert.equal(parsed.overflow, false, `history overflow at ${width}`);
			await capture(management, `meetings-history-layout-${width}`);
		}
		management.setContentSize(520, 1000);
		await capture(management, "meetings-history-narrow");
		assert(
			await management.webContents.executeJavaScript(
				"document.documentElement.scrollWidth <= innerWidth",
			),
			"Narrow history overflow",
		);
		management.setContentSize(1440, 1000);
		nativeTheme.themeSource = "light";
		await management.webContents.executeJavaScript(
			`new BroadcastChannel(${JSON.stringify(APPEARANCE_STORAGE_KEY)}).postMessage(${JSON.stringify({ ...defaultAppearance, theme: "light", motion: "reduce" })}); null;`,
		);
		await wait(
			management,
			"document.documentElement.dataset.theme === 'light'",
		);
		await capture(management, "meetings-history-light");
		await management.webContents.executeJavaScript(
			"window.quakeLocale.set('de')",
		);
		await wait(management, "document.documentElement.lang === 'de'");
		await capture(management, "meetings-history-de");
		await capture(panel, "meetings-panel-de");
		await management.webContents.executeJavaScript(
			"window.quakeLocale.set('en')",
		);
		await wait(management, "document.documentElement.lang === 'en'");
		await capture(management, "meetings-history-en");
		await capture(panel, "meetings-panel-en");

		await capture(panel, "meetings-reduced-motion");
		await management.webContents.executeJavaScript(
			`new BroadcastChannel(${JSON.stringify(APPEARANCE_STORAGE_KEY)}).postMessage(${JSON.stringify({ ...defaultAppearance, theme: "dark", motion: "system" })}); null;`,
		);
		nativeTheme.themeSource = "dark";
		// Process an offline manual recording through the visible history action.
		const manualConfig = {
			...(await request(management, { _tag: "read" })).config,
			autoGenerate: false,
		};
		await request(management, { _tag: "configure", config: manualConfig });
		await new Promise((resolve) => setTimeout(resolve, 5100));
		await nativeKey("meetingMinutes");
		await wait(panel, "document.querySelector('[data-animation=recording]')");
		await new Promise((resolve) => setTimeout(resolve, 5100));
		await nativeKey("meetingMinutes");
		await click(management, ".meeting-record");
		await wait(
			management,
			"Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Generate minutes')",
		);
		const manualId = (await request(management, { _tag: "read" })).records[0]
			?.id;
		const count = submissions;
		await capture(management, "meetings-manual-processing");
		await management.webContents.executeJavaScript(
			"Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Generate minutes').click();null;",
		);
		await wait(
			management,
			"document.querySelector('.meeting-record[aria-current=true] [data-state=completed]')",
		);
		assert.equal(submissions, count + 1);
		assert.equal(
			(await request(management, { _tag: "read" })).records[0]?.id,
			manualId,
		);
		await request(management, {
			_tag: "configure",
			config: { ...manualConfig, autoGenerate: true },
		});
		// A new ASR failure must surface in both the panel and task inspector.
		await new Promise((resolve) => setTimeout(resolve, 5100));
		await nativeKey("meetingMinutes");
		await wait(panel, "document.querySelector('[data-animation=recording]')");
		await new Promise((resolve) => setTimeout(resolve, 5100));
		failAsr = true;
		await nativeKey("meetingMinutes");
		await wait(panel, "document.querySelector('[data-animation=failure]')");
		await capture(panel, "meetings-failure");
		await click(management, ".meeting-record");
		await capture(management, "meetings-task-failure");
		await panel.loadURL("data:text/html,<p>Untrusted smoke document</p>");
		const untrusted = Schema.decodeUnknownSync(MeetingReply)(
			await panel.webContents.executeJavaScript(
				"window.quakeMeetings.request({_tag:'action',action:'meetingMinutes'})",
			),
		);
		assert.equal(untrusted._tag, "failure");
		await management.loadURL("data:text/html,<p>Restarting mock runtime</p>");
		await meetings.dispose();
		meetings = registerMeetings({
			userData: directory,
			hardware: () => mockBus.hardware(),
			mock: true,
			renderer,
		});
		await management.loadURL(`${renderer}?page=meetings`);
		await wait(management, "!!document.querySelector('.meetings-page')");
		const reloaded = await request(management, { _tag: "read" });
		assert.equal(
			reloaded.records.find((r) => r.id === id)?.minutes,
			saved.minutes,
		);
		assert.equal(
			reloaded.records.find((r) => r.id === id)?.appliedTemplate._tag,
			"Some",
		);
		// Concurrent user IPC and the production source-loss service callback share state.
		const intentional = (
			await request(management, { _tag: "action", action: "meetingMinutes" })
		).records[0];
		assert(intentional);
		await Promise.all([
			request(management, { _tag: "cancel", id: intentional.id }),
			meetings.runtime.runPromise(MeetingService.sourceLost(intentional.id)),
		]);
		await meetings.runtime.runPromise(
			MeetingService.sourceLost(intentional.id),
		);
		const cancelledState = (
			await request(management, { _tag: "read" })
		).records.find((r) => r.id === intentional.id)?.state;
		assert.equal(cancelledState, "cancelled");
		await capture(management, "meetings-cancellation-ipc");
		await request(management, {
			_tag: "delete",
			id: intentional.id,
			confirmed: true,
		});
		await meetings.runtime.runPromise(
			MeetingService.sourceLost(intentional.id),
		);
		const deletionRetained = (
			await request(management, { _tag: "read" })
		).records.every((r) => r.id !== intentional.id);
		assert(deletionRetained);
		const durableIntent = Schema.decodeUnknownSync(MeetingStore)(
			JSON.parse(
				await readFile(join(directory, "meetings-v1/history.json"), "utf8"),
			),
		);
		assert(durableIntent.records.every((r) => r.id !== intentional.id));
		await writeFile(
			join(scratch, "cancellation-ipc.json"),
			JSON.stringify(
				{
					cancelledState,
					deletionRetained,
					durableDeletion: true,
					cancelledTouchStarts: 0,
				},
				null,
				2,
			),
		);
		// Exercise retry IPC with actual retained synthetic audio, FFmpeg and durable
		// history. No capture is started; only the recovery file path uses live I/O.
		await management.loadURL(
			"data:text/html,<p>Preparing synthetic recovery</p>",
		);
		await meetings.dispose();
		const root = join(directory, "meetings-v1");
		const storage = meetingStorage(root);
		const history = Schema.decodeUnknownSync(MeetingStore)(
			await Effect.runPromise(storage.load()),
		);
		const recoveryId = MeetingId.make(crypto.randomUUID());
		const recoveredFiles = audioFiles(root, "ffmpeg");
		await Effect.runPromise(
			recoveredFiles.write({
				id: recoveryId,
				segment: 0,
				track: "mic",
				bytes: new Uint8Array(await readFile(synthetic)),
			}),
		);
		await Effect.runPromise(
			storage.save(
				Schema.encodeSync(MeetingStore)({
					version: 1,
					records: [
						{
							...saved,
							id: recoveryId,
							title: "Synthetic interrupted recovery",
							startedAt: 100000,
							endedAt: Option.none(),
							parentId: Option.none(),
							state: "interrupted",
							audio: "interrupted",
							transcription: "pending",
							summary: "pending",
							transcript: [],
							minutes: "",
							marks: [],
						},
						...history.records,
					],
				}),
			),
		);
		let submittedDuration: number | undefined;
		let recoverySubmissions = 0;
		meetings = registerMeetings({
			userData: directory,
			hardware: () => undefined,
			mock: false,
			renderer,
			adapter: {
				...mockMeetingAdapter,
				submit: (request) => {
					recoverySubmissions++;
					submittedDuration = request.durationMs;
					return mockMeetingAdapter.submit(request);
				},
			},
		});
		await management.loadURL(`${renderer}?page=meetings`);
		await request(management, { _tag: "retry", id: recoveryId });
		await management.webContents.executeJavaScript(`new Promise((resolve,reject)=>{
			const deadline=Date.now()+12000;
			const check=async()=>{try {
				const reply=await window.quakeMeetings.request({_tag:'read'});
				if(reply._tag==='ready' && reply.snapshot.records.find(r=>r.id===${JSON.stringify(recoveryId)})?.state==='completed') return resolve(true);
				if(Date.now()>deadline) return reject(new Error('Synthetic recovery timeout'));
				setTimeout(check,20);
			} catch(error) {reject(error)}};check();})`);
		const measured = await Effect.runPromise(
			recoveredFiles.duration(recoveryId),
		);
		assert(
			!Number.isInteger(measured),
			"Synthetic sample must reproduce fractional milliseconds",
		);
		assert.equal(submittedDuration, Math.round(measured));
		assert.equal(recoverySubmissions, 1);
		const recovered = Schema.decodeUnknownSync(MeetingStore)(
			await Effect.runPromise(storage.load()),
		).records.find((record) => record.id === recoveryId);
		assert(recovered, "Recovered history record must exist");
		assert.equal(recovered.state, "completed");
		assert.deepEqual(
			recovered?.endedAt,
			Option.some(100000 + Math.round(measured)),
		);
		await writeFile(
			join(scratch, "fractional-recovery.json"),
			JSON.stringify(
				{
					measuredDurationMs: measured,
					submittedDurationMs: submittedDuration,
					recoverySubmissions,
					durableCompleted: recovered?.state === "completed",
					durableEndIsInteger:
						Option.isSome(recovered.endedAt) &&
						Number.isInteger(recovered.endedAt.value),
				},
				null,
				2,
			),
		);
		await capture(management, "meetings-fractional-recovery");
		assert.deepEqual(errors, []);
		process.stdout.write(
			"Meetings native smoke PASS: shipped MeetAI; five native touch action keys; cancelled touch rejection; cancellation/deletion with stale loss through concurrent IPC; manual processing; private outputs; fractional FFmpeg duration recovered through retry IPC and durable history; shared maintenance/voice/monitor owners; cooldown; marks/side; real touch toolbar; translation; processing/success/failure; saved regeneration/restart; UTF-8 exports/cancel/failure; untrusted IPC; narrow/light/reduced motion; actual 48kHz mono MP3 mix/concat.\n",
		);
	} catch (cause) {
		exitCode = 1;
		await reportSmokeFailure(cause, async () => {
			for (const [i, win] of BrowserWindow.getAllWindows().entries())
				if (!win.isDestroyed()) {
					await writeFile(
						join(scratch, `meetings-failed-${i}.png`),
						(await win.webContents.capturePage()).toPNG(),
					);
					await writeFile(
						join(scratch, `meetings-failed-${i}.txt`),
						await win.webContents.executeJavaScript("document.body.innerText"),
					);
				}
		});
	} finally {
		await locale?.dispose();
		await maintenance?.dispose();
		disposeAppearance();
		await agents?.dispose();
		for (const win of BrowserWindow.getAllWindows()) win.destroy();
		await meetings?.dispose();
		await voice?.dispose();
		await monitor?.dispose();
		await Effect.runPromise(Scope.close(hardwareScope, Exit.void));
		await hardwareRuntime.dispose();
		await disposeLifecycle();
		await profiles?.dispose();
		await media?.dispose();
		await knob?.dispose();
		unregisterHardware();
		for (const win of BrowserWindow.getAllWindows()) win.destroy();
		await rm(directory, { recursive: true, force: true });
		app.exit(exitCode);
	}
}
void smoke();
