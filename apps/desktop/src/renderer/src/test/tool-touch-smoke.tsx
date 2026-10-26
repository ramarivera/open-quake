import { act } from "react";
import type { QuakeEvent } from "../../../preload/quake";
import { mountStripTouch } from "../strip/mount-strip-touch";
import { initialVoiceView } from "../strip/overlays/voice/voice-state";
import {
	clawLayout,
	element,
	mount,
	started,
	tileProps,
	turnId,
} from "../strip/render-test-fixtures";
import { ClawBotTile } from "../strip/tiles/clawBot/ClawBotTile";
import {
	initialConversation,
	reduceConversation,
} from "../strip/tiles/clawBot/conversation";

const nativeRequire: NodeJS.Require = globalThis.require;
const assert: typeof import("node:assert/strict") =
	nativeRequire("node:assert/strict");
export async function toolTouchSmoke() {
	let conversation = reduceConversation(
		initialConversation,
		started(),
		Date.now(),
	);
	for (const toolCallId of ["first", "second"]) {
		conversation = reduceConversation(
			conversation,
			{
				_tag: "Tool",
				serial: "QK",
				keyCode: "1,5",
				turnId,
				toolCallId,
				name: "exec",
				args: JSON.stringify({ command: "echo first\necho second" }),
				phase: "start",
			},
			Date.now(),
		);
	}
	conversation = {
		...conversation,
		groups: conversation.groups.filter((group) => group.kind === "agent"),
	};
	const props = tileProps("quakeBot", {
			view: { ...initialVoiceView, conversation },
		}),
		tile = { ...props.tile, hasTouchableSubElements: true };
	const screen = await mount(
		<div
			data-state="tile"
			data-key-code={tile.keyCode}
			style={{
				position: "absolute",
				left: tile.slot.x,
				top: tile.slot.y,
				width: tile.slot.width,
				height: tile.slot.height,
			}}
		>
			<ClawBotTile {...props} />
		</div>,
	);
	let receive: (event: QuakeEvent) => void = () => {};
	const dispose = mountStripTouch(
		screen.host,
		{
			version: "fixture",
			onQuakeEvent: (callback) => {
				receive = callback;
				return () => {};
			},
		},
		0,
		() => ({ ...clawLayout, tiles: [tile] }),
	);
	const touch = async (target: Element) => {
		const rect = target.getBoundingClientRect(),
			root = screen.host.getBoundingClientRect(),
			x = rect.left - root.left + rect.width / 2,
			y = rect.top - root.top + rect.height / 2;
		const viewport = element(".clawbot-messages").getBoundingClientRect();
		assert(
			rect.top >= viewport.top && rect.bottom <= viewport.bottom,
			"tool button must be fully visible",
		);
		assert(y < 480);
		await act(async () => {
			receive({
				source: "mock",
				kind: "touch",
				points: [{ action: 1, x, y: 480 - y }],
			});
			receive({
				source: "mock",
				kind: "touch",
				points: [{ action: 0, x, y: 480 - y }],
			});
		});
	};
	try {
		const first = element('[data-quake-sub-touch="tool-first"]'),
			second = element('[data-quake-sub-touch="tool-second"]');
		const before = second.getBoundingClientRect().top;
		await touch(first);
		assert.equal(first.getAttribute("aria-expanded"), "true");
		assert(second.getBoundingClientRect().top > before);
		// Resolve the moved target through the real DOM registry and controller, not a custom event shortcut.
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		await touch(second);
		assert.equal(
			second.getAttribute("aria-expanded"),
			"true",
			"moved second tool resolves through the DOM touch registry",
		);
		assert.equal(first.getAttribute("aria-expanded"), "true");
		await touch(first);
		assert.equal(first.getAttribute("aria-expanded"), "false");
		return 1;
	} finally {
		dispose();
		await screen.unmount();
	}
}
