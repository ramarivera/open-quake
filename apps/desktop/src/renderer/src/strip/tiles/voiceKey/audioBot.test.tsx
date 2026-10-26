// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { Schema } from "effect";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { validateAction } from "../../../../../../../../packages/device/src/actions/action-invariants";
import { createActionDraft } from "../../../../../../../../packages/device/src/actions/action-registry";
import { ProfileKey } from "../../../../../../../../packages/device/src/profiles/profile-contracts";
import { mount, query } from "../../../../test/dom";
import { VolumeCapsule } from "../../overlays/knob/VolumeCapsule";
import { tap, tileProps } from "../../render-test-fixtures";
import { AudioBotSettings } from "./AudioBotSettings";
import { AudioBotTile } from "./AudioBotTile";
import { readerSettings } from "./reader-settings";

let dom: Awaited<ReturnType<typeof mount>> | undefined;
afterEach(async () => {
	await dom?.close();
	dom = undefined;
	vi.useRealTimers();
});
const button = () => query(document, ".audio-bot-key", HTMLButtonElement);
const fixture = () => {
	const props = tileProps("aiChat");
	const key = Schema.decodeUnknownSync(ProfileKey)({
		...Schema.encodeSync(ProfileKey)(props.tile.key),
		childrenName: "audioBot",
		config: {
			...Schema.encodeSync(ProfileKey)(props.tile.key).config,
			...createActionDraft("audioBot"),
		},
	});
	return { ...props, tile: { ...props.tile, type: "audioBot", key } };
};
it("KNOB-073 MGMT-149 WIDGETS-015: saved default agent/model round-trip, release toggle dedupes click, real phase replaces the idle artwork", async () => {
	const props = fixture();
	expect(
		validateAction(
			"audioBot",
			Schema.encodeSync(ProfileKey)(props.tile.key).config,
		)._tag,
	).toBe("Right");
	expect(props.tile.key.config.actions).toEqual([
		{ type: "agentId", value: "default" },
		{ type: "ttsEngine", value: "qwen" },
		{ type: "modeltype", value: "qwen-audio-3.1-tts-flash" },
	]);
	const request = vi.fn(
		async (
			_input: import("../../../../../shared/voice-surface").VoiceSurfaceRequest,
		) => ({ _tag: "ok" as const }),
	);
	const voice = { ...props.context.voice, request };
	dom = await mount(
		<AudioBotTile {...props} context={{ ...props.context, voice }} />,
	);
	await tap(button());
	await act(async () => {
		button().click();
	});
	expect(request).toHaveBeenCalledTimes(1);
	expect(request.mock.calls[0]?.[0]).toMatchObject({
		_tag: "ToggleReader",
		settings: { engine: "qwen" },
	});
	for (const [phase, bars] of [
		["thinking", 3],
		["speaking", 7],
		["idle", 0],
	] as const) {
		const view = {
			...voice.view,
			readAloud: new Map([
				[
					props.tile.keyCode,
					{
						_tag: "ReadAloudState" as const,
						serial: "QK",
						keyCode: props.tile.keyCode,
						sessionId: "reader/1",
						phase,
					},
				],
			]),
		};
		await dom.render(
			<AudioBotTile
				{...props}
				context={{ ...props.context, voice: { ...voice, view } }}
			/>,
		);
		expect(button().dataset.phase).toBe(phase);
		expect(document.querySelectorAll(".audio-bot-state i")).toHaveLength(bars);
	}
	await dom.render(
		<AudioBotTile
			{...props}
			context={{ ...props.context, voice: { ...voice, surface: "preview" } }}
		/>,
	);
	await tap(button());
	await act(async () => {
		button().click();
	});
	expect(request).toHaveBeenCalledTimes(1);
});

it("MGMT-301: engine settings preserve agent/model and portable local parameters", async () => {
	let key = fixture().tile.key;
	const change = (next: ProfileKey) => {
		key = next;
	};
	dom = await mount(
		<AudioBotSettings keyValue={key} locale="de" onChange={change} />,
	);
	const select = query(document, "select", HTMLSelectElement);
	await act(async () => {
		select.value = "webSpeech";
		select.dispatchEvent(new Event("change", { bubbles: true }));
	});
	await dom.render(
		<AudioBotSettings keyValue={key} locale="de" onChange={change} />,
	);
	expect(readerSettings(key.config.actions).engine).toBe("webSpeech");
	expect(
		key.config.actions.filter(
			(a) => a.type === "agentId" || a.type === "modeltype",
		),
	).toEqual(
		fixture().tile.key.config.actions.filter(
			(a) => a.type === "agentId" || a.type === "modeltype",
		),
	);
	expect(document.querySelectorAll("input")).toHaveLength(4);
	expect(
		readerSettings([
			...key.config.actions,
			{ type: "ttsRate", value: 99 },
			{ type: "ttsPitch", value: -2 },
			{ type: "ttsVolume", value: "no" },
		]),
	).toMatchObject({ rate: 2, pitch: 0, volume: 1 });
	expect(
		Schema.decodeUnknownSync(ProfileKey)(Schema.encodeSync(ProfileKey)(key))
			.config.actions,
	).toEqual(key.config.actions);
});

it("SCREEN-118: volume states, 600ms synthetic duplicate guard and inert management preview", async () => {
	vi.useFakeTimers();
	const toggle = vi.fn();
	for (const phase of [
		"inactive",
		"activating",
		"active",
		"unavailable",
	] as const) {
		const node = (
			<VolumeCapsule
				volume={{ phase, level: 42, muted: false }}
				toggle={toggle}
			/>
		);
		if (dom) await dom.render(node);
		else dom = await mount(node);
		const capsule = query(document, "button", HTMLButtonElement);
		expect(capsule.dataset.phase).toBe(phase);
		expect(capsule.disabled).toBe(
			phase === "activating" || phase === "unavailable",
		);
		expect(capsule.getAttribute("aria-pressed")).toBe(
			String(phase === "active"),
		);
	}
	await dom?.render(
		<VolumeCapsule
			volume={{ phase: "inactive", level: 42, muted: false }}
			toggle={toggle}
		/>,
	);
	const capsule = query(document, "button", HTMLButtonElement);
	await tap(capsule);
	await act(async () => {
		capsule.click();
	});
	expect(toggle).toHaveBeenCalledTimes(1);
	await act(async () => {
		vi.advanceTimersByTime(600);
		capsule.click();
	});
	expect(toggle).toHaveBeenCalledTimes(2);
	await dom?.render(
		<VolumeCapsule
			volume={{ phase: "active", level: 42, muted: false }}
			toggle={toggle}
			readOnly
		/>,
	);
	await tap(capsule);
	await act(async () => {
		capsule.click();
	});
	expect(toggle).toHaveBeenCalledTimes(2);
	expect(capsule.dataset.phase).toBe("inactive");
	const css = readFileSync(
		"src/renderer/src/strip/overlays/knob/knob.css",
		"utf8",
	);
	expect(css).toContain("left: 1471px;");
	expect(css).toContain("top: 355px;");
	expect(css).toContain("width: 380px;");
	expect(css).toContain("height: 88px;");
});
