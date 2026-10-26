// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type {
	VoiceSurfaceEvent,
	VoiceSurfaceReply,
	VoiceSurfaceRequest,
} from "../../../../../shared/voice-surface";
import { mount, query } from "../../../../test/dom";
import {
	clawLayout,
	copilotLayout,
	delta,
	sessionId,
	started,
	tap,
	tileProps,
	turnId,
} from "../../render-test-fixtures";
import { AiCopilotTile } from "../../tiles/aiCopilot/AiCopilotTile";
import { ClawBotTile } from "../../tiles/clawBot/ClawBotTile";
import { VoiceKeyTile } from "../../tiles/voiceKey/VoiceKeyTile";
import { type StripLocale, stripText } from "./strings";
import { useVoiceSurface } from "./useVoiceSurface";
import { StripToasts, VoiceOverlay } from "./VoiceOverlay";

let dom: Awaited<ReturnType<typeof mount>> | undefined;
let receive: (event: unknown) => void = () => {};
let reply: VoiceSurfaceReply = { _tag: "ok" };
const request = vi.fn(async (_value: VoiceSurfaceRequest) => reply);
afterEach(async () => {
	await dom?.close();
	dom = undefined;
	Reflect.deleteProperty(window, "quakeVoice");
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
const element = <T extends Element>(selector: string, type: { new (): T }) =>
	query(document, selector, type);
const advance = async (ms: number) =>
	act(async () => {
		vi.advanceTimersByTime(ms);
	});
const send = async (event: VoiceSurfaceEvent) =>
	act(async () => {
		receive(event);
	});
const stage = (
	keyCode: string,
	value: Extract<VoiceSurfaceEvent, { _tag: "Stage" }>["stage"],
): VoiceSurfaceEvent => ({
	_tag: "Stage",
	serial: "QK",
	keyCode,
	captureId: "capture",
	stage: value,
});
function Consumers({
	locale = "en",
	motion = "reduce",
	overlay = false,
}: {
	locale?: StripLocale;
	motion?: "full" | "reduce";
	overlay?: boolean;
}) {
	const voice = useVoiceSurface(overlay ? clawLayout : copilotLayout);
	return (
		<>
			<AiCopilotTile
				{...tileProps("aiChatView", { ...voice.context, locale, motion })}
			/>
			<ClawBotTile
				{...tileProps("quakeBot", { ...voice.context, locale, motion })}
			/>
			{copilotLayout.tiles
				.filter((t) => t.type === "aiChat")
				.map((tile) => (
					<VoiceKeyTile
						key={tile.keyCode}
						tile={tile}
						context={{
							now: undefined,
							hourFormat: "24h",
							voice: {
								...voice.context,
								surface: "panel",
								locale,
								motion,
								wheelOpen: false,
							},
						}}
					/>
				))}
			{overlay ? (
				<VoiceOverlay view={voice.view} locale={locale} motion={motion} />
			) : null}
			<StripToasts view={voice.view} locale={locale} />
		</>
	);
}
async function open(node: React.ReactNode) {
	Object.defineProperty(window, "quakeVoice", {
		configurable: true,
		value: {
			onEvent: (callback: (event: unknown) => void) => {
				receive = callback;
				return () => {};
			},
			request,
		},
	});
	reply = { _tag: "ok" };
	dom = await mount(node);
	return dom;
}

it("AI-196: hint advances at 100ms, wraps, resets on locale and stops in reduced motion", async () => {
	vi.useFakeTimers();
	const screen = await open(<Consumers motion="full" />);
	const lit = () =>
		[...document.querySelectorAll(".copilot-hint span span")].findIndex((el) =>
			el.hasAttribute("data-lit"),
		);
	expect(lit()).toBe(0);
	await advance(99);
	expect(lit()).toBe(0);
	await advance(1);
	expect(lit()).toBe(1);
	await advance(
		100 * (stripText("en", "aiIconViewTxt.pushToTalkHint").length - 1),
	);
	expect(lit()).toBe(0);
	await advance(100);
	await screen.render(<Consumers locale="de" motion="full" />);
	expect(lit()).toBe(0);
	expect(element(".copilot-hint", HTMLElement).textContent).toBe(
		stripText("de", "aiIconViewTxt.pushToTalkHint"),
	);
	await screen.render(<Consumers locale="de" motion="reduce" />);
	await advance(1000);
	expect(lit()).toBe(-1);
});

it.each(["text", "cancelled", "completed", "profile"] as const)(
	"AI-197: active cancel decoration disappears on %s",
	async (finish) => {
		await open(<Consumers />);
		await send({
			_tag: "KeyPress",
			serial: "QK",
			keyCode: "1,6",
			action: "down",
		});
		await send(stage("1,6", { _tag: "recording", status: "speaking" }));
		await send({
			_tag: "KeyPress",
			serial: "QK",
			keyCode: "1,6",
			action: "up",
		});
		expect(document.querySelectorAll(".voice-cancel-indicator")).toHaveLength(
			1,
		);
		expect(element(".copilot-cancel-title", HTMLElement).textContent).not.toBe(
			"",
		);
		if (finish === "profile")
			await send({ _tag: "Reset", serial: "QK", reason: "profileChanged" });
		else if (finish === "text") await send(delta("answer", 0, "1,6"));
		else
			await send({
				_tag: "Chunk",
				serial: "QK",
				keyCode: "1,6",
				chunk: {
					version: 1,
					sessionId,
					turnId,
					seq: 0,
					type: "end",
					outcome: finish,
				},
			});
		expect(document.querySelector(".voice-cancel-indicator")).toBeNull();
		expect(document.querySelector(".copilot-cancel")).toBeNull();
	},
);

it.each(["en", "de"] as const)(
	"AI-191 AI-198: %s copy uses one effective gesture and reports accepted/rejected replies",
	async (locale) => {
		await open(<Consumers locale={locale} />);
		expect(document.querySelector(".copilot-copy")).toBeNull();
		await send(delta("  \n ", 0, "1,6"));
		expect(document.querySelector(".copilot-copy")).toBeNull();
		await send(delta(" first \n second ", 1, "1,6"));
		const copy = element(".copilot-copy", HTMLButtonElement);
		expect(element(".copilot-text", HTMLElement).textContent).toBe(
			"  \n  first \n second ",
		);
		await tap(copy, false);
		expect(request).not.toHaveBeenCalled();
		await tap(copy);
		expect(request).toHaveBeenCalledExactlyOnceWith({
			_tag: "CopyText",
			text: "  \n  first \n second ",
		});
		expect(element("[role=status]", HTMLElement).textContent).toBe(
			stripText(locale, "clipboard.copySuccess"),
		);
		reply = { _tag: "rejected", code: "VOICE.SURFACE.REQUEST_FAILED" };
		await tap(copy);
		expect(request).toHaveBeenCalledTimes(2);
		expect(element("[role=status]", HTMLElement).textContent).toBe(
			stripText(locale, "clipboard.copyFailed"),
		);
	},
);

it.each(["full", "reduce"] as const)(
	"AI-199: %s busy notice replacement expires at exactly 3000ms",
	async (motion) => {
		vi.useFakeTimers();
		await open(<Consumers motion={motion} />);
		await send({
			_tag: "Toast",
			serial: "QK",
			messageKey: "aiIconViewTxt.busyToast",
		});
		await advance(2000);
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
		expect(document.querySelectorAll(".voice-toast")).toHaveLength(1);
		expect(element(".voice-toast", HTMLElement).textContent).toBe(
			stripText("en", "aiAudio.prevTurnBusy"),
		);
		await advance(2999);
		expect(document.querySelector(".voice-toast")).not.toBeNull();
		await advance(1);
		expect(document.querySelector(".voice-toast")).toBeNull();
	},
);

it.each(["en", "zh", "de", "es", "fr", "it", "ja", "ko"] as const)(
	"AI-204 AI-208 SCREEN-115: %s knob answers stay in conversation across locale/terminal changes",
	async (locale) => {
		const screen = await open(<Consumers locale={locale} overlay />);
		await send(stage("0,1", { _tag: "processing" }));
		expect(element(".voice-subtitle", HTMLElement).textContent).toBe(
			stripText(locale, "aiAudio.processing"),
		);
		await send(started("0,1", "voice"));
		await send(delta("answer", 0, "0,1"));
		expect(element(".voice-subtitle", HTMLElement).textContent).not.toContain(
			"answer",
		);
		await screen.render(
			<Consumers locale={locale === "en" ? "de" : "en"} overlay />,
		);
		await send(delta(" text", 1, "0,1"));
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
				outcome: "cancelled",
			},
		});
		await send(delta(" LATE", 3, "0,1"));
		expect(document.querySelector(".voice-backdrop")).toBeNull();
		expect(
			[...document.querySelectorAll(".clawbot-bubble")].filter(
				(el) => el.textContent === "answer text",
			),
		).toHaveLength(1);
		expect(element(".clawbot-messages", HTMLElement).textContent).not.toContain(
			"LATE",
		);
	},
);

it("SCREEN-020 SCREEN-120: unknown fallback is escaped, defaults to warning, expires at 3000ms and leaves a newer capture running", async () => {
	vi.useFakeTimers();
	await open(<Consumers overlay />);
	await send({
		_tag: "Toast",
		serial: "QK",
		messageKey: "unknown.translation",
		fallback: "<strong>Long warning</strong>",
	});
	expect(element(".voice-toast", HTMLElement).dataset.type).toBe("warning");
	expect(element(".voice-toast-text", HTMLElement).textContent).toBe(
		"<strong>Long warning</strong>",
	);
	expect(document.querySelector(".voice-toast strong")).toBeNull();
	await send(stage("0,1", { _tag: "recording", status: "listening" }));
	await advance(2999);
	expect(document.querySelector(".voice-toast")).not.toBeNull();
	await advance(1);
	expect(document.querySelector(".voice-toast")).toBeNull();
	expect(element(".voice-backdrop", HTMLElement).dataset.phase).toBe(
		"listening",
	);
	await send({
		_tag: "Toast",
		serial: "QK",
		messageKey: "aiAudio.prevTurnBusy",
		fallback: "wrong",
		type: "error",
	});
	expect(element(".voice-toast", HTMLElement).getAttribute("role")).toBe(
		"alert",
	);
	expect(element(".voice-toast-text", HTMLElement).textContent).toBe(
		stripText("en", "aiAudio.prevTurnBusy"),
	);
});

it.each(["full", "reduce"] as const)(
	"SCREEN-112 SCREEN-113 SCREEN-119: %s real silent/low/high energy and processing stay bounded for knob and grid",
	async (motion) => {
		const screen = await open(<Consumers overlay motion={motion} />);
		for (const keyCode of ["0,1", "1,5"]) {
			await send(
				stage(keyCode, {
					_tag: "recording",
					status: "listening",
					transcript: "long ".repeat(800),
				}),
			);
			for (const rms of [0, 0.1, 0.9]) {
				await send({
					_tag: "Level",
					serial: "QK",
					keyCode,
					captureId: "capture",
					rms,
					speaking: rms > 0,
				});
				const ring = element(".copilot-presence", HTMLElement);
				expect(ring.dataset.energy).toBe(String(rms));
				expect(ring.dataset.phase).toBe("listening");
				expect(ring.dataset.motion).toBe(motion);
				expect(element(".voice-canvas", HTMLCanvasElement).style.width).toBe(
					"1920px",
				);
				expect(element(".voice-canvas", HTMLCanvasElement).style.height).toBe(
					"72px",
				);
			}
			expect(document.querySelectorAll(".voice-backdrop")).toHaveLength(
				keyCode === "0,1" ? 1 : 0,
			);
			expect(
				element(".voice-marquee-line", HTMLElement).textContent?.length,
			).toBeGreaterThan(1000);
			await send(stage(keyCode, { _tag: "processing" }));
			expect(element(".copilot-presence", HTMLElement).dataset.energy).toBe(
				"0",
			);
			expect(document.querySelector(".voice-canvas")).toBeNull();
			await send(stage(keyCode, { _tag: "idle", outcome: "cancelled" }));
		}
		await screen.render(<Consumers overlay motion="reduce" />);
		expect(element(".copilot-presence", HTMLElement).dataset.phase).toBe(
			"idle",
		);
	},
);
