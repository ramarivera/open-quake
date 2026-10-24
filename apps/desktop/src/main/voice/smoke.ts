/** Run with Electron, not Node. The panel stays hidden; no HID is opened. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, ManagedRuntime, Schema } from "effect";
import { app, BrowserWindow } from "electron";
import {
	SessionId,
	TurnId,
} from "../../../../../packages/edge/src/chat/chat-contracts.js";
import type { EncodedProfileEnvelope } from "../../shared/profiles";
import type { VoiceStage, VoiceSurfaceEvent } from "../../shared/voice-surface";
import { registerKnob } from "../knob";
import { MediaLive, registerMedia } from "../media";
import { ProfilesLive, registerProfiles } from "../profiles/profile-ipc";
import {
	copilotProfile,
	dkClawProfile,
	voiceFixtureEnvelope,
} from "../test/voice-fixtures";
import { createToneRecorder, registerVoiceSurface } from "./index";
import { reviewSmoke } from "./review-smoke";
import { waitForVoice } from "./smoke-wait";

/**
 * strip-voice-ui native smoke: the built renderer and preload in a hidden
 * 1920×480 panel, the real voice IPC and the scripted mock runtime, with
 * mock mic levels. Captures each overlay stage and the chat tiles.
 */
const artifacts = process.argv[2];
// User data stays out of the screenshot directory (Electron writes it until quit).
const directory = mkdtempSync(join(tmpdir(), "open-quake-voice-smoke-"));
app.setPath("userData", directory);
const renderer = pathToFileURL(resolve("out/renderer/index.html")).href;
const SERIAL = "smoke-QK";
const settle = (ms = 300): Promise<void> =>
	new Promise<void>((done) => setTimeout(done, ms));

function serveProfiles(envelope: EncodedProfileEnvelope) {
	return registerProfiles(
		ManagedRuntime.make(
			ProfilesLive({
				read: async () => structuredClone(envelope),
				write: async () => undefined,
			}),
		),
		renderer,
	);
}

const sessionId = Schema.decodeUnknownSync(SessionId)(
	"00000000-0000-4000-8000-0000000000a1",
);
const turnId = Schema.decodeUnknownSync(TurnId)(
	"00000000-0000-4000-8000-0000000000a2",
);

async function smoke(): Promise<void> {
	await app.whenReady();
	if (artifacts) await mkdir(artifacts, { recursive: true });
	const tones = createToneRecorder();
	const panel = new BrowserWindow({
		show: false,
		useContentSize: true,
		width: 1920,
		height: 480,
		webPreferences: {
			preload: resolve("out/preload/index.mjs"),
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});
	const knobRegistration = registerKnob(
		() => panel,
		() => [panel],
	);
	const media = registerMedia(
		ManagedRuntime.make(MediaLive(join(directory, "wallpaper-v1"))),
		() => undefined,
		renderer,
	);
	let profiles = serveProfiles(voiceFixtureEnvelope(copilotProfile, SERIAL));
	const voice = registerVoiceSurface({
		mock: true,
		tones,
		serial: () => SERIAL,
		panel: () => panel,
		management: () => undefined,
		renderer,
	});
	const js = <T>(source: string): Promise<T> =>
		panel.webContents.executeJavaScript(source);
	const capture = async (name: string): Promise<void> => {
		if (!artifacts) return;
		let image = await panel.webContents.capturePage();
		const { width } = image.getSize();
		if (width !== 1920) image = image.resize({ width: 1920, height: 480 });
		await writeFile(join(artifacts, `${name}.png`), image.toPNG());
	};
	const load = async (): Promise<void> => {
		await panel.loadFile(resolve("out/renderer/index.html"), {
			query: { surface: "panel" },
		});
		await waitForVoice(
			panel,
			`!!document.querySelector('.strip-screen[data-profiles="ready"]')`,
		);
		await settle(100);
	};
	const publish = (event: VoiceSurfaceEvent): Promise<void> =>
		voice.publish(event);
	const knob = (stage: VoiceStage, captureId: string): Promise<void> =>
		publish({
			_tag: "Stage",
			serial: SERIAL,
			keyCode: "0,1",
			captureId,
			stage,
		});
	const levels = async (keyCode: string, captureId: string, count: number) => {
		for (let step = 0; step < count; step++) {
			const t = step * 0.05;
			const rms = Math.min(
				1,
				0.25 + 0.5 * Math.abs(Math.sin(t * Math.PI * 1.8)),
			);
			await publish({
				_tag: "Level",
				serial: SERIAL,
				keyCode,
				captureId,
				rms,
				speaking: true,
			});
			await settle(50);
		}
	};
	const text = (selector: string) =>
		js<string | null>(
			`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`,
		);
	const request = (value: object) =>
		js<unknown>(`window.quakeVoice.request(${JSON.stringify(value)})`);
	const input = (keyCode: string, kind: string, type = "aiChat") =>
		request({ _tag: "Input", input: { keyCode, kind, type } });

	await load();
	// AI Copilot idle: the push-to-talk hint.
	assert.equal(
		(await text(".copilot-label"))?.trim(),
		"AI Copilot Chat",
		"AI Copilot view renders",
	);
	assert.match((await text(".copilot-hint")) ?? "", /Push-To-Talk/);
	await capture("voice-copilot-idle");

	// Knob voice overlay, stage by stage.
	await knob({ _tag: "recording", status: "preparing" }, "knob-1");
	await settle();
	assert.equal(await text(".voice-subtitle"), "Preparing to record…");
	assert.equal(
		await js<boolean>("!!document.querySelector('.voice-bar')"),
		true,
	);
	await capture("voice-knob-preparing");
	await knob({ _tag: "recording", status: "listening" }, "knob-1");
	await levels("0,1", "knob-1", 12);
	assert.equal(await text(".voice-subtitle"), "You can speak now");
	await capture("voice-knob-listening");
	await knob(
		{
			_tag: "recording",
			status: "speaking",
			transcript: "What's the weather like in Lisbon today?",
		},
		"knob-1",
	);
	await levels("0,1", "knob-1", 10);
	assert.equal(
		await text(".voice-subtitle"),
		"What's the weather like in Lisbon today?",
	);
	await capture("voice-knob-speaking");
	await knob(
		{
			_tag: "recording",
			status: "speaking",
			transcript:
				"Remind me to call the venue about the projector, then draft a short note to the team saying the offsite moved to Thursday afternoon and lunch is on us",
		},
		"knob-1",
	);
	await settle(1500);
	assert.equal(
		await js<string | null>(
			"document.querySelector('.voice-subtitle')?.dataset.scrolling ?? null",
		),
		"true",
		"long subtitles scroll",
	);
	await capture("voice-knob-marquee");
	await knob(
		{
			_tag: "processing",
			transcript: "What's the weather like in Lisbon today?",
		},
		"knob-1",
	);
	await settle();
	assert.equal(
		await js<boolean>("!!document.querySelector('.voice-bar')"),
		false,
	);
	await capture("voice-knob-processing");
	// Observe all countdown renders independently of screenshot capture latency.
	await js(`(() => {
		const seen = [];
		const observer = new MutationObserver(() => {
			const line = document.querySelector('.voice-subtitle')?.textContent;
			if (line?.match(/\\([123]S\\)$/) && seen.at(-1) !== line) seen.push(line);
		});
		observer.observe(document.querySelector('.voice-layer'), { childList: true, characterData: true, subtree: true });
		window.__voiceCountdown = { seen, observer };
	})()`);
	await knob({ _tag: "failed", reason: "server" }, "knob-1");
	await settle(200);
	await capture("voice-knob-error-countdown");
	await settle(3100);
	assert.deepEqual(
		await js<string[]>(
			"window.__voiceCountdown.observer.disconnect(); window.__voiceCountdown.seen",
		),
		[
			"Processing error, please retry (3S)",
			"Processing error, please retry (2S)",
			"Processing error, please retry (1S)",
		],
	);
	assert.equal(
		await js<boolean>("!!document.querySelector('.voice-backdrop')"),
		false,
		"overlay closes after the countdown",
	);
	await knob({ _tag: "busy" }, "knob-2");
	await settle();
	assert.equal(
		await text(".voice-subtitle"),
		"System busy, please try again later",
	);
	await capture("voice-knob-busy");
	await knob({ _tag: "idle", outcome: "completed" }, "knob-2");
	await settle();

	// Grid hold-to-talk through the real IPC, GridVoice and the mock runtime.
	await input("1,6", "down");
	await waitForVoice(
		panel,
		`document.querySelector('.copilot-status')?.textContent === 'Start Recording'`,
	);
	assert.equal(await text(".copilot-status"), "Start Recording");
	assert.match((await text(".voice-bar-row")) ?? "", /speak now|What's/);
	await capture("voice-grid-hold");
	// A rejected knob hold expires while the unrelated grid capture continues.
	await Effect.runPromise(
		voice.knobVoice({ action: "holdStart", generation: 1 }),
	);
	await settle(200);
	assert.equal(
		await text(".voice-subtitle"),
		"System busy, please try again later",
	);
	await Effect.runPromise(
		voice.knobVoice({ action: "interrupt", generation: 1 }),
	);
	await settle(2900);
	assert.equal(
		await js<boolean>("!!document.querySelector('.voice-backdrop')"),
		false,
		"busy knob rejection expires without an idle",
	);
	assert.equal(
		await js<boolean>("!!document.querySelector('.voice-bar')"),
		true,
		"knob interrupt leaves the grid capture and mic bar running",
	);
	await capture("voice-review-busy-expired-grid-running");
	// A second key while 1,6 records: busy stage, tone, toast and key alert.
	await input("1,7", "down");
	await settle(250);
	assert.equal(
		await js<boolean>("!!document.querySelector('.voice-toast')"),
		true,
	);
	assert.equal(
		await js<string | null>(
			"document.querySelector('.strip-slot[data-key-code=\"1,7\"] .voice-key-alert')?.dataset.alert ?? null",
		),
		"invalid",
	);
	await capture("voice-grid-busy-alert");
	await input("1,7", "touchEnd");
	await input("1,6", "touchEnd");
	await waitForVoice(
		panel,
		`document.querySelector('.copilot-status')?.textContent === 'Completed'`,
	);
	assert.equal(await text(".copilot-status"), "Completed");
	assert.match((await text(".copilot-text")) ?? "", /\(mock\) Lisbon is sunny/);
	await capture("voice-copilot-completed");

	// The processing state before the first delta: cancel hint and indicator.
	await publish({
		_tag: "KeyPress",
		serial: SERIAL,
		keyCode: "2,6",
		action: "down",
	});
	await publish({
		_tag: "Stage",
		serial: SERIAL,
		keyCode: "2,6",
		captureId: "cancel",
		stage: { _tag: "recording", status: "listening" },
	});
	await publish({
		_tag: "KeyPress",
		serial: SERIAL,
		keyCode: "2,6",
		action: "up",
	});
	await publish({
		_tag: "Stage",
		serial: SERIAL,
		keyCode: "2,6",
		captureId: "cancel",
		stage: { _tag: "processing", transcript: "Find flights to Porto" },
	});
	// Let the earlier busy toast expire (3000 ms) for a clean capture.
	await settle(3100);
	assert.equal(await text(".copilot-status"), "Processing");
	assert.equal(
		await js<number>(
			"document.querySelectorAll('.voice-cancel-indicator').length",
		),
		1,
	);
	await capture("voice-copilot-cancel");
	await publish({
		_tag: "Stage",
		serial: SERIAL,
		keyCode: "2,6",
		captureId: "cancel",
		stage: { _tag: "idle", outcome: "cancelled" },
	});

	// DKClaw: ClawBotView and ClawBotInput.
	await profiles.dispose();
	profiles = serveProfiles(voiceFixtureEnvelope(dkClawProfile, SERIAL));
	await load();
	await publish({ _tag: "AgentStatus", state: "connected" });
	await input("1,5", "down", "clawbot");
	await waitForVoice(
		panel,
		`document.querySelector('.clawbot-input-box')?.value.includes('weather')`,
	);
	assert.match((await text(".clawbot-messages")) ?? "", /Voice Input/);
	await capture("voice-clawbot-recording");
	await input("1,5", "touchEnd", "clawbot");
	await waitForVoice(
		panel,
		`document.querySelector('.clawbot-messages')?.textContent.includes('Lisbon is sunny')`,
	);
	assert.match((await text(".clawbot-messages")) ?? "", /Lisbon is sunny/);
	assert.match(
		(await js<string>("document.querySelector('.clawbot-input-box').value")) ??
			"",
		/weather/,
	);
	assert.equal(
		await js<number>("document.querySelectorAll('.voice-clawbot-dot').length"),
		1,
	);
	await capture("voice-clawbot-voice-turn");
	await publish({
		_tag: "TurnStarted",
		serial: SERIAL,
		keyCode: "1,5",
		sessionId,
		turnId,
		prompt: "Plan my morning",
		source: "typed",
		agent: { id: "assistant", name: "Assistant", icon: "0-2" },
	});
	await publish({
		_tag: "Tool",
		serial: SERIAL,
		keyCode: "1,5",
		turnId,
		toolCallId: "call-1",
		name: "web_search",
		phase: "result",
		args: '{"query":"Lisbon traffic 8am"}',
	});
	let seq = 0;
	for (const textDelta of [
		"## Morning plan\n",
		"- **08:00** leave for the office\n",
		"- Check `calendar` for the 09:30 sync\n",
		"> Traffic is light today.\n",
		"Details: https://example.com/traffic/lisbon <b>not markup</b>",
	])
		await publish({
			_tag: "Chunk",
			serial: SERIAL,
			keyCode: "1,5",
			chunk: {
				version: 1,
				sessionId,
				turnId,
				seq: seq++,
				type: "answer",
				textDelta,
			},
		});
	await publish({
		_tag: "Chunk",
		serial: SERIAL,
		keyCode: "1,5",
		chunk: {
			version: 1,
			sessionId,
			turnId,
			seq,
			type: "end",
			outcome: "completed",
		},
	});
	await settle(500);
	assert.equal(
		(await js<number>("document.querySelectorAll('.clawbot-chip').length")) >=
			1,
		true,
	);
	assert.equal(
		await js<number>("document.querySelectorAll('.clawbot-messages b').length"),
		0,
	);
	assert.equal(
		await js<number>("document.querySelectorAll('.clawbot-tool').length"),
		1,
	);
	await capture("voice-clawbot-conversation");

	const played = tones.played().map(({ tone }) => tone);
	for (const tone of ["start", "end", "error", "busy"])
		assert(
			played.some((value) => value === tone),
			`tone ${tone} recorded`,
		);
	await voice.dispose();
	await profiles.dispose();
	await reviewSmoke(panel, renderer, SERIAL, capture);
	await knobRegistration.dispose();
	await media.dispose();
	panel.destroy();
	process.stdout.write(
		`Voice smoke PASS: overlay stages, 3-2-1 countdown, marquee, mic bar from mock levels, grid hold-to-talk through IPC and the mock runtime, busy alert and toast, AI Copilot, cancel indicator, ClawBotView with rich text and tool card, ClawBotInput. Tones recorded without HID: ${played.join(",")}. Hardware unverified.\n`,
	);
}

smoke()
	.then(async () => {
		await rm(directory, { recursive: true, force: true });
		app.quit();
	})
	.catch(async (cause: unknown) => {
		process.stderr.write(
			`${cause instanceof Error ? cause.stack : String(cause)}\n`,
		);
		await rm(directory, { recursive: true, force: true });
		app.exit(1);
	});
