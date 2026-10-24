import assert from "node:assert/strict";
import { resolve } from "node:path";
import { ManagedRuntime, Schema } from "effect";
import type { BrowserWindow } from "electron";
import { ProfileService } from "../../../../../packages/device/src/profiles/index.js";
import { QUAKE_EVENT_CHANNEL } from "../../preload/quake";
import type { EncodedProfileEnvelope } from "../../shared/profiles";
import { VoiceSurfaceReply } from "../../shared/voice-surface";
import { startMockDeviceBus } from "../mockDeviceBus";
import { ProfilesLive, registerProfiles } from "../profiles/profile-ipc";
import { dkClawProfile } from "../test/voice-fixtures";
import { createToneRecorder, registerVoiceSurface } from "./index";
import { waitForVoice } from "./smoke-wait";

const settle = (ms = 250) => new Promise<void>((done) => setTimeout(done, ms));

/** Mounted regressions for PR #28. No renderer state or request handlers are mocked. */
export async function reviewSmoke(
	panel: BrowserWindow,
	renderer: string,
	serial: string,
	capture: (name: string) => Promise<void>,
): Promise<void> {
	const first = dkClawProfile.pages[0];
	assert(first);
	const keys = first.keys.map((key) =>
		key.keyCode === "1,5" || key.keyCode === "1,6"
			? {
					...key,
					config: {
						...key.config,
						actions: [
							...(key.config.actions ?? []).filter(
								(action) => action.type !== "voiceInput",
							),
							...(key.keyCode === "1,5"
								? [{ type: "voiceInput", value: false }]
								: []),
						],
					},
				}
			: key,
	);
	const profile: EncodedProfileEnvelope["profiles"][number] = {
		...dkClawProfile,
		pages: [
			{ ...first, keys },
			{ ...first, id: "review-page-2", keys },
		],
	};
	const other = { ...profile, id: "review-profile-2" };
	const envelope: EncodedProfileEnvelope = {
		schemaVersion: 1,
		profiles: [profile, other],
		activeByDevice: {
			"desktop-preview": { profileId: profile.id, pageId: first.id },
		},
	};
	const runtime = ManagedRuntime.make(
		ProfilesLive({
			read: async () => structuredClone(envelope),
			write: async () => undefined,
		}),
	);
	const profiles = registerProfiles(runtime, renderer);
	const options = {
		mock: true,
		tones: createToneRecorder(),
		serial: () => serial,
		panel: () => panel,
		management: () => undefined,
		renderer,
	};
	let voice = registerVoiceSurface(options);
	const bus = startMockDeviceBus();
	const off = bus.on((event) =>
		panel.webContents.send(QUAKE_EVENT_CHANNEL, event),
	);
	const js = <T>(source: string): Promise<T> =>
		panel.webContents.executeJavaScript(source);
	const value = () =>
		js<string>("document.querySelector('.clawbot-input-box').value");
	const fill = async (text: string) => {
		await js(`(() => {
			const box = document.querySelector('.clawbot-input-box');
			Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, ${JSON.stringify(text)});
			box.dispatchEvent(new Event('input', { bubbles: true }));
		})()`);
		await settle(30);
		assert.equal(await value(), text);
	};
	const send = () =>
		js("document.querySelector('.clawbot-input-button').click(); null");
	const select = async (profileId: string, pageId: string) => {
		await runtime.runPromise(
			ProfileService.selectProfile({
				deviceId: "desktop-preview",
				profileId,
				pageId,
			}),
		);
		await settle();
	};
	try {
		await panel.loadFile(resolve("out/renderer/index.html"), {
			query: { surface: "panel" },
		});
		await waitForVoice(panel, `!!document.querySelector('.clawbot-input-box')`);
		// False voiceInput: native pointer -> renderer input -> main -> selected assistant.
		panel.webContents.sendInputEvent({
			type: "mouseDown",
			x: 1100,
			y: 120,
			button: "left",
			clickCount: 1,
		});
		panel.webContents.sendInputEvent({
			type: "mouseUp",
			x: 1100,
			y: 120,
			button: "left",
			clickCount: 1,
		});
		await waitForVoice(
			panel,
			`document.querySelector('.clawbot-input-title')?.textContent.includes('Weather')`,
		);
		assert.match(
			await js<string>(
				"document.querySelector('.clawbot-input-title').textContent",
			),
			/Weather/,
		);
		await fill("accepted typed message");
		await send();
		await waitForVoice(
			panel,
			`document.querySelector('.clawbot-input-box')?.value === '' && document.querySelector('.clawbot-messages')?.textContent.includes('accepted typed message')`,
		);
		assert.equal(await value(), "", "accepted send clears its submitted draft");
		assert.match(
			await js<string>(
				"document.querySelector('.clawbot-messages').textContent",
			),
			/accepted typed message/,
		);
		// Absent voiceInput: source-derived vendor frame -> mock bus -> preload -> same input route.
		const x = 1340,
			rawY = 360;
		bus.emitTouchReport(
			new Uint8Array([
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
			]),
		);
		bus.emitTouchReport(new Uint8Array([0xa3, 0, 0, 0x1a, 0]));
		await waitForVoice(
			panel,
			`document.querySelector('.clawbot-input-title')?.textContent.includes('Coder')`,
		);
		await settle(1200);
		assert.match(
			await js<string>(
				"document.querySelector('.clawbot-input-title').textContent",
			),
			/Coder/,
		);
		assert.equal(
			await js<boolean>("!!document.querySelector('.voice-bar')"),
			false,
			"typed-only selection never starts capture",
		);
		await capture("voice-review-typed-only-selection");
		await voice.dispose();
		voice = registerVoiceSurface({ ...options, mock: false });
		await fill("Please summarize this");
		const rejected: unknown = await js(
			`window.quakeVoice.request({ _tag: 'SendText', keyCode: '1,6', agentId: 'code', message: 'Please summarize this' })`,
		);
		assert.deepEqual(Schema.decodeUnknownSync(VoiceSurfaceReply)(rejected), {
			_tag: "rejected",
			code: "VOICE.GRID.RUNTIME_UNAVAILABLE",
		});
		await send();
		await settle();
		assert.equal(
			await value(),
			"Please summarize this",
			"unavailable send retains the mounted draft",
		);
		await capture("voice-review-rejected-draft");
		await js(
			"document.querySelector('.clawbot-input-box').dataset.reviewProbe = 'retained'; null",
		);
		await select(other.id, first.id);
		assert.equal(
			await value(),
			"",
			"profile switch clears the draft at the same coordinate",
		);
		await fill("draft for the next page");
		await select(other.id, "review-page-2");
		assert.equal(
			await value(),
			"",
			"page switch clears the draft at the same coordinate",
		);
		assert.equal(
			await js<string>(
				"document.querySelector('.clawbot-input-box').dataset.reviewProbe",
			),
			"retained",
			"the same textarea remained mounted",
		);
		await send();
		await settle(50);
		assert.match(
			await js<string>(
				"document.querySelector('.clawbot-input-warning').textContent",
			),
			/tap an AI assistant/,
		);
		await capture("voice-review-profile-reset");
		process.stdout.write(
			"Voice review regressions PASS: native pointer and raw mock device selection for typed-only assistants, accepted/rejected delivery, mounted draft reset on profile and page switches.\n",
		);
	} finally {
		off();
		bus.stop();
		await voice.dispose();
		await profiles.dispose();
	}
}
