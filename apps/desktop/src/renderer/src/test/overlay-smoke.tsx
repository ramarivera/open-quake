import { act } from "react";
import type { VoiceSurfaceEvent } from "../../../shared/voice-surface";
import { type StripLocale, stripText } from "../strip/overlays/voice/strings";
import { useVoiceSurface } from "../strip/overlays/voice/useVoiceSurface";
import {
	StripToasts,
	VoiceOverlay,
} from "../strip/overlays/voice/VoiceOverlay";
import {
	clawLayout,
	delta,
	element,
	mount,
	sessionId,
	started,
	tileProps,
	turnId,
} from "../strip/render-test-fixtures";
import { ClawBotTile } from "../strip/tiles/clawBot/ClawBotTile";
import { delay, locales, stage } from "./smoke-fixtures";

const nativeRequire: NodeJS.Require = globalThis.require;
const assert: typeof import("node:assert/strict") =
	nativeRequire("node:assert/strict");
function VoiceConsumers({
	locale = "en",
	motion = "reduce",
}: {
	locale?: StripLocale;
	motion?: "full" | "reduce";
}) {
	const voice = useVoiceSurface(clawLayout);
	return (
		<>
			<ClawBotTile
				{...tileProps("quakeBot", {
					...voice.context,
					locale,
					motion,
				})}
			/>
			<VoiceOverlay view={voice.view} locale={locale} motion={motion} />
			<StripToasts view={voice.view} locale={locale} />
		</>
	);
}
export async function overlaySmoke() {
	let passed = 0;
	for (const locale of locales) {
		for (const motion of (locale === "de"
			? ["full", "reduce"]
			: ["reduce"]) as readonly ("full" | "reduce")[]) {
			document.documentElement.dataset.motion = motion;
			let receive: (event: unknown) => void = () => {};
			Object.defineProperty(window, "quakeVoice", {
				configurable: true,
				value: {
					onEvent: (callback: (event: unknown) => void) => {
						receive = callback;
						return () => {};
					},
					request: async () => ({ _tag: "ok" }),
				},
			});
			const mounted = await mount(
					<VoiceConsumers locale={locale} motion={motion} />,
				),
				send = async (event: VoiceSurfaceEvent) =>
					act(async () => {
						receive(event);
					});
			try {
				for (const [status, key] of [
					["preparing", "aiAudio.preparingRecord"],
					["listening", "aiAudio.speakNow"],
					["recording", "aiAudio.recording"],
					["speaking", "aiAudio.recording"],
				] as const) {
					await send({ _tag: "Reset", serial: "QK", reason: "profileChanged" });
					await send(stage("0,1", { _tag: "recording", status }));
					assert.equal(
						element(".voice-subtitle").textContent,
						stripText(locale, key),
					);
					passed++;
				}
				await send(stage("0,1", { _tag: "idle", outcome: "completed" }));
				assert.equal(document.querySelector(".voice-backdrop"), null);
				await send(stage("0,1", { _tag: "processing" }));
				const sheet = element(".voice-backdrop");
				assert.equal(sheet.clientWidth, 1920);
				assert.equal(sheet.clientHeight, 480);
				assert.equal(
					getComputedStyle(sheet).backgroundColor,
					"rgba(11, 12, 13, 0.95)",
				);
				assert.equal(
					element(".voice-subtitle").textContent,
					stripText(locale, "aiAudio.processing"),
				);
				assert(
					parseFloat(getComputedStyle(element(".voice-subtitle")).fontSize) >=
						40,
				);
				await send({ _tag: "Reset", serial: "QK", reason: "profileChanged" });
				await send(
					stage("0,1", {
						_tag: "recording",
						status: "speaking",
						transcript: "long transcript ".repeat(100),
					}),
				);
				const subtitle = element(".voice-subtitle");
				assert(
					subtitle.getBoundingClientRect().right <=
						element(".voice-backdrop").getBoundingClientRect().right,
				);
				assert.equal(
					getComputedStyle(element(".voice-marquee-line")).animationName,
					motion === "reduce" ? "none" : "voice-marquee",
				);
				assert.equal(getComputedStyle(subtitle).overflow, "hidden");
				passed++;
				await send({
					_tag: "Toast",
					serial: "QK",
					messageKey: "aiIconViewTxt.busyToast",
				});
				assert.equal(
					element(".voice-toast-text").textContent,
					stripText(locale, "aiIconViewTxt.busyToast"),
				);
				assert.equal(
					getComputedStyle(element(".voice-toast")).backgroundColor,
					"rgb(30, 33, 36)",
				);
				assert(
					parseFloat(getComputedStyle(element(".voice-toast-text")).fontSize) >=
						24,
				);
				assert(
					element(".voice-toast-icon").getBoundingClientRect().width >= 28,
				);
				passed++;
				if (locale === "de") {
					await act(async () => {
						await delay(2000);
					});
					await send({
						_tag: "Toast",
						serial: "QK",
						messageKey: "aiAudio.prevTurnBusy",
					});
					await send({
						_tag: "Toast",
						serial: "QK",
						messageKey: "aiAudio.prevTurnBusy",
					});
					assert.equal(document.querySelectorAll(".voice-toast").length, 1);
					await act(async () => {
						await delay(500);
					});
					assert(document.querySelector(".voice-toast"));
					await act(async () => {
						await delay(2550);
					});
					assert.equal(document.querySelector(".voice-toast"), null);
					passed++;
				}
				for (const outcome of ["completed", "cancelled"] as const) {
					await send({ _tag: "Reset", serial: "QK", reason: "profileChanged" });
					await send(
						stage("0,1", {
							_tag: "recording",
							status: "speaking",
							transcript: "knob question",
						}),
					);
					await send(started("0,1", "voice"));
					await send(delta("answer", 0, "0,1"));
					await send(delta(" text", 1, "0,1"));
					assert(!element(".voice-subtitle").textContent?.includes("answer"));
					await send(stage("0,1", { _tag: "idle", outcome: "completed" }));
					await send({
						_tag: "Chunk",
						serial: "QK",
						keyCode: "0,1",
						chunk: {
							version: 1,
							sessionId,
							turnId,
							seq: 2,
							type: "end",
							outcome,
						},
					});
					await send(delta(" LATE", 3, "0,1"));
					assert.equal(document.querySelector(".voice-backdrop"), null);
					assert.equal(
						[...document.querySelectorAll(".clawbot-bubble")].filter(
							(el) => el.textContent === "answer text",
						).length,
						1,
					);
					assert(!element(".clawbot-messages").textContent?.includes("LATE"));
					passed++;
				}
			} finally {
				await mounted.unmount();
				Reflect.deleteProperty(window, "quakeVoice");
			}
		}
	}
	return passed;
}
