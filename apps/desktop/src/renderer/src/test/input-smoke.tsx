import { Option } from "effect";
import { act } from "react";
import type {
	VoiceSurfaceReply,
	VoiceSurfaceRequest,
} from "../../../shared/voice-surface";
import { initialVoiceView } from "../strip/overlays/voice/voice-state";
import {
	click,
	element,
	mount,
	tap,
	tileProps,
	type,
} from "../strip/render-test-fixtures";
import { ClawBotTile } from "../strip/tiles/clawBot/ClawBotTile";
import { ClawBotInputTile } from "../strip/tiles/clawBotInput/ClawBotInputTile";
import {
	inputScale,
	selectInput,
} from "../strip/tiles/clawBotInput/input-state";
import { delay, rendered, view } from "./smoke-fixtures";

const nativeRequire: NodeJS.Require = globalThis.require;
const { ipcRenderer }: typeof import("electron") = nativeRequire("electron");
const assert: typeof import("node:assert/strict") =
	nativeRequire("node:assert/strict");
export async function inputSmoke() {
	let passed = 0;
	const selected = {
		...initialVoiceView,
		input: selectInput(
			initialVoiceView.input,
			"1,5",
			Option.some("weather"),
			Option.some("Weather"),
		),
	};
	const calls: VoiceSurfaceRequest[] = [];
	let reply: VoiceSurfaceReply = { _tag: "files", paths: [] };
	const request = async (value: VoiceSurfaceRequest) => {
		calls.push(value);
		return reply;
	};
	const screen = await mount(null);
	const show = async (voice: Parameters<typeof tileProps>[1] = {}) =>
		screen.render(
			<ClawBotInputTile
				{...tileProps("quakeBotInput", { view: selected, request, ...voice })}
			/>,
		);
	try {
		await show();
		const tile = tileProps("quakeBotInput").tile,
			s = inputScale(tile.box.width, tile.box.height);
		assert.equal(
			element(".clawbot-input-title").textContent,
			"Command Input · Weather",
		);
		assert(
			Math.abs(
				element(".clawbot-input-header").getBoundingClientRect().height -
					52 * s,
			) < 0.1,
		);
		for (const button of document.querySelectorAll(".clawbot-input-button"))
			assert(button.getBoundingClientRect().height >= 48 * s - 1);
		const box = element<HTMLTextAreaElement>("textarea");
		await type(box, "existing text");
		await click(element<HTMLButtonElement>(".clawbot-input-button:last-child"));
		assert.equal(box.value, "existing text");
		reply = { _tag: "files", paths: ["/a one.txt", "/b.txt"] };
		await tap(element(".clawbot-input-button:last-child"));
		assert.equal(box.value, "existing text\n/a one.txt\n/b.txt");
		assert.deepEqual(calls, [{ _tag: "PickFiles" }, { _tag: "PickFiles" }]);
		passed++;
		await show({ view: initialVoiceView, surface: "preview" });
		assert.equal(element(".clawbot-input-title").textContent, "Command Input");
		for (const button of document.querySelectorAll<HTMLButtonElement>(
			".clawbot-input-button",
		))
			assert(button.disabled);
		passed++;
		await show({ view: initialVoiceView });
		const send = element<HTMLButtonElement>(".clawbot-input-button");
		await click(send);
		assert.equal(
			element("[role=alert]").textContent,
			"Please tap an AI assistant first!",
		);
		assert.equal(
			getComputedStyle(element("[role=alert]")).backdropFilter,
			"none",
		);
		await act(async () => {
			await delay(1700);
		});
		await click(send);
		await act(async () => {
			await delay(500);
		});
		assert(document.querySelector("[role=alert]"));
		await act(async () => {
			await delay(1350);
		});
		assert.equal(document.querySelector("[role=alert]"), null);
		passed++;
		reply = { _tag: "ok" };
		calls.length = 0;
		await show();
		await type(box, " first ");
		await click(send);
		assert.deepEqual(calls, [
			{
				_tag: "SendText",
				keyCode: "1,5",
				agentId: "weather",
				message: "first",
			},
		]);
		await type(box, "second");
		await tap(send, false);
		assert.equal(calls.length, 1);
		await tap(send);
		assert.equal(calls.length, 2);
		assert.equal(send.dataset.pressed, "true");
		await act(async () => {
			await delay(170);
		});
		assert.equal(send.dataset.pressed, undefined);
		passed++;
		for (const locale of ["en", "de"] as const) {
			await screen.render(
				<>
					<ClawBotTile
						{...tileProps("quakeBot", {
							locale,
							view: view(
								rendered(
									"## Offline conversation\n\n- **Behavioral coverage**\n- Safe tool previews",
								),
							),
						})}
					/>
					<div style={{ position: "absolute", left: 960, top: 0 }}>
						<ClawBotInputTile
							{...tileProps("quakeBotInput", { locale, view: selected })}
						/>
					</div>
				</>,
			);
			await delay(50);
			await ipcRenderer.invoke("conversation-smoke-capture", locale);
		}
	} finally {
		await screen.unmount();
	}
	return passed;
}
