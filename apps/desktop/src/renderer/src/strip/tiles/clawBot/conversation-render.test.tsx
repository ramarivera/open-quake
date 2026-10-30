// @vitest-environment happy-dom
import { Option } from "effect";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { VoiceSurfaceReply } from "../../../../../shared/voice-surface";
import { click, input, mount, query } from "../../../../test/dom";
import { initialVoiceView } from "../../overlays/voice/voice-state";
import {
	delta,
	started,
	tap,
	tileProps,
	turnId,
} from "../../render-test-fixtures";
import { ClawBotInputTile } from "../clawBotInput/ClawBotInputTile";
import { selectInput } from "../clawBotInput/input-state";
import { ClawBotTile } from "./ClawBotTile";
import { initialConversation, reduceConversation } from "./conversation";

let dom: Awaited<ReturnType<typeof mount>> | undefined;
afterEach(async () => {
	await dom?.close();
	dom = undefined;
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
const element = <T extends Element>(selector: string, type: { new (): T }) =>
	query(document, selector, type);
const advance = async (ms: number) =>
	act(async () => {
		vi.advanceTimersByTime(ms);
	});
const selected = {
	...initialVoiceView,
	input: selectInput(
		initialVoiceView.input,
		"1,5",
		Option.some("weather"),
		Option.some("Weather"),
	),
};

it("AI-188: repeated warning stays for exactly 1800ms after the latest action", async () => {
	vi.useFakeTimers();
	dom = await mount(
		<ClawBotInputTile
			{...tileProps("quakeBotInput", {
				view: initialVoiceView,
				surface: "panel",
			})}
		/>,
	);
	const send = element(".clawbot-input-button", HTMLButtonElement);
	await click(send);
	expect(element("[role=alert]", HTMLElement).textContent).toBe(
		"Please tap an AI assistant first!",
	);
	await advance(1700);
	await click(send);
	await advance(1799);
	expect(document.querySelector("[role=alert]")).not.toBeNull();
	await advance(1);
	expect(document.querySelector("[role=alert]")).toBeNull();
});

it("AI-181 AI-185 AI-189: selected header, cancelled picker, path append and confirmed send", async () => {
	vi.useFakeTimers();
	const request = vi.fn(
		async (): Promise<VoiceSurfaceReply> => ({ _tag: "files", paths: [] }),
	);
	dom = await mount(
		<ClawBotInputTile
			{...tileProps("quakeBotInput", { view: selected, request })}
		/>,
	);
	expect(element(".clawbot-input-title", HTMLElement).textContent).toBe(
		"Command input · Weather",
	);
	const box = element("textarea", HTMLTextAreaElement),
		attach = element(".clawbot-input-button:last-child", HTMLButtonElement),
		send = element(".clawbot-input-button", HTMLButtonElement);
	await input(box, "existing text");
	await click(attach);
	expect(box.value).toBe("existing text");
	request.mockResolvedValueOnce({
		_tag: "files",
		paths: ["/a one.txt", "/b.txt"],
	});
	await tap(attach);
	expect(box.value).toBe("existing text\n/a one.txt\n/b.txt");
	expect(request.mock.calls).toHaveLength(2);
	expect(attach.dataset.pressed).toBe("true");
	await advance(149);
	expect(attach.dataset.pressed).toBe("true");
	await advance(1);
	expect(attach.dataset.pressed).toBeUndefined();
	request.mockClear();
	request.mockResolvedValue({ _tag: "ok" });
	await tap(send, false);
	expect(request).not.toHaveBeenCalled();
	await tap(send);
	expect(request).toHaveBeenCalledExactlyOnceWith({
		_tag: "SendText",
		keyCode: "1,5",
		agentId: "weather",
		message: "existing text\n/a one.txt\n/b.txt",
	});
	expect(send.dataset.pressed).toBe("true");
	await advance(150);
	expect(send.dataset.pressed).toBeUndefined();
});

it("AI-181 AI-189: preview controls stay disabled even for injected sub-touch", async () => {
	const request = vi.fn();
	dom = await mount(
		<ClawBotInputTile
			{...tileProps("quakeBotInput", { request, surface: "preview" })}
		/>,
	);
	expect(element(".clawbot-input-title", HTMLElement).textContent).toBe(
		"Command input",
	);
	for (const button of document.querySelectorAll<HTMLButtonElement>(
		".clawbot-input-button",
	)) {
		expect(button.disabled).toBe(true);
		await tap(button);
		await click(button);
	}
	expect(request).not.toHaveBeenCalled();
});

it.each(["exec", "web_search", "generic"])(
	"AI-178 AI-179 SCREEN-129: mounted %s tool phases and preview",
	async (name) => {
		let conversation = reduceConversation(initialConversation, started(), 0);
		const tool = {
			_tag: "Tool" as const,
			serial: "QK",
			keyCode: "1,5",
			turnId,
			toolCallId: "call",
			name,
			args: JSON.stringify(
				name === "web_search"
					? { query: "inert query" }
					: { command: "echo inert" },
			),
			phase: "start" as const,
		};
		conversation = reduceConversation(conversation, tool, 1);
		dom = await mount(null);
		const show = () =>
			dom?.render(
				<ClawBotTile
					{...tileProps("quakeBot", {
						view: { ...initialVoiceView, conversation },
					})}
				/>,
			);
		await show();
		const button = element(".clawbot-tool-row", HTMLButtonElement);
		expect(button.textContent).toContain("Running");
		expect(button.disabled).toBe(name === "generic");
		await click(button);
		expect(document.querySelector(".clawbot-tool-preview") !== null).toBe(
			name !== "generic",
		);
		if (name !== "generic") {
			expect(
				element(".clawbot-tool-preview", HTMLElement).textContent,
			).toContain("inert");
			await tap(button, false);
			expect(button.getAttribute("aria-expanded")).toBe("true");
			await tap(button);
			expect(button.getAttribute("aria-expanded")).toBe("false");
		}
		conversation = reduceConversation(conversation, delta("later answer"), 2);
		await show();
		expect(button.textContent).toContain("Done");
		conversation = reduceConversation(
			conversation,
			{ ...tool, phase: "error" },
			3,
		);
		await show();
		expect(document.querySelectorAll(".clawbot-tool")).toHaveLength(1);
		expect(button.textContent).toContain("Failed");
	},
);
