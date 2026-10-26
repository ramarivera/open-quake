import { Option } from "effect";
import { act } from "react";
import type {
	VoiceSurfaceReply,
	VoiceSurfaceRequest,
} from "../../../shared/voice-surface";
import { stripText } from "../strip/overlays/voice/strings";
import { StripToasts } from "../strip/overlays/voice/VoiceOverlay";
import { previewVoiceContext } from "../strip/overlays/voice/voice-context";
import {
	initialVoiceView,
	reduceVoice,
} from "../strip/overlays/voice/voice-state";
import {
	copilotLayout,
	delta,
	element,
	mount,
	sessionId,
	tap,
	tileProps,
	turnId,
} from "../strip/render-test-fixtures";
import { AiCopilotTile } from "../strip/tiles/aiCopilot/AiCopilotTile";
import { reduceCopilot } from "../strip/tiles/aiCopilot/copilot-state";
import { VoiceKeyTile } from "../strip/tiles/voiceKey/VoiceKeyTile";
import { delay, feed, keys, stage } from "./smoke-fixtures";

const nativeRequire: NodeJS.Require = globalThis.require;
const assert: typeof import("node:assert/strict") =
	nativeRequire("node:assert/strict");
export async function copilotSmoke() {
	let passed = 0;
	const screen = await mount(null);
	const show = async (
		view = initialVoiceView,
		options: Parameters<typeof tileProps>[1] = {},
	) =>
		screen.render(
			<>
				<AiCopilotTile {...tileProps("aiChatView", { view, ...options })} />
				<StripToasts view={view} locale={options.locale ?? "en"} />
			</>,
		);
	try {
		for (const surface of ["panel", "preview"] as const)
			for (const text of ["", " \n ", " answer "]) {
				await show(
					{
						...initialVoiceView,
						copilot: { ...initialVoiceView.copilot, text },
					},
					{ surface },
				);
				const copy = document.querySelector(".copilot-copy");
				assert.equal(Boolean(copy), surface === "panel" && text.trim() !== "");
				if (copy) {
					const toolbar = element(".copilot-toolbar").getBoundingClientRect(),
						rect = copy.getBoundingClientRect();
					assert(
						rect.width >= 40 &&
							rect.height >= 40 &&
							rect.bottom <= toolbar.bottom &&
							rect.right <= toolbar.right,
					);
				}
				passed++;
			}
		for (const status of [0, 3, 1, 4, 2, -1, 5] as const) {
			const copilot = reduceCopilot(
				{ ...initialVoiceView.copilot, status: Option.some(0) },
				{
					_tag: "response",
					keyCode: Option.some("1,6"),
					status,
					errorCode: Option.none(),
					message: Option.none(),
				},
				Date.now(),
			);
			await show({ ...initialVoiceView, copilot });
			assert(element(".copilot-status").textContent?.trim());
			const presence = element(".copilot-presence");
			assert(presence.querySelector("svg"));
			assert.equal(getComputedStyle(presence).filter, "none");
			assert.equal(getComputedStyle(presence).backgroundImage, "none");
			document.documentElement.dataset.motion = "reduce";
			assert.equal(getComputedStyle(presence).animationName, "none");
			passed++;
		}
		let current = {
			...initialVoiceView,
			copilot: {
				...initialVoiceView.copilot,
				status: Option.some(1 as const),
				text: " line\n".repeat(150),
			},
		};
		await show(current);
		const scroll = element(".copilot-scroll");
		assert(scroll.scrollTop > 0);
		await act(async () => {
			scroll.scrollTop = 100;
			scroll.dispatchEvent(new Event("scroll"));
		});
		current = {
			...current,
			copilot: {
				...current.copilot,
				text: `${current.copilot.text}  <img src=x>\n`,
			},
		};
		await show(current);
		assert.equal(scroll.scrollTop, 100);
		assert.equal(element(".copilot-text").textContent, current.copilot.text);
		assert.equal(scroll.querySelector("img"), null);
		await act(async () => {
			scroll.dispatchEvent(
				new CustomEvent("quake-sub-touch-start", {
					detail: { phase: "start", startY: 100, y: 100 },
				}),
			);
			scroll.dispatchEvent(
				new CustomEvent("quake-sub-touch-start", {
					detail: { phase: "move", startY: 100, y: 70 },
				}),
			);
		});
		assert.equal(scroll.scrollTop, 130);
		await tap(scroll, false);
		await delay(100);
		assert.equal(scroll.scrollTop, 130);
		await act(async () => {
			scroll.scrollTop = scroll.scrollHeight;
			scroll.dispatchEvent(new Event("scroll"));
		});
		await show({
			...current,
			copilot: {
				...current.copilot,
				text: current.copilot.text + "next\n".repeat(10),
			},
		});
		assert(scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop <= 1);
		passed++;
		// Observe the real interval rather than replacing browser timers.
		await show();
		const lit = () =>
			[...document.querySelectorAll(".copilot-hint span span")].findIndex(
				(el) => el.hasAttribute("data-lit"),
			);
		assert.equal(lit(), 0);
		await act(async () => {
			await delay(120);
		});
		assert.equal(lit(), 1);
		await show(initialVoiceView, { locale: "de" });
		assert.equal(lit(), 0);
		assert.equal(
			element(".copilot-hint").textContent,
			stripText("de", "aiIconViewTxt.pushToTalkHint"),
		);
		await show(initialVoiceView, { locale: "de", motion: "reduce" });
		await delay(120);
		assert.equal(lit(), -1);
		passed++;
		for (const locale of ["en", "de"] as const) {
			let value = feed(initialVoiceView, {
				_tag: "KeyPress",
				serial: "QK",
				keyCode: "1,6",
				action: "down",
			});
			value = feed(
				value,
				stage("1,6", { _tag: "recording", status: "speaking", transcript: "" }),
			);
			value = feed(value, {
				_tag: "KeyPress",
				serial: "QK",
				keyCode: "1,6",
				action: "up",
			});
			const render = async () => {
				const context = {
					...previewVoiceContext,
					view: value,
					locale,
					surface: "panel" as const,
				};
				await screen.render(
					<>
						<AiCopilotTile {...tileProps("aiChatView", context)} />
						{copilotLayout.tiles
							.filter((t) => t.type === "aiChat")
							.map((t) => (
								<div
									key={t.keyCode}
									data-key={t.keyCode}
									style={{ position: "relative", width: 220, height: 220 }}
								>
									<VoiceKeyTile
										tile={t}
										context={{
											now: undefined,
											hourFormat: "24h",
											voice: context,
										}}
									/>
								</div>
							))}
					</>,
				);
			};
			await render();
			assert.equal(
				document.querySelectorAll(".voice-cancel-indicator").length,
				1,
			);
			const icon = element("[data-key='1,6'] .voice-cancel-indicator");
			assert.equal(icon.getBoundingClientRect().width, 120);
			assert.equal(icon.getBoundingClientRect().height, 120);
			assert.equal(
				getComputedStyle(element("[data-key='1,6'] .strip-tile-icon"))
					.visibility,
				"hidden",
			);
			assert.equal(
				element(".copilot-cancel-title").textContent,
				Option.getOrUndefined(value.copilot.activeKeyTitle),
			);
			value = {
				...value,
				copilot: { ...value.copilot, activeKeyTitle: Option.none() },
			};
			await render();
			assert.equal(
				element(".copilot-cancel-title").textContent,
				stripText(locale, "aiIconViewTxt.cancelHint.theActiveKey"),
			);
			value = feed(value, delta("text", 0, "1,6"));
			await render();
			assert.equal(document.querySelector(".copilot-cancel"), null);
			assert.equal(document.querySelector(".voice-cancel-indicator"), null);
			for (const reset of ["cancel", "complete", "profile"] as const) {
				value = feed(initialVoiceView, {
					_tag: "KeyPress",
					serial: "QK",
					keyCode: "1,6",
					action: "down",
				});
				value = feed(
					value,
					stage("1,6", { _tag: "recording", status: "speaking" }),
				);
				value = feed(value, {
					_tag: "KeyPress",
					serial: "QK",
					keyCode: "1,6",
					action: "up",
				});
				await render();
				assert(element(".voice-cancel-indicator"), `active before ${reset}`);
				value =
					reset !== "profile"
						? feed(value, {
								_tag: "Chunk",
								serial: "QK",
								keyCode: "1,6",
								chunk: {
									version: 1,
									sessionId,
									turnId,
									seq: 1,
									type: "end",
									outcome: reset === "cancel" ? "cancelled" : "completed",
								},
							})
						: reduceVoice(value, { _tag: "profileReset" }, keys, Date.now());
				await render();
				assert.equal(
					document.querySelector(".voice-cancel-indicator"),
					null,
					reset,
				);
			}
			passed++;
			const calls: VoiceSurfaceRequest[] = [];
			let reply: VoiceSurfaceReply = { _tag: "ok" },
				copyView = {
					...initialVoiceView,
					copilot: {
						...initialVoiceView.copilot,
						text: "  first \n  second\n",
					},
				};
			const request = async (r: VoiceSurfaceRequest) => {
				calls.push(r);
				return reply;
			};
			const toast = (key: Parameters<typeof previewVoiceContext.toast>[0]) => {
				copyView = reduceVoice(
					copyView,
					{ _tag: "toast", key },
					keys,
					Date.now(),
				);
			};
			await show(copyView, { locale, request, toast });
			await tap(element(".copilot-copy"), false);
			assert.equal(calls.length, 0);
			await tap(element(".copilot-copy"));
			assert.deepEqual(calls, [
				{ _tag: "CopyText", text: copyView.copilot.text },
			]);
			await show(copyView, { locale, request, toast });
			assert.equal(
				element("[role=status]").textContent,
				stripText(locale, "clipboard.copySuccess"),
			);
			reply = { _tag: "rejected", code: "VOICE.SURFACE.REQUEST_FAILED" };
			await tap(element(".copilot-copy"));
			await show(copyView, { locale, request, toast });
			assert.equal(
				element("[role=status]").textContent,
				stripText(locale, "clipboard.copyFailed"),
			);
			assert.equal(calls.length, 2);
			passed++;
		}
	} finally {
		await screen.unmount();
	}
	return passed;
}
