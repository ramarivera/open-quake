import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ManagedRuntime } from "effect";
import { type BrowserWindow, ipcMain } from "electron";
import { ProfileService } from "../../../../../packages/device/src/profiles/index.js";
import { stripText } from "../../renderer/src/strip/overlays/voice/strings";
import { STRIP_LOCALES } from "../../renderer/src/strip/overlays/voice/strings-table";
import type { EncodedProfileEnvelope } from "../../shared/profiles";
import { VOICE_REQUEST_CHANNEL } from "../../shared/voice-surface";
import { ProfilesLive, registerProfiles } from "../profiles/profile-ipc";
import { copilotProfile, dkClawProfile } from "../test/voice-fixtures";
import { createToneRecorder, registerVoiceSurface } from "./index";
import { waitForVoice } from "./smoke-wait";

interface HintGeometry {
	readonly text: string;
	readonly font: string;
	readonly tracking: string;
	readonly glyphs: readonly {
		readonly character: string;
		readonly x: number;
		readonly y: number;
		readonly width: number;
		readonly natural: number;
		readonly naturalAdvance: number;
		readonly naturalInkGap: number;
		readonly inkLeft: number;
		readonly inkRight: number;
	}[];
	readonly left: number;
	readonly right: number;
	readonly top: number;
	readonly bottom: number;
	readonly fontSize: number;
}

/** Real glyph positions, including ink overhangs, independent of layout strategy. */
const hintGeometry = `(() => {
	const hint = document.querySelector('.copilot-hint');
	const bounds = hint.getBoundingClientRect();
	const style = getComputedStyle(hint);
	const canvas = document.createElement('canvas').getContext('2d');
	canvas.font = style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
	const walker = document.createTreeWalker(hint, NodeFilter.SHOW_TEXT);
	const glyphs = [];
	while (walker.nextNode()) {
		const node = walker.currentNode;
		let offset = 0;
		for (const character of node.textContent) {
			const range = document.createRange();
			range.setStart(node, offset);
			offset += character.length;
			range.setEnd(node, offset);
			const box = range.getBoundingClientRect();
			const metrics = canvas.measureText(character);
			glyphs.push({ character, x: box.x, y: box.y, width: box.width,
				natural: metrics.width, inkLeft: box.x - metrics.actualBoundingBoxLeft,
				inkRight: box.x + metrics.actualBoundingBoxRight });
		}
	}
	for (const [index, glyph] of glyphs.entries()) {
		const next = glyphs[index + 1];
		const nextMetrics = canvas.measureText(next?.character ?? '');
		// Keep the font's own pair kerning; tracking must not compress it further.
		glyph.naturalAdvance = canvas.measureText(glyph.character + (next?.character ?? '')).width - nextMetrics.width;
		glyph.naturalInkGap = glyph.naturalAdvance - nextMetrics.actualBoundingBoxLeft - canvas.measureText(glyph.character).actualBoundingBoxRight;
	}
	return { text: hint.textContent, font: canvas.font, tracking: style.letterSpacing,
		glyphs, left: bounds.left, right: bounds.right, top: bounds.top,
		bottom: bounds.bottom, fontSize: parseFloat(style.fontSize) };
})()`;

function assertLegible(geometry: HintGeometry, label: string): void {
	assert(geometry.glyphs.length > 10, `${label}: mounted text exists`);
	for (const [index, glyph] of geometry.glyphs.entries()) {
		if (glyph.character.trim() === "") continue;
		assert(glyph.width > 0, `${label}: visible ${index}`);
		assert(
			glyph.x >= geometry.left - 1 &&
				glyph.x + glyph.width <= geometry.right + 1,
			`${label}: glyph ${index} fits horizontally`,
		);
		assert(
			glyph.y >= geometry.top && glyph.y < geometry.bottom,
			`${label}: glyph ${index} fits vertically`,
		);
		const next = geometry.glyphs[index + 1];
		if (!next || Math.abs(next.y - glyph.y) > geometry.fontSize / 2) continue;
		assert(
			next.x - glyph.x >= glyph.naturalAdvance * 0.85,
			`${label}: collapsed advance at ${index} ${glyph.character}: ${next.x - glyph.x} / ${glyph.naturalAdvance}`,
		);
		if (next.character.trim() !== "")
			assert(
				next.inkLeft - glyph.inkRight >=
					Math.min(0, glyph.naturalInkGap) - 0.75,
				`${label}: excess ink overlap at ${index} ${glyph.character}${next.character}`,
			);
	}
}

/** PR #28 round three, using mounted locales and the real selection/send IPC path. */
export async function reviewRound3Smoke(
	panel: BrowserWindow,
	renderer: string,
	serial: string,
	capture: (name: string) => Promise<void>,
	artifacts: string | undefined,
): Promise<void> {
	const first = dkClawProfile.pages[0];
	assert(first);
	const profile: EncodedProfileEnvelope["profiles"][number] = {
		...dkClawProfile,
		pages: [
			{
				...first,
				keys: first.keys.map((key) => {
					if (key.keyCode !== "1,5" && key.keyCode !== "1,6") return key;
					return {
						...key,
						config: {
							...key.config,
							actions: [
								{ type: "voiceInput", value: false },
								...(key.keyCode === "1,6"
									? [{ type: "agentId", value: " \t " }]
									: []),
							],
						},
					};
				}),
			},
		],
	};
	const envelope: EncodedProfileEnvelope = {
		schemaVersion: 1,
		profiles: [copilotProfile, profile],
		activeByDevice: {
			"desktop-preview": { profileId: copilotProfile.id, pageId: "copilot-1" },
		},
	};
	const runtime = ManagedRuntime.make(
		ProfilesLive({
			read: async () => structuredClone(envelope),
			write: async () => undefined,
		}),
	);
	const profiles = registerProfiles(runtime, renderer);
	// Observe requests at the real IPC handler without changing its replies.
	const requests: unknown[] = [];
	const handle = ipcMain.handle;
	ipcMain.handle = (channel, listener) => {
		handle.call(ipcMain, channel, (event, ...args: unknown[]) => {
			if (channel === VOICE_REQUEST_CHANNEL) requests.push(args[0]);
			return listener(event, ...args);
		});
	};
	const voice = (() => {
		try {
			return registerVoiceSurface({
				mock: true,
				tones: createToneRecorder(),
				serial: () => serial,
				panel: () => panel,
				management: () => undefined,
				renderer,
			});
		} finally {
			ipcMain.handle = handle;
		}
	})();
	const js = <T>(source: string): Promise<T> =>
		panel.webContents.executeJavaScript(source);
	try {
		await panel.loadFile(resolve("out/renderer/index.html"), {
			query: { surface: "panel" },
		});
		await waitForVoice(panel, "!!document.querySelector('.copilot-hint')");
		for (const locale of STRIP_LOCALES) {
			await js(`Object.defineProperty(navigator, 'language', { configurable: true, get: () => ${JSON.stringify(locale)} });
				document.documentElement.dataset.motion = 'full';
				window.quakeVoice.request({ _tag: 'Reset', reason: 'profileChanged' })`);
			await waitForVoice(
				panel,
				`document.querySelector('.copilot-hint')?.textContent === ${JSON.stringify(stripText(locale, "aiIconViewTxt.pushToTalkHint"))}`,
			);
			await js("document.fonts.ready");
			const geometry = await js<HintGeometry>(hintGeometry);
			if (artifacts)
				await writeFile(
					join(artifacts, `voice-round3-hint-${locale}.json`),
					JSON.stringify(geometry, null, 2),
				);
			assert.equal(
				geometry.text.replaceAll("\u00a0", " "),
				stripText(locale, "aiIconViewTxt.pushToTalkHint"),
			);
			assertLegible(geometry, locale);
			await capture(`voice-round3-hint-${locale}`);
			if (locale === "fr") {
				await js(
					"document.querySelector('.copilot-hint').style.width = '420px'",
				);
				const constrained = await js<HintGeometry>(hintGeometry);
				assertLegible(constrained, "French constrained width");
				assert(
					new Set(constrained.glyphs.map((glyph) => Math.round(glyph.y))).size >
						1,
					"long hint wraps without shrinking its glyphs",
				);
				await capture("voice-round3-hint-fr-wrapped");
				await js("document.querySelector('.copilot-hint').style.width = ''");
			}
			if (locale === "en") {
				const ticks = await js<
					readonly { index: number; at: number }[]
				>(`new Promise((resolve, reject) => {
					const hint = document.querySelector('.copilot-hint');
					const letters = Array.from(hint.querySelectorAll('span')).filter(span => span.childElementCount === 0);
					const ticks = [];
					const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('Hint highlight stopped')); }, 3000);
					const observer = new MutationObserver(() => {
						ticks.push({ index: letters.indexOf(hint.querySelector('[data-lit]')), at: performance.now() });
						if (ticks.length < 8) return;
						clearTimeout(timeout); observer.disconnect(); resolve(ticks);
					});
					observer.observe(hint, { attributes: true, subtree: true, attributeFilter: ['data-lit'] });
				})`);
				const intervals = ticks
					.slice(1)
					.map((tick, index) => {
						const previous = ticks[index];
						assert(previous);
						assert.equal(
							tick.index,
							(previous.index + 1) % geometry.glyphs.length,
						);
						return tick.at - previous.at;
					})
					.sort((a, b) => a - b);
				const median = intervals[Math.floor(intervals.length / 2)];
				assert(
					median !== undefined && Math.abs(median - 100) <= 25,
					`100 ms highlight cadence: ${median}`,
				);
				if (artifacts)
					await writeFile(
						join(artifacts, "voice-round3-hint-timing.json"),
						JSON.stringify(ticks, null, 2),
					);
			}
			await js("document.documentElement.dataset.motion = 'reduce'");
			await waitForVoice(
				panel,
				"!document.querySelector('.copilot-hint [data-lit]')",
			);
			assertLegible(await js<HintGeometry>(hintGeometry), `${locale} reduced`);
			await js(`new Promise(resolve => setTimeout(resolve, 350))`);
			assert.equal(
				await js<number>(
					"document.querySelector('.orb-root').getAnimations({ subtree: true }).length",
				),
				0,
			);
			assert.equal(
				await js<number>(
					"document.querySelectorAll('.copilot-hint [data-lit]').length",
				),
				0,
			);
			if (locale === "en") await capture("voice-round3-hint-en-reduced");
		}
		await runtime.runPromise(
			ProfileService.selectProfile({
				deviceId: "desktop-preview",
				profileId: profile.id,
				pageId: first.id,
			}),
		);
		await panel.loadFile(resolve("out/renderer/index.html"), {
			query: { surface: "panel" },
		});
		await waitForVoice(panel, "!!document.querySelector('.clawbot-input-box')");
		for (const keyCode of ["1,5", "1,6"]) {
			const point = await js<{ x: number; y: number }>(
				`(() => { const r = document.querySelector('[data-key-code="${keyCode}"]').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`,
			);
			for (const type of ["mouseDown", "mouseUp"] as const)
				panel.webContents.sendInputEvent({
					type,
					...point,
					button: "left",
					clickCount: 1,
				});
			await waitForVoice(
				panel,
				`!!document.querySelector('[data-key-code="${keyCode}"] .voice-clawbot-dot')`,
			);
			await js(`(() => {
				const box = document.querySelector('.clawbot-input-box');
				Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, 'Keep my draft');
				box.dispatchEvent(new Event('input', { bubbles: true }));
			})()`);
			await js("document.querySelector('.clawbot-input-button').click()");
			await waitForVoice(
				panel,
				`document.querySelector('.clawbot-input-warning')?.textContent === 'Please select your assistant!'`,
			);
			assert.equal(
				await js<string>("document.querySelector('.clawbot-input-box').value"),
				"Keep my draft",
			);
			await capture(`voice-round3-missing-agent-${keyCode.replace(",", "-")}`);
			await waitForVoice(
				panel,
				"!document.querySelector('.clawbot-input-warning')",
			);
		}
		assert(
			requests.some(
				(request) =>
					typeof request === "object" &&
					request !== null &&
					"_tag" in request &&
					request._tag === "Input",
			),
			"selection traversed the observed real IPC boundary",
		);
		assert(
			!requests.some(
				(request) =>
					typeof request === "object" &&
					request !== null &&
					"_tag" in request &&
					request._tag === "SendText",
			),
			"missing/blank selection never invokes SendText",
		);
		process.stdout.write(
			"Voice round 3 PASS: eight mounted idle locales, glyph advances/ink/fit, reduced motion, missing/blank assistant warning with draft retained and no SendText.\n",
		);
	} finally {
		if (artifacts)
			await writeFile(
				join(artifacts, "voice-round3-requests.json"),
				JSON.stringify(requests, null, 2),
			);
		await voice.dispose();
		await profiles.dispose();
	}
}
