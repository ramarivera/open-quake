// @vitest-environment happy-dom
import { Option } from "effect";
import { act, createElement } from "react";
import { expect, it, vi } from "vitest";
import { builtinProfiles } from "../../../../../../../packages/device/src/profiles/profile-catalog";
import { stripLayout } from "../../strip/geometry";
import { useVoiceSurface } from "../../strip/overlays/voice/useVoiceSurface";
import { ClawBotInputTile } from "../../strip/tiles/clawBotInput/ClawBotInputTile";
import { click, element, mount } from "../dom-test";

it("MGMT-350 renders the shipped input payload and follows the selected assistant across profile resets", async () => {
	const profile = builtinProfiles("darwin").find((item) => item.id === "1-8");
	const page = profile?.pages[0];
	if (!profile || !page) throw Error("Missing shipped DKClaw profile");
	const layout = stripLayout(profile, page);
	const tile = (() => {
		const found = layout.tiles.find((item) => item.keyCode === "1,7");
		if (!found) throw Error("Missing ClawBotInput");
		return found;
	})();
	expect(tile.type).toBe("quakeBotInput");
	expect(tile.key.config).toMatchObject({
		size: [2, 2],
		display: true,
		icon: "0-130",
		actions: [],
		title: {
			text: "Agent input",
			pos: "top",
			size: 6,
			color: "#FFFFFF",
			display: true,
		},
	});
	expect(Option.getOrThrow(tile.key.compatibility)).toMatchObject({
		source: {
			config: {
				supportKnob: false,
				rtspUrl: "",
				httpProxyUrl: "",
				defaultIcon: "0-130",
			},
		},
	});
	let receive: (event: unknown) => void = () => {};
	const off = vi.fn();
	const request = vi.fn(async () => ({ _tag: "ok" }));
	window.quakeVoice = {
		request,
		onEvent: (listener) => {
			receive = listener;
			return off;
		},
	};
	function Consumer() {
		const voice = useVoiceSurface(layout);
		return createElement(ClawBotInputTile, {
			tile,
			context: {
				now: undefined,
				hourFormat: "24h",
				voice: {
					...voice.context,
					surface: "panel",
					motion: "reduce",
					wheelOpen: false,
				},
			},
		});
	}
	try {
		const view = await mount(createElement(Consumer));
		const emit = async (event: object) =>
			act(async () => receive({ serial: "SYNTHETIC", ...event }));
		await emit({ _tag: "KeyPress", keyCode: "1,5", action: "down" });
		await emit({
			_tag: "Stage",
			keyCode: "1,5",
			captureId: "capture-1",
			stage: {
				_tag: "recording",
				status: "listening",
				transcript: "First assistant",
			},
		});
		expect(element<HTMLTextAreaElement>("textarea").value).toBe(
			"First assistant",
		);
		await emit({ _tag: "KeyPress", keyCode: "1,6", action: "down" });
		await emit({
			_tag: "Stage",
			keyCode: "1,5",
			captureId: "capture-1",
			stage: {
				_tag: "recording",
				status: "listening",
				transcript: "Stale assistant",
			},
		});
		expect(element<HTMLTextAreaElement>("textarea").value).toBe(
			"First assistant",
		);
		await emit({
			_tag: "Stage",
			keyCode: "1,6",
			captureId: "capture-2",
			stage: { _tag: "processing", transcript: "Current assistant" },
		});
		expect(element<HTMLTextAreaElement>("textarea").value).toBe(
			"Current assistant",
		);
		await click(element(".clawbot-input-actions button"));
		expect(request).toHaveBeenCalledWith(
			expect.objectContaining({
				_tag: "SendText",
				keyCode: "1,6",
				message: "Current assistant",
			}),
		);
		await emit({ _tag: "Reset", reason: "profileChanged" });
		expect(element<HTMLTextAreaElement>("textarea").value).toBe("");
		await emit({
			_tag: "Stage",
			keyCode: "1,6",
			captureId: "capture-2",
			stage: { _tag: "processing", transcript: "Old profile text" },
		});
		expect(element<HTMLTextAreaElement>("textarea").value).toBe("");
		await view.unmount();
		expect(off).toHaveBeenCalledOnce();
	} finally {
		Reflect.deleteProperty(window, "quakeVoice");
	}
});
