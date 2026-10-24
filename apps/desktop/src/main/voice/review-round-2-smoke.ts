import assert from "node:assert/strict";
import { resolve } from "node:path";
import { ManagedRuntime, Schema } from "effect";
import type { BrowserWindow } from "electron";
import { ProfileService } from "../../../../../packages/device/src/profiles/index.js";
import {
	SessionId,
	TurnId,
} from "../../../../../packages/edge/src/chat/chat-contracts.js";
import { QUAKE_EVENT_CHANNEL } from "../../preload/quake";
import type { EncodedProfileEnvelope } from "../../shared/profiles";
import type { VoiceStage } from "../../shared/voice-surface";
import { startMockDeviceBus } from "../mockDeviceBus";
import { ProfilesLive, registerProfiles } from "../profiles/profile-ipc";
import { copilotProfile, dkClawProfile } from "../test/voice-fixtures";
import { createToneRecorder, registerVoiceSurface } from "./index";
import { waitForVoice } from "./smoke-wait";

const settle = (ms: number) =>
	new Promise<void>((done) => setTimeout(done, ms));

/** Second-round regressions through native input, device status, preload and IPC. */
export async function reviewRound2Smoke(
	panel: BrowserWindow,
	renderer: string,
	serial: string,
	capture: (name: string) => Promise<void>,
): Promise<void> {
	const first = dkClawProfile.pages[0];
	assert(first);
	const keys = first.keys.map((key) => {
		if (key.keyCode === "1,6")
			return {
				...key,
				config: {
					...key.config,
					actions: [
						{ type: "voiceInput", value: false },
						{ type: "agentId", value: "code" },
					],
				},
			};
		return key;
	});
	const profile: EncodedProfileEnvelope["profiles"][number] = {
		...dkClawProfile,
		pages: [{ ...first, keys }],
	};
	const pilotPage = copilotProfile.pages[0];
	assert(pilotPage);
	const pilot: EncodedProfileEnvelope["profiles"][number] = {
		...copilotProfile,
		pages: [
			{
				...pilotPage,
				keys: pilotPage.keys.map((key) =>
					key.keyCode === "1,6"
						? {
								...key,
								childrenName: "clawbot",
								config: {
									...key.config,
									type: "clawbot",
									actions: [
										{ type: "voiceInput", value: true },
										{ type: "agentId", value: "weather" },
									],
								},
							}
						: key,
				),
			},
		],
	};
	const envelope: EncodedProfileEnvelope = {
		schemaVersion: 1,
		profiles: [profile, pilot],
		activeByDevice: {
			"desktop-preview": { profileId: pilot.id, pageId: pilotPage.id },
		},
	};
	const profileRuntime = ManagedRuntime.make(
		ProfilesLive({
			read: async () => structuredClone(envelope),
			write: async () => undefined,
		}),
	);
	const profiles = registerProfiles(profileRuntime, renderer);
	const tones = createToneRecorder();
	const voice = registerVoiceSurface({
		mock: true,
		tones,
		serial: () => serial,
		panel: () => panel,
		management: () => undefined,
		renderer,
	});
	const bus = startMockDeviceBus(false);
	let pendingStatus = Promise.resolve();
	const off = bus.on((event) => {
		// Same ordering as main/index.ts: main gates/reset before touch teardown.
		pendingStatus = voice.onDevice(event);
		panel.webContents.send(QUAKE_EVENT_CHANNEL, event);
	});
	const js = <T>(source: string): Promise<T> =>
		panel.webContents.executeJavaScript(source);
	const point = async (keyCode: string) =>
		js<{ x: number; y: number }>(
			`(() => { const r = document.querySelector('[data-state="tile"][data-key-code="${keyCode}"]').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`,
		);
	const pointer = async (keyCode: string, type: "mouseDown" | "mouseUp") =>
		panel.webContents.sendInputEvent({
			type,
			...(await point(keyCode)),
			button: "left",
			clickCount: 1,
		});
	const tap = async (keyCode: string) => {
		await pointer(keyCode, "mouseDown");
		await pointer(keyCode, "mouseUp");
		await settle(450);
	};
	const reset = () =>
		js(
			"window.quakeVoice.request({ _tag: 'Reset', reason: 'profileChanged' })",
		);
	const stage = (value: VoiceStage) =>
		voice.publish({
			_tag: "Stage",
			serial,
			keyCode: "1,5",
			captureId: "review-transcript",
			stage: value,
		});
	const liveText = () =>
		js<string>(
			"Array.from(document.querySelectorAll('.clawbot-group')).at(-1)?.querySelector('.clawbot-bubble')?.innerText",
		);
	try {
		await panel.loadFile(resolve("out/renderer/index.html"), {
			query: { surface: "panel" },
		});
		await waitForVoice(panel, "!!document.querySelector('.copilot-status')");
		await tap("1,6");
		assert.equal(
			await js<string>("document.querySelector('.copilot-status').textContent"),
			"",
			"a selection-only voice-enabled tap returns Copilot to idle",
		);
		assert.equal(
			await js<boolean>("!!document.querySelector('.voice-cancel-indicator')"),
			false,
		);
		await capture("voice-round2-selection-only-tap");
		// A different key can now complete a real mock-runtime turn.
		await pointer("1,7", "mouseDown");
		await waitForVoice(panel, "!!document.querySelector('.voice-bar')");
		await settle(400);
		await pointer("1,7", "mouseUp");
		await waitForVoice(
			panel,
			"document.querySelector('.copilot-text')?.textContent.includes('(mock)')",
		);
		await waitForVoice(
			panel,
			"!document.querySelector('.voice-cancel-indicator')",
		);
		await capture("voice-round2-following-answer");
		await profileRuntime.runPromise(
			ProfileService.selectProfile({
				deviceId: "desktop-preview",
				profileId: profile.id,
				pageId: first.id,
			}),
		);
		await waitForVoice(panel, "!!document.querySelector('.clawbot-input-box')");
		await reset();
		await tap("1,5");
		for (const transcript of [
			"This is the first sentence.",
			"Next",
			"Next sentence",
			"Next",
			"Next sentence corrected",
		]) {
			await stage({ _tag: "recording", status: "speaking", transcript });
			const expected = transcript.startsWith("This")
				? transcript
				: `This is the first sentence.\n${transcript}`;
			await waitForVoice(
				panel,
				`document.querySelector('.clawbot-input-box').value === ${JSON.stringify(expected)}`,
			);
			assert.equal(await liveText(), expected);
		}
		const final = "This is the first sentence.\nNext sentence final";
		await stage({ _tag: "processing", transcript: final });
		await waitForVoice(
			panel,
			`document.querySelector('.clawbot-input-box').value === ${JSON.stringify(final)}`,
		);
		assert.equal(await liveText(), final);
		await capture("voice-round2-transcript-prefix");
		await reset();
		await tap("1,5");
		await stage({
			_tag: "recording",
			status: "speaking",
			transcript: "What is",
		});
		await tap("1,6");
		await stage({
			_tag: "recording",
			status: "speaking",
			transcript: "What is the weather",
		});
		await settle(50);
		assert.equal(await liveText(), "What is the weather");
		await stage({
			_tag: "processing",
			transcript: "What is the weather today?",
		});
		await settle(50);
		assert.equal(await liveText(), "What is the weather today?");
		const sessionId = Schema.decodeUnknownSync(SessionId)(
			"00000000-0000-4000-8000-000000000091",
		);
		const turnId = Schema.decodeUnknownSync(TurnId)(
			"00000000-0000-4000-8000-000000000092",
		);
		await voice.publish({
			_tag: "TurnStarted",
			serial,
			keyCode: "1,5",
			sessionId,
			turnId,
			source: "voice",
			prompt: "What is the weather today? Final correction.",
		});
		await voice.publish({
			_tag: "Chunk",
			serial,
			keyCode: "1,5",
			chunk: {
				version: 1,
				sessionId,
				turnId,
				seq: 0,
				type: "answer",
				textDelta: "Owner retained",
			},
		});
		await waitForVoice(
			panel,
			"document.querySelector('.clawbot-messages').textContent.includes('Final correction.')",
		);
		assert.match(
			await js<string>(
				"Array.from(document.querySelectorAll('.clawbot-group')).at(-1).textContent",
			),
			/Voice Input.*Weather/s,
		);
		assert.match(
			await js<string>(
				"document.querySelector('.clawbot-input-title').textContent",
			),
			/Coder/,
		);
		await js(
			"Promise.all(Array.from(document.querySelectorAll('.clawbot-group')).flatMap(group => group.getAnimations()).map(animation => animation.finished))",
		);
		await settle(100);
		await capture("voice-round2-capture-owner");
		await reset();
		// Raw reports keep the mock touch alive until disconnect, as real HID does.
		const { x, y } = await point("1,5");
		const rawY = 480 - y;
		const frame = new Uint8Array([
			0xa3,
			0,
			0,
			0x1a,
			1,
			1,
			rawY & 0xff,
			rawY >> 8,
			x & 0xff,
			x >> 8,
		]);
		const holdAndDisconnect = async (ms: number, capturing: boolean) => {
			bus.emitStatus({ source: "mock", kind: "status", state: "connected" });
			bus.emitTouchReport(frame);
			const keepAlive = setInterval(() => bus.emitTouchReport(frame), 40);
			try {
				await settle(ms);
				if (capturing)
					assert.equal(
						await js<boolean>("!!document.querySelector('.voice-bar')"),
						true,
					);
				bus.emitStatus({
					source: "mock",
					kind: "status",
					state: "disconnected",
					reason: "transport-ended",
				});
				await pendingStatus;
			} finally {
				clearInterval(keepAlive);
			}
			await waitForVoice(
				panel,
				"!document.querySelector('.voice-bar') && !document.querySelector('.voice-cancel-indicator') && document.querySelector('.clawbot-input-box').value === ''",
			);
			await settle(1300);
			assert.equal(
				await js<boolean>("!!document.querySelector('.voice-bar')"),
				false,
				"no delayed capture after disconnect",
			);
			assert.equal(
				await js<string>(
					"document.querySelector('.copilot-status')?.textContent ?? ''",
				),
				"",
			);
		};
		const turnsBefore = await js<number>(
			"document.querySelectorAll('.clawbot-group').length",
		);
		await holdAndDisconnect(250, false);
		await capture("voice-round2-disconnected-pending");
		await holdAndDisconnect(1500, true);
		assert.equal(
			await js<number>("document.querySelectorAll('.clawbot-group').length"),
			turnsBefore,
			"interrupted recording must not create a voice turn",
		);
		await capture("voice-round2-disconnected-capture");
		assert.equal(
			tones.played().filter(({ tone }) => tone === "end").length,
			1,
			"only the earlier completed turn emits an end tone",
		);
		process.stdout.write(
			"Voice round 2 PASS: selection-only tap, following answer, growing/shrinking/final transcripts in mounted live row and input, independent capture owner with authoritative prompt, raw mock touch disconnect before/during capture, no interrupted submission.\n",
		);
	} finally {
		off();
		bus.stop();
		await pendingStatus;
		await voice.dispose();
		await profiles.dispose();
	}
}
