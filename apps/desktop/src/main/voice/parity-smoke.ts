/** Mounted parity regressions. Hidden Electron window, fake capture/output only. */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	Deferred,
	Effect,
	Fiber,
	Layer,
	ManagedRuntime,
	Redacted,
	Schema,
} from "effect";
import { app, BrowserWindow, ipcMain } from "electron";
import { builtinProfiles } from "../../../../../packages/device/src/profiles/profile-catalog";
import { Profile } from "../../../../../packages/device/src/profiles/profile-contracts";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service";
import { AiCredentials } from "../../../../../packages/edge/src/ai/ai-credentials";
import {
	SpeechHttp,
	SpeechOutput,
} from "../../../../../packages/edge/src/ai/speech/speech-ports";
import { AiSpeechService } from "../../../../../packages/edge/src/ai/speech/speech-service";
import {
	ttsProfile,
	wav,
} from "../../../../../packages/edge/src/ai/speech/speech-test-fixtures";
import {
	SessionId,
	TurnId,
} from "../../../../../packages/edge/src/chat/chat-contracts";
import { meetingError } from "../../../../../packages/edge/src/meetings/meeting-errors";
import {
	defaultMeetingConfig,
	MeetingService,
} from "../../../../../packages/edge/src/meetings/meeting-service";
import { GridVoiceRuntime } from "../../../../../packages/edge/src/voice/surface";
import { KNOB_SNAPSHOT, KnobReply } from "../../shared/knob-contracts";
import type { EncodedProfileEnvelope } from "../../shared/profiles";
import {
	VOICE_REQUEST_CHANNEL,
	type VoiceSurfaceEvent,
} from "../../shared/voice-surface";
import { registerKnob } from "../knob";
import { MediaLive, registerMedia } from "../media";
import { mockMeetingAdapter, registerMeetings } from "../meetings";
import { ProfilesLive, registerProfiles } from "../profiles/profile-ipc";
import { registerAppLocale } from "../settings/registration";
import { createProductionVoiceRuntime } from "../speech/runtime";
import {
	copilotProfile,
	dkClawProfile,
	voiceFixtureEnvelope,
} from "../test/voice-fixtures";
import { createToneRecorder, registerVoiceSurface } from "./index";
import { waitForVoice } from "./smoke-wait";

app.on("window-all-closed", () => {});

async function smoke(): Promise<void> {
	assert.equal(process.env.OPEN_QUAKE_MOCK_DEVICE, "1");
	assert(process.argv[2], "Pass the lane scratch directory");
	const scratch = resolve(process.argv[2]);
	await mkdir(scratch, { recursive: true });
	const directory = await mkdtemp(join(scratch, "native-parity-"));
	app.setPath("userData", directory);
	await app.whenReady();
	const renderer = pathToFileURL(resolve("out/renderer/index.html")).href;
	const serial = "parity-fake";
	const panel = new BrowserWindow({
		show: false,
		useContentSize: true,
		width: 1920,
		height: 480,
		webPreferences: {
			backgroundThrottling: false,
			preload: resolve("out/preload/index.mjs"),
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	const js = <T>(source: string): Promise<T> =>
		panel.webContents.executeJavaScript(source);
	const settle = () =>
		js(
			"new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
		);
	const capture = async (name: string) => {
		await settle();
		await writeFile(
			join(scratch, `${name}.png`),
			(await panel.webContents.capturePage()).toPNG(),
		);
	};
	const locale = registerAppLocale({
		directory,
		osLocale: "en",
		renderer,
		windows: () => [panel],
	});
	panel.webContents.setAudioMuted(true);
	const knob = registerKnob(
		() => panel,
		() => [panel],
	);
	const media = registerMedia(
		ManagedRuntime.make(MediaLive(join(directory, "wallpaper"))),
		() => undefined,
		renderer,
	);
	const profileRuntime = ManagedRuntime.make(
		ProfilesLive({
			read: async () => voiceFixtureEnvelope(dkClawProfile),
			write: async () => undefined,
		}),
	);
	let profiles = registerProfiles(profileRuntime, renderer);
	let controller:
		| Effect.Effect.Success<ReturnType<typeof createProductionVoiceRuntime>>
		| undefined;
	let requests = 0,
		stops = 0;
	let releaseAudio = () => {};
	let releaseFocus = () => {};
	const events: VoiceSurfaceEvent[] = [];
	const originalHandle = ipcMain.handle;
	// Intercept only native focus. This test must never activate a visible app.
	ipcMain.handle = (channel, listener) =>
		originalHandle.call(ipcMain, channel, (event, ...args: unknown[]) => {
			const raw = args[0];
			if (
				channel === VOICE_REQUEST_CHANNEL &&
				typeof raw === "object" &&
				raw !== null &&
				"_tag" in raw &&
				raw._tag === "FocusPanel"
			)
				return new Promise((resolve) => {
					releaseFocus = () => resolve({ _tag: "ok" });
				});
			return listener(event, ...args);
		});
	const voice = (() => {
		try {
			return registerVoiceSurface({
				mock: true,
				tones: createToneRecorder(),
				serial: () => serial,
				panel: () => panel,
				management: () => undefined,
				renderer,
				speech: {
					toggleReader: async (owner, settings) => {
						assert(controller);
						await Effect.runPromise(controller.toggleReader(owner, settings));
					},
					stopReadAloud: async (owner) => {
						assert(controller);
						return Effect.runPromise(controller.stopReadAloud(owner));
					},
					readAloud: async (text, owner) => {
						assert(controller);
						const outcome = await Effect.runPromise(
							controller.readAloud(text, owner),
						);
						return outcome._tag === "completed"
							? { _tag: "ok" }
							: { _tag: "rejected", code: "VOICE.TTS.CANCELLED" };
					},
					onEvent: (event) => {
						events.push(event);
						if (controller) void Effect.runPromise(controller.observe(event));
					},
				},
				runtime: () =>
					Layer.scoped(
						GridVoiceRuntime,
						Effect.gen(function* () {
							controller = yield* createProductionVoiceRuntime({
								speech: yield* AiSpeechService,
								capture: {
									permission: Effect.die("Real microphone forbidden"),
									open: () => Effect.die("Real microphone forbidden"),
								},
								profiles: () =>
									Effect.succeed({ tts: ttsProfile, speakAnswers: false }),
								sendText: () => Effect.void,
								sendTranscript: () => Effect.void,
							});
							return controller.runtime;
						}),
					).pipe(
						Layer.provide(
							AiSpeechService.Default.pipe(
								Layer.provide(
									Layer.mergeAll(
										Layer.succeed(AiCredentials, {
											resolve: () => Effect.succeed(Redacted.make("fake")),
											revoked: () => Effect.never,
										}),
										Layer.succeed(SpeechHttp, {
											fetch: async () => {
												requests++;
												await new Promise<void>((resolve) => {
													releaseAudio = resolve;
												});
												return new Response(wav(), {
													headers: { "Content-Type": "audio/wav" },
												});
											},
										}),
										Layer.succeed(SpeechOutput, {
											suspendForCapture: Effect.void,
											acquire: Effect.succeed({
												ready: Effect.void,
												play: () => Effect.never,
												stop: Effect.sync(() => {
													stops++;
												}),
											}),
										}),
									),
								),
							),
						),
					),
			});
		} finally {
			ipcMain.handle = originalHandle;
		}
	})();
	let meetings: ReturnType<typeof registerMeetings> | undefined;
	try {
		await voice.ready;
		await locale.locale();
		await panel.loadFile(resolve("out/renderer/index.html"), {
			query: { surface: "panel" },
		});
		await waitForVoice(panel, "!!document.querySelector('.clawbot-input-box')");
		// Deterministic renderer timers prove 99/100 ms and cleanup with the real hook mounted.
		await js(`(() => {
 const timers = new Map(); let now = 0, next = 900000, focuses = 0;
 const timeout = window.setTimeout, clear = window.clearTimeout;
 window.setTimeout = (fn, ms, ...args) => { if (ms !== 100) return timeout(fn, ms, ...args); const id = ++next; timers.set(id, { at: now + ms, fn: () => fn(...args) }); return id; };
 window.clearTimeout = id => { timers.delete(id); clear(id); };
 const box = document.querySelector('.clawbot-input-box'); box.focus = () => { focuses++; };
 window.parityFocus = { blur: () => box.dispatchEvent(new FocusEvent('focusout', { bubbles: true })),
 advance: ms => { now += ms; for (const [id, t] of timers) if (t.at <= now) { timers.delete(id); t.fn(); } },
 count: () => focuses, pending: () => timers.size,
 restore: () => { window.setTimeout = timeout; window.clearTimeout = clear; delete box.focus; } };
 })()`);
		await js("parityFocus.blur(); parityFocus.advance(99)");
		assert.equal(await js("parityFocus.count()"), 0);
		await js("parityFocus.advance(1)");
		assert.equal(await js("parityFocus.count()"), 1);
		await js(
			"parityFocus.blur(); window.quakeVoice.request({ _tag: 'Reset', reason: 'profileChanged' })",
		);
		await settle();
		assert.equal(
			await js("parityFocus.pending()"),
			0,
			"reset cancels even without a selected assistant",
		);
		await js("parityFocus.advance(100)");
		assert.equal(await js("parityFocus.count()"), 1);
		const select = async (keyCode: string) => {
			await js(
				`window.quakeVoice.request({ _tag: 'Input', input: { kind: 'down', keyCode: ${JSON.stringify(keyCode)}, type: 'clawbot', voiceInput: false, agentId: 'weather' } })`,
			);
			await settle();
		};
		const knobReply = Schema.decodeUnknownSync(KnobReply)(
			await js("window.quakeKnob.request({ _tag: 'Read' })"),
		);
		assert.equal(knobReply._tag, "success");
		if (knobReply._tag !== "success") throw new Error("No knob snapshot");
		await js("parityFocus.blur()");
		panel.webContents.send(KNOB_SNAPSHOT, {
			...knobReply.snapshot,
			revision: knobReply.snapshot.revision + 100,
			selector: {
				...knobReply.snapshot.selector,
				mode: "ring",
				ringVisible: true,
			},
		});
		await waitForVoice(
			panel,
			"document.querySelector('.clawbot')?.dataset.wheel === 'true'",
		);
		assert.equal(
			await js("parityFocus.pending()"),
			0,
			"FunctionWheel cancels blur recovery",
		);
		panel.webContents.send(KNOB_SNAPSHOT, {
			...knobReply.snapshot,
			revision: knobReply.snapshot.revision + 101,
		});
		await waitForVoice(
			panel,
			"!document.querySelector('.clawbot')?.dataset.wheel",
		);
		await select("1,5");
		await js("parityFocus.blur()");
		await select("1,6");
		assert.equal(
			await js("parityFocus.pending()"),
			0,
			"assistant ownership cancels blur recovery",
		);
		await js(
			`document.querySelector('.clawbot-input-box').dispatchEvent(new CustomEvent('quake-sub-touch-start', { detail: { phase: 'start', y: 0, startY: 0 } })); document.querySelector('.clawbot-input-box').dispatchEvent(new CustomEvent('quake-sub-touch-end', { detail: { phase: 'end', y: 0, startY: 0, confirmedTap: true } }))`,
		);
		await settle();
		await select("1,5");
		releaseFocus();
		await settle();
		assert.equal(
			await js("parityFocus.count()"),
			1,
			"late native focus reply cannot focus a successor owner",
		);
		await js("parityFocus.blur()");
		await voice.publish({
			_tag: "Stage",
			serial,
			keyCode: "0,1",
			captureId: "overlay",
			stage: { _tag: "recording", status: "listening" },
		});
		await settle();
		assert.equal(
			await js("parityFocus.pending()"),
			0,
			"overlay takes focus ownership",
		);
		await voice.publish({
			_tag: "Level",
			serial,
			keyCode: "0,1",
			captureId: "overlay",
			rms: 0.7,
			speaking: true,
		});
		await waitForVoice(panel, "!!document.querySelector('.voice-bar')");
		await capture("parity-meter-speaking");
		await voice.publish({ _tag: "Reset", serial, reason: "profileChanged" });
		await settle();

		await select("1,5");
		const sessionId = SessionId.make("00000000-0000-4000-8000-0000000000a1");
		const turnId = TurnId.make("00000000-0000-4000-8000-0000000000a2");
		await voice.publish({
			_tag: "TurnStarted",
			serial,
			keyCode: "1,5",
			sessionId,
			turnId,
			prompt: "Read this answer",
			source: "typed",
		});
		await voice.publish({
			_tag: "Chunk",
			serial,
			keyCode: "1,5",
			chunk: {
				type: "answer",
				version: 1,
				sessionId,
				turnId,
				seq: 1,
				textDelta: "A synthetic answer. No audio will play.",
			},
		});
		await capture("parity-pill-idle");
		// A confirmed sub-touch is one toggle, without a duplicate synthesized click.
		const tap = () =>
			js(
				"document.querySelector('.clawbot-pill').dispatchEvent(new CustomEvent('quake-sub-touch-start', { detail: { phase: 'start', y: 0, startY: 0 } })); document.querySelector('.clawbot-pill').dispatchEvent(new CustomEvent('quake-sub-touch-end', { detail: { phase: 'end', y: 0, startY: 0, confirmedTap: true } }))",
			);
		await tap();
		await waitForVoice(
			panel,
			"document.querySelector('.clawbot-pill')?.dataset.readAloud === 'thinking'",
		);
		assert.equal(requests, 1);
		assert.equal(
			await js("document.querySelectorAll('.clawbot-think-dot').length"),
			3,
		);
		await capture("parity-pill-thinking");
		releaseAudio();
		await waitForVoice(
			panel,
			"document.querySelector('.clawbot-pill')?.dataset.readAloud === 'speaking'",
		);
		assert.equal(
			await js("document.querySelectorAll('.clawbot-wave-bar').length"),
			7,
		);
		await capture("parity-pill-speaking");
		const old = events.find(
			(e) => e._tag === "ReadAloudState" && e.phase === "thinking",
		);
		await tap();
		await waitForVoice(
			panel,
			"document.querySelector('.clawbot-pill')?.dataset.readAloud === 'idle'",
		);
		assert.equal(requests, 1, "second tap stops without synthesizing again");
		assert.equal(stops, 1);
		await tap();
		await waitForVoice(
			panel,
			"document.querySelector('.clawbot-pill')?.dataset.readAloud === 'thinking'",
		);
		if (old?._tag !== "ReadAloudState")
			throw new Error("missing read-aloud session");
		await voice.publish({ ...old, phase: "idle" });
		await settle();
		assert.equal(
			await js("document.querySelector('.clawbot-pill').dataset.readAloud"),
			"thinking",
			"stale session cannot clear current pill",
		);
		await js(
			"window.quakeVoice.request({ _tag: 'Reset', reason: 'profileChanged' })",
		);
		releaseAudio();
		await waitForVoice(
			panel,
			"document.querySelector('.clawbot-pill')?.dataset.readAloud === 'idle'",
		);
		await js("parityFocus.blur()");
		await profileRuntime.runPromise(
			ProfileService.selectProfile({
				deviceId: "desktop-preview",
				profileId: "fixture-copilot",
				pageId: "copilot-1",
			}),
		);
		await waitForVoice(panel, "!document.querySelector('.clawbot-input-box')");
		assert.equal(
			await js("parityFocus.pending()"),
			0,
			"closing the chat surface unmounts and cancels recovery",
		);
		await js("parityFocus.advance(100); parityFocus.restore()");
		await profiles.dispose();
		// Voice-runtime: real renderer -> preload -> IPC -> owned queue, fake synthesis/output.
		const readerProfile = Schema.encodeSync(Profile)(
			Schema.decodeUnknownSync(Profile)({
				...copilotProfile,
				pages: copilotProfile.pages.map((page) => ({
					...page,
					keys: page.keys.map((key) =>
						key.keyCode !== "2,8"
							? key
							: {
									...key,
									childrenName: "audioBot",
									config: {
										...key.config,
										type: "audioBot",
										title: { ...key.config.title, text: "Voice Bot" },
										actions: [{ type: "ttsEngine", value: "qwen" }],
									},
								},
					),
				})),
			}),
		);
		profiles = registerProfiles(
			ManagedRuntime.make(
				ProfilesLive({
					read: async () => ({
						schemaVersion: 1,
						profiles: [readerProfile],
						activeByDevice: {},
					}),
					write: async () => undefined,
				}),
			),
			renderer,
		);
		await panel.loadFile(resolve("out/renderer/index.html"), {
			query: { surface: "panel" },
		});
		await waitForVoice(panel, "!!document.querySelector('.audio-bot-key')");
		const toggleReader = () =>
			js(
				"document.querySelector('.audio-bot-key').dispatchEvent(new CustomEvent('quake-sub-touch-start', { detail: { phase: 'start', y: 0, startY: 0 } })); document.querySelector('.audio-bot-key').dispatchEvent(new CustomEvent('quake-sub-touch-end', { detail: { phase: 'end', y: 0, startY: 0, confirmedTap: true } }))",
			);
		assert.equal(
			await js(
				"getComputedStyle(document.querySelector('.audio-bot-key .strip-tile-icon')).visibility",
			),
			"visible",
		);
		await capture("runtime-reader-idle");
		await toggleReader();
		await waitForVoice(
			panel,
			"document.querySelector('.audio-bot-key')?.dataset.phase === 'thinking'",
		);
		await capture("runtime-reader-thinking");
		await voice.publish({
			_tag: "TurnStarted",
			serial,
			keyCode: "1,6",
			sessionId,
			turnId,
			prompt: "Synthetic reader",
			source: "typed",
		});
		await voice.publish({
			_tag: "Chunk",
			serial,
			keyCode: "1,6",
			chunk: {
				type: "answer",
				version: 1,
				sessionId,
				turnId,
				seq: 1,
				textDelta: "Synthetic queue segment.",
			},
		});
		await waitForVoice(
			panel,
			"document.querySelector('.audio-bot-key')?.dataset.phase === 'thinking'",
		);
		for (let attempt = 0; requests < 3 && attempt < 500; attempt++)
			await new Promise((resolve) => setTimeout(resolve, 10));
		assert.equal(requests, 3, "reader starts exactly one synthetic segment");
		releaseAudio();
		await waitForVoice(
			panel,
			"document.querySelector('.audio-bot-key')?.dataset.phase === 'speaking'",
		);
		assert.equal(
			await js("document.querySelectorAll('.audio-bot-state i').length"),
			7,
		);
		assert.equal(
			await js(
				"getComputedStyle(document.querySelector('.audio-bot-key .strip-tile-icon')).visibility",
			),
			"hidden",
		);
		await capture("runtime-reader-speaking");
		await toggleReader();
		await waitForVoice(
			panel,
			"document.querySelector('.audio-bot-key')?.dataset.phase === 'idle'",
		);
		await voice.publish({ _tag: "Reset", serial, reason: "profileChanged" });
		for (const language of ["en", "de"] as const) {
			await js(`window.quakeLocale.set('${language}')`);
			await waitForVoice(
				panel,
				`document.documentElement.lang === '${language}'`,
			);
			await voice.publish({
				_tag: "Stage",
				serial,
				keyCode: "0,1",
				captureId: `runtime-${language}`,
				stage: { _tag: "recording", status: "listening" },
			});
			await voice.publish({
				_tag: "Level",
				serial,
				keyCode: "0,1",
				captureId: `runtime-${language}`,
				rms: 0.75,
				speaking: true,
			});
			await capture(`runtime-${language}-knob`);
			await voice.publish({ _tag: "Reset", serial, reason: "profileChanged" });
			await voice.publish({
				_tag: "Stage",
				serial,
				keyCode: "1,6",
				captureId: `grid-${language}`,
				stage: {
					_tag: "recording",
					status: "speaking",
					transcript:
						language === "de"
							? "Eine synthetische Aufnahme"
							: "A synthetic capture",
				},
			});
			await voice.publish({
				_tag: "Level",
				serial,
				keyCode: "1,6",
				captureId: `grid-${language}`,
				rms: 0.8,
				speaking: true,
			});
			await capture(`runtime-${language}-grid-energy`);
			await voice.publish({
				_tag: "Toast",
				serial,
				messageKey: "meetingAssistantPrompt.meetingActive",
			});
			await waitForVoice(panel, "!!document.querySelector('.voice-toast')");
			assert.equal(
				await js(
					"getComputedStyle(document.querySelector('.voice-toast')).fontSize",
				),
				"24px",
			);
			assert.equal(
				await js(
					"getComputedStyle(document.querySelector('.voice-toast-icon')).width",
				),
				"28px",
			);
			await new Promise((resolve) => setTimeout(resolve, 200));
			await capture(`runtime-${language}-warning`);
			await voice.publish({
				_tag: "Toast",
				serial,
				messageKey: "unknown.runtime",
				fallback:
					language === "de"
						? "Diese lange synthetische Fehlermeldung prüft den Umbruch auf dem Gerät. Kein Mikrofon und keine Lautsprecher wurden verwendet."
						: "This long synthetic error checks wrapping on the device. No microphone or speakers were used.",
				type: "error",
			});
			await new Promise((resolve) => setTimeout(resolve, 200));
			await capture(`runtime-${language}-error`);
			await voice.publish({ _tag: "Reset", serial, reason: "profileChanged" });
		}
		await js("window.quakeLocale.set('en')");
		await profiles.dispose();
		const meetingProfile = builtinProfiles("darwin").find(
			(p) => p.id === "1-1",
		);
		assert(meetingProfile);
		const encoded = Schema.encodeSync(Profile)(meetingProfile);
		const page = encoded.pages[0];
		assert(page);
		const envelope: EncodedProfileEnvelope = {
			schemaVersion: 1,
			profiles: [encoded],
			activeByDevice: {
				"desktop-preview": { profileId: encoded.id, pageId: page.id },
			},
		};
		profiles = registerProfiles(
			ManagedRuntime.make(
				ProfilesLive({
					read: async () => structuredClone(envelope),
					write: async () => undefined,
				}),
			),
			renderer,
		);
		const transitions: [number, number][] = [];
		let inspectStages = false;
		let failAsr = false;
		let submitGate: Deferred.Deferred<void> | undefined;
		meetings = registerMeetings({
			mock: true,
			userData: directory,
			renderer,
			hardware: () => undefined,
			serial: () => serial,
			adapter: {
				...mockMeetingAdapter,
				poll: (task) =>
					failAsr
						? Effect.fail(meetingError("TranscriptionFailed"))
						: mockMeetingAdapter.poll(task),
				submit: (request) =>
					Effect.suspend(() =>
						submitGate
							? Deferred.await(submitGate).pipe(
									Effect.zipRight(mockMeetingAdapter.submit(request)),
								)
							: mockMeetingAdapter.submit(request),
					),
			},
			publishVoice: async (event) => {
				await voice.publish(event);
				if (event._tag !== "MeetingStage") return;
				transitions.push([event.stage, event.status]);
				// The initial recording event precedes the first snapshot publication.
				if (inspectStages && event.stage !== 0) {
					await waitForVoice(
						panel,
						`document.querySelector('.meeting-display')?.dataset.meetingStage === '${event.stage}' && document.querySelector('.meeting-display')?.dataset.meetingStatus === '${event.status}'`,
					);
					if (event.status === 1 || event.stage === 5)
						await capture(`parity-meeting-${event.stage}-${event.status}`);
				}
			},
		});
		await meetings.ready;
		await meetings.runtime.runPromise(
			MeetingService.configure(
				{ ...defaultMeetingConfig, autoGenerate: false },
				true,
			),
		);
		await panel.loadFile(resolve("out/renderer/index.html"), {
			query: { surface: "panel" },
		});
		await waitForVoice(panel, "!!document.querySelector('.meeting-display')");
		const started = await meetings.runtime.runPromise(
			MeetingService.action("meetingMinutes", { serial, keyCode: "1,6" }),
		);
		const record = started.records[0];
		assert(record);
		await waitForVoice(
			panel,
			"document.querySelector('.meeting-display')?.dataset.meetingStage === '0'",
		);
		await capture("parity-meeting-0-1");
		await new Promise((resolve) => setTimeout(resolve, 5000));
		inspectStages = true;
		await meetings.runtime.runPromise(MeetingService.action("meetingMinutes"));
		await meetings.runtime.runPromise(MeetingService.process(record.id));
		assert.deepEqual(
			transitions,
			Array.from({ length: 6 }, (_, stage) => [
				[stage, 1],
				[stage, 2],
			]).flat(),
		);
		await waitForVoice(panel, "!!document.querySelector('.meeting-safe-text')");
		await capture("parity-meeting-minutes");
		const current = await js(
			"document.querySelector('.meeting-display').dataset.meetingId",
		);
		await voice.publish({
			_tag: "MeetingStage",
			serial,
			keyCode: "1,6",
			meetingId: "00000000-0000-4000-8000-000000000099",
			stage: 2,
			status: 1,
		});
		await settle();
		assert.equal(
			await js("document.querySelector('.meeting-display').dataset.meetingId"),
			current,
			"other meeting IDs cannot replace displayed record",
		);
		await new Promise((resolve) => setTimeout(resolve, 5000));
		inspectStages = false;
		const second = await meetings.runtime.runPromise(
			MeetingService.action("meetingMinutes", { serial, keyCode: "1,6" }),
		);
		const cancelled = second.records[0];
		assert(cancelled);
		await new Promise((resolve) => setTimeout(resolve, 5000));
		await meetings.runtime.runPromise(MeetingService.action("meetingMinutes"));
		failAsr = true;
		await meetings.runtime.runPromise(
			MeetingService.process(cancelled.id).pipe(Effect.either),
		);
		await waitForVoice(
			panel,
			"document.querySelector('.meeting-animation')?.dataset.animation === 'failure'",
		);
		await capture("parity-meeting-failed");
		failAsr = false;
		submitGate = await Effect.runPromise(Deferred.make<void>());
		const work = meetings.runtime.runFork(MeetingService.process(cancelled.id));
		await waitForVoice(
			panel,
			"document.querySelector('.meeting-display')?.dataset.meetingStage === '2'",
		);
		await meetings.runtime.runPromise(MeetingService.cancel(cancelled.id));
		await waitForVoice(
			panel,
			"document.querySelector('.meeting-display')?.dataset.meetingStatus === '0'",
		);
		await capture("parity-meeting-cancelled");
		await Effect.runPromise(Deferred.succeed(submitGate, undefined));
		await Effect.runPromise(Fiber.await(work));
		await voice.publish({
			_tag: "MeetingStage",
			serial,
			keyCode: "1,6",
			meetingId: cancelled.id,
			stage: 2,
			status: 2,
		});
		await settle();
		assert.equal(
			await js(
				"document.querySelector('.meeting-display').dataset.meetingStatus",
			),
			"0",
			"late completion cannot revive cancellation",
		);
		await voice.publish({ _tag: "Reset", serial, reason: "profileChanged" });
		await settle();
		await voice.publish({
			_tag: "MeetingStage",
			serial,
			keyCode: "1,6",
			meetingId: cancelled.id,
			stage: 3,
			status: 1,
		});
		await settle();
		assert.equal(
			await js(
				"document.querySelector('.meeting-display').dataset.meetingStage",
			),
			undefined,
			"reset rejects late stages for an old meeting",
		);
		await capture("parity-meeting-reset");
		await writeFile(
			join(scratch, "parity-evidence.json"),
			JSON.stringify(
				{
					transitions,
					requests,
					stops,
					hidden: !panel.isVisible(),
					events: events.filter(
						(e) => e._tag === "ReadAloudState" || e._tag === "MeetingStage",
					),
				},
				null,
				2,
			),
		);
		process.stdout.write(
			"Voice parity native smoke PASS: AudioBot queue and EN/DE voice-runtime captures; 99/100 ms blur; reset, assistant, overlay and delayed-focus ownership cancellation; meter; idle/thinking/speaking pill, second-tap stop, stale TTS session; 12 real meeting transitions, minutes reveal, stale IDs, cancellation and reset. Fake devices/capture/output only.\n",
		);
	} catch (cause) {
		process.stderr.write(`${String(cause)}\n`);
		await capture("parity-failed");
		await writeFile(
			join(scratch, "parity-failed.txt"),
			await js<string>("document.body.innerText"),
		);
		throw cause;
	} finally {
		releaseFocus();
		releaseAudio();
		await meetings?.dispose();
		await voice.dispose();
		await profiles.dispose();
		await media.dispose();
		await knob.dispose();
		await locale.dispose();
		panel.destroy();
		await rm(directory, { recursive: true, force: true });
	}
}
smoke()
	.then(() => app.exit(0))
	.catch((cause) => {
		process.stderr.write(
			`${String(cause)}\n${cause instanceof Error ? cause.stack : ""}\n`,
		);
		app.exit(1);
	});
