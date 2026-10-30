import { SessionId, TurnId } from "@open-quake/edge/chat/contracts";
import { Option, Schema } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	copilotProfile,
	voiceFixtureEnvelope,
} from "../../../../../main/test/voice-fixtures";
import { ProfileEnvelope } from "../../../../../shared/profiles";
import type {
	VoiceStage,
	VoiceSurfaceEvent,
} from "../../../../../shared/voice-surface";
import { stripLayout } from "../../geometry";
import { selectStripPage } from "../../selection";
import {
	COPILOT_TIMEOUT_MS,
	type CopilotEvent,
	copilotLayout,
	copilotTone,
	initialCopilot,
	reduceCopilot,
} from "../../tiles/aiCopilot/copilot-state";
import { checkSend } from "../../tiles/clawBotInput/input-state";
import { stripText } from "./strings";
import { keyInfo } from "./useVoiceSurface";
import { StripToasts, VoiceOverlay } from "./VoiceOverlay";
import {
	cancelIndicatorKey,
	initialVoiceView,
	type KeyInfo,
	nextExpiry,
	reduceVoice,
	type VoiceAction,
	type VoiceView,
} from "./voice-state";

const sessionId = Schema.decodeUnknownSync(SessionId)(
	"00000000-0000-4000-8000-000000000001",
);
const turnId = Schema.decodeUnknownSync(TurnId)(
	"00000000-0000-4000-8000-000000000002",
);
const keys: ReadonlyMap<string, KeyInfo> = new Map([
	[
		"1,6",
		{ type: "aiChat", title: Option.some("Translate"), agentId: Option.none() },
	],
	[
		"1,5",
		{
			type: "clawbot",
			title: Option.some("Weather"),
			agentId: Option.some("weather"),
		},
	],
]);
const stage = (
	keyCode: string,
	value: VoiceStage,
	captureId = "c1",
): VoiceSurfaceEvent => ({
	_tag: "Stage",
	serial: "QK",
	keyCode,
	captureId,
	stage: value,
});
const key = (keyCode: string, action: "down" | "up"): VoiceSurfaceEvent => ({
	_tag: "KeyPress",
	serial: "QK",
	keyCode,
	action,
});
const chunk = (
	seq: number,
	body:
		| { type: "answer"; textDelta: string }
		| { type: "end"; outcome: "completed" | "failed"; errorCode?: string },
): VoiceSurfaceEvent => ({
	_tag: "Chunk",
	serial: "QK",
	keyCode: "1,6",
	chunk: { version: 1, sessionId, turnId, seq, ...body },
});
function play(
	events: readonly (VoiceSurfaceEvent | VoiceAction)[],
	start = initialVoiceView,
	at = 0,
): VoiceView {
	let view = start;
	let now = at;
	for (const item of events) {
		now += 10;
		const action: VoiceAction =
			item._tag === "countdown" ||
			item._tag === "expire" ||
			item._tag === "profileReset" ||
			item._tag === "toast" ||
			item._tag === "event"
				? item
				: { _tag: "event", event: item };
		view = reduceVoice(view, action, keys, now);
	}
	return view;
}
const statusOf = (view: VoiceView) =>
	Option.map(view.copilot.statusText, (text) =>
		text._tag === "string" ? text.key : text.code,
	);

describe("AI Copilot through the voice store", () => {
	it.each([undefined, "", " \t "])(
		"warns after selecting a ClawBot key with agentId %j",
		(agentId) => {
			const info = keyInfo({
				...copilotTile,
				type: "clawbot",
				key: {
					...copilotTile.key,
					config: {
						...copilotTile.key.config,
						type: "clawbot",
						actions:
							agentId === undefined
								? []
								: [{ type: "agentId", value: agentId }],
					},
				},
			});
			const view = reduceVoice(
				initialVoiceView,
				{ _tag: "event", event: key("1,5", "down") },
				new Map([["1,5", info]]),
				0,
			);
			expect(view.input.keyCode).toEqual(Option.some("1,5"));
			expect(view.input.agentId).toEqual(Option.none());
			expect(checkSend(view.input, "Keep my draft")).toEqual({
				_tag: "warn",
				key: "quakeBotInputIconView.warnings.selectAssistant",
			});
			expect(
				Option.map(view.conversation.activeAgent, (agent) => agent.id),
			).toEqual(Option.some("default"));
		},
	);

	it("keeps voice A's ownership and authoritative prompt when typed-only B is selected", () => {
		const typedKeys = new Map(keys).set("1,7", {
			type: "clawbot",
			title: Option.some("Coder"),
			agentId: Option.some("code"),
			voiceInput: false,
		});
		let view = initialVoiceView;
		const send = (event: VoiceSurfaceEvent) => {
			view = reduceVoice(view, { _tag: "event", event }, typedKeys, 0);
		};
		send(key("1,5", "down"));
		send(
			stage("1,5", {
				_tag: "recording",
				status: "speaking",
				transcript: "What is",
			}),
		);
		send(key("1,7", "down"));
		send(key("1,7", "up"));
		expect(view.input.agentId).toEqual(Option.some("code"));
		expect(view.conversation.activeKey).toEqual(Option.some("1,7"));
		send(
			stage("1,5", {
				_tag: "recording",
				status: "speaking",
				transcript: "What is the weather",
			}),
		);
		expect(
			Option.map(view.conversation.live, (row) => row.transcript.text),
		).toEqual(Option.some("What is the weather"));
		expect(
			Option.flatMap(view.conversation.live, (row) => row.agentName),
		).toEqual(Option.some("Weather"));
		send(
			stage("1,5", {
				_tag: "processing",
				transcript: "What is the weather today?",
			}),
		);
		expect(
			Option.map(view.conversation.live, (row) => row.transcript.text),
		).toEqual(Option.some("What is the weather today?"));
		// Even if the last displayed hypothesis differs, the turn prompt wins.
		send({
			_tag: "TurnStarted",
			serial: "QK",
			keyCode: "1,5",
			sessionId,
			turnId,
			source: "voice",
			prompt: "What is the weather today? Final correction.",
		});
		const group = view.conversation.groups.at(-1);
		expect(group?.agent).toEqual({ id: "weather", name: "Weather", icon: 0 });
		expect(group?.messages[0]).toMatchObject({
			_tag: "text",
			isVoice: true,
			text: {
				_tag: "literal",
				text: "What is the weather today? Final correction.",
			},
		});
		expect(view.conversation.live).toEqual(Option.none());
		expect(view.conversation.capture).toEqual(Option.none());
		expect(view.input.agentId).toEqual(Option.some("code"));
	});
	it("preserves the transcript prefix in both the live row and input through growing, shrinking and final updates", () => {
		let view = play([key("1,5", "down")]);
		const steps: readonly (readonly [VoiceStage, string])[] = [
			[
				{
					_tag: "recording",
					status: "speaking",
					transcript: "This is the first sentence.",
				},
				"This is the first sentence.",
			],
			...["Next", "Next sentence", "Next", "Next sentence corrected"].map(
				(transcript): readonly [VoiceStage, string] => [
					{ _tag: "recording", status: "speaking", transcript },
					`This is the first sentence.\n${transcript}`,
				],
			),
			[
				{
					_tag: "processing",
					transcript: "This is the first sentence.\r\nNext sentence final\r\n",
				},
				"This is the first sentence.\nNext sentence final",
			],
		];
		for (const [update, expected] of steps) {
			view = play([stage("1,5", update)], view);
			expect(view.input.voice.text).toBe(expected);
			expect(
				Option.map(view.conversation.live, (row) => row.transcript.text),
			).toEqual(Option.some(expected));
		}
	});
	it("clears selection-only ClawBot taps and accepts the next key's answer", () => {
		const tapped = play([key("1,5", "down"), key("1,5", "up")]);
		expect(tapped.copilot.activeKey).toEqual(Option.none());
		expect(tapped.copilot.status).toEqual(Option.none());
		expect(tapped.copilot.statusSince).toEqual(Option.none());
		expect(tapped.copilot.statusText).toEqual(Option.none());
		expect(cancelIndicatorKey(tapped)).toEqual(Option.none());
		expect(tapped.input.agentId).toEqual(Option.some("weather"));
		const answered = play(
			[
				key("1,6", "down"),
				stage("1,6", { _tag: "recording", status: "listening" }),
				key("1,6", "up"),
				chunk(0, { type: "answer", textDelta: "next answer" }),
				chunk(1, { type: "end", outcome: "completed" }),
			],
			tapped,
		);
		expect(answered.copilot.text).toBe("next answer\n");
	});
	it("a captured ClawBot release processes, while a foreign up cannot change it", () => {
		const capturing = play([
			key("1,5", "down"),
			stage("1,5", { _tag: "recording", status: "listening" }),
		]);
		expect(play([key("1,6", "up")], capturing).copilot).toEqual(
			capturing.copilot,
		);
		const released = play([key("1,5", "up")], capturing);
		expect(cancelIndicatorKey(released)).toEqual(Option.some("1,5"));
	});
	it("disconnect reset clears mounted voice state, countdowns and expiry deadlines", () => {
		const busy = play([
			key("1,5", "down"),
			stage("1,5", {
				_tag: "recording",
				status: "speaking",
				transcript: "unfinished",
			}),
			stage("0,1", { _tag: "failed", reason: "server" }),
			{ _tag: "Toast", serial: "QK", messageKey: "aiIconViewTxt.busyToast" },
		]);
		const reset = play(
			[{ _tag: "Reset", serial: "QK", reason: "disconnected" }],
			busy,
		);
		expect(reset.overlay.visible).toBe(false);
		expect(reset.overlay.countdown).toEqual(Option.none());
		expect(reset.bar.visible).toBe(false);
		expect(reset.copilot.activeKey).toEqual(Option.none());
		expect(reset.input.voice.text).toBe("");
		expect(reset.input.revision).toBeGreaterThan(busy.input.revision);
		expect(reset.conversation.live).toEqual(Option.none());
		expect(reset.activeClawbot).toEqual(Option.none());
		expect(reset.alerts.size).toBe(0);
		expect(reset.toasts).toEqual([]);
		expect(nextExpiry(reset)).toEqual(Option.none());
	});
	it("preserves standalone whitespace deltas in the displayed and copied answer", () => {
		const deltas = ["hello", " ", "world", "\n", "  ", "next", ""];
		const view = play([
			key("1,6", "down"),
			...deltas.map((textDelta, seq) =>
				chunk(seq, { type: "answer", textDelta }),
			),
		]);
		expect(view.copilot.text).toBe("hello world\n  next");
	});

	it("expires a busy rejection without closing a newer knob session", () => {
		const busy = reduceVoice(
			initialVoiceView,
			{ _tag: "event", event: stage("0,1", { _tag: "busy" }, "busy") },
			keys,
			100,
		);
		expect(nextExpiry(busy)).toEqual(Option.some(3100));
		expect(
			reduceVoice(busy, { _tag: "expire" }, keys, 3099).overlay.visible,
		).toBe(true);
		expect(
			reduceVoice(busy, { _tag: "expire" }, keys, 3100).overlay.visible,
		).toBe(false);
		const newer = reduceVoice(
			busy,
			{
				_tag: "event",
				event: stage("0,1", { _tag: "recording", status: "listening" }, "new"),
			},
			keys,
			200,
		);
		expect(reduceVoice(newer, { _tag: "expire" }, keys, 3100).overlay).toEqual(
			newer.overlay,
		);
	});

	it("clears a mounted input draft on repeated profile resets, even before voice text exists", () => {
		let view = initialVoiceView;
		for (let revision = 1; revision <= 3; revision++) {
			view = play([{ _tag: "profileReset" }], view);
			expect(view.input.revision).toBe(revision);
			expect(view.input.voice.text).toBe("");
			expect(view.input.keyCode).toEqual(Option.none());
		}
	});

	it("selects a typed-only assistant without disturbing a running voice turn", () => {
		const typedKeys = new Map(keys).set("1,5", {
			type: "clawbot",
			title: Option.some("Weather"),
			agentId: Option.some("weather"),
			voiceInput: false,
		});
		const running = play([
			key("1,6", "down"),
			stage("1,6", { _tag: "recording", status: "listening" }),
		]);
		const selected = reduceVoice(
			running,
			{ _tag: "event", event: key("1,5", "down") },
			typedKeys,
			100,
		);
		const released = reduceVoice(
			selected,
			{ _tag: "event", event: key("1,5", "up") },
			typedKeys,
			200,
		);
		expect(released.input.agentId).toEqual(Option.some("weather"));
		expect(released.copilot).toEqual(running.copilot);
		expect(released.bar).toEqual(running.bar);
	});

	it("holds, records, streams and completes on an aiChat key", () => {
		const statuses: Option.Option<string>[] = [];
		let view = initialVoiceView;
		const steps: VoiceSurfaceEvent[] = [
			key("1,6", "down"),
			stage("1,6", { _tag: "recording", status: "preparing" }),
			stage("1,6", { _tag: "recording", status: "listening" }),
			key("1,6", "up"),
			stage("1,6", { _tag: "processing", transcript: "translate hello" }),
			chunk(0, { type: "answer", textDelta: "Hola" }),
			chunk(1, { type: "answer", textDelta: " amigo" }),
			chunk(2, { type: "answer", textDelta: "!" }),
			chunk(3, { type: "end", outcome: "completed" }),
		];
		for (const event of steps) {
			view = play([event], view);
			statuses.push(statusOf(view));
		}
		expect(statuses.map((value) => Option.getOrElse(value, () => "-"))).toEqual(
			[
				"aiIconViewTxt.status.initializing",
				"aiIconViewTxt.status.initializing",
				"aiIconViewTxt.status.startrecording",
				"aiIconViewTxt.status.processing",
				"aiIconViewTxt.status.processing",
				"aiIconViewTxt.status.processing",
				"aiIconViewTxt.status.processing",
				"aiIconViewTxt.status.processing",
				"aiIconViewTxt.status.completed",
			],
		);
		expect(view.copilot.text).toBe("Hola amigo!\n");
		expect(view.copilot.activeKey).toEqual(Option.none());
	});

	it("shows the cancel indicator on the active key only while processing", () => {
		const processing = play([
			key("1,6", "down"),
			stage("1,6", { _tag: "recording", status: "listening" }),
			key("1,6", "up"),
		]);
		expect(cancelIndicatorKey(processing)).toEqual(Option.some("1,6"));
		const done = play(
			[chunk(0, { type: "end", outcome: "completed" })],
			processing,
		);
		expect(cancelIndicatorKey(done)).toEqual(Option.none());
	});

	it("cancels when released before the mic opens", () => {
		const view = play([key("1,6", "down"), key("1,6", "up")]);
		expect(view.copilot.status).toEqual(Option.none());
		expect(view.copilot.statusText).toEqual(Option.none());
	});

	it("renders an injected tag in an answer as literal text", async () => {
		const { AiCopilotTile } = await import(
			"../../tiles/aiCopilot/AiCopilotTile"
		);
		const { previewVoiceContext } = await import("./voice-context");
		const view = play([
			key("1,6", "down"),
			chunk(0, { type: "answer", textDelta: "<img src=x onerror=alert(1)>" }),
		]);
		const markup = renderToStaticMarkup(
			createElement(AiCopilotTile, {
				tile: copilotTile,
				context: {
					now: undefined,
					hourFormat: "24h",
					voice: { ...previewVoiceContext, view, surface: "panel" },
				},
			}),
		);
		expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;");
		expect(markup).not.toContain("<img");
		expect(markup).toContain("AI Copilot chat");
	});
});

describe("copilot status machine", () => {
	it("times out 330 s after leaving idle", () => {
		let state = reduceCopilot(
			initialCopilot,
			{
				_tag: "keyDown",
				keyCode: "1,6",
				keyType: "aiChat",
				title: Option.none(),
			},
			0,
		);
		state = reduceCopilot(state, { _tag: "timeout" }, COPILOT_TIMEOUT_MS - 1);
		expect(state.status).toEqual(Option.some(0));
		state = reduceCopilot(state, { _tag: "timeout" }, COPILOT_TIMEOUT_MS);
		expect(state.status).toEqual(Option.none());
		expect(state.statusText).toEqual(
			Option.some({ _tag: "string", key: "aiIconViewTxt.status.timeout" }),
		);
	});
	it("labels voice preparation separately from active recording", () => {
		let view = play([key("1,6", "down")]);
		for (const [status, expected] of [
			["preparing", "Initializing"],
			["listening", "Recording"],
		] as const) {
			view = play([stage("1,6", { _tag: "recording", status })], view);
			const text = Option.getOrThrow(view.copilot.statusText);
			if (text._tag !== "string") throw new Error("Expected voice status text");
			expect(stripText("en", text.key)).toBe(expected);
		}
	});
	it("ignores recording status unless initializing, and shows busy and error codes", () => {
		const response = (
			status: -1 | 3 | 5,
			errorCode = Option.none<string>(),
		): CopilotEvent => ({
			_tag: "response",
			keyCode: Option.some("1,6"),
			status,
			errorCode,
			message: Option.none(),
		});
		expect(reduceCopilot(initialCopilot, response(3), 0)).toBe(initialCopilot);
		expect(reduceCopilot(initialCopilot, response(5), 0).statusText).toEqual(
			Option.some({ _tag: "string", key: "aiIconViewTxt.status.systemBusy" }),
		);
		expect(
			reduceCopilot(initialCopilot, response(-1, Option.some("1003")), 0)
				.statusText,
		).toEqual(Option.some({ _tag: "errorCode", code: "1003" }));
	});
	it("keeps a running turn's status when another key is rejected busy", () => {
		const down = reduceCopilot(
			initialCopilot,
			{
				_tag: "keyDown",
				keyCode: "1,6",
				keyType: "aiChat",
				title: Option.none(),
			},
			0,
		);
		const busyOther = reduceCopilot(
			down,
			{
				_tag: "response",
				keyCode: Option.some("1,7"),
				status: 5,
				errorCode: Option.none(),
				message: Option.none(),
			},
			10,
		);
		expect(busyOther).toBe(down);
	});
	it("tones the copilot status and keeps the layout at 1180×460", () => {
		const statuses: readonly Option.Option<0 | 1 | 2 | 3 | 4>[] = [
			Option.none(),
			Option.some(0),
			Option.some(3),
			Option.some(4),
			Option.some(1),
			Option.some(2),
		];
		expect(
			statuses.map((status) => copilotTone(status, Option.none())),
		).toEqual(["idle", "active", "active", "active", "active", "success"]);
		const layout = copilotLayout(1180, 460);
		expect(layout).toMatchObject({
			textFs: 20,
			smallFs: 16,
			toolbar: 92,
			left: 236,
			right: 944,
		});
		expect(layout.gap).toBeCloseTo(6.9);
		expect(layout.orbWidth).toBeCloseTo(177.1);
		expect(layout.orbHeight).toBeCloseTo(354.2);
	});
});

describe("keys, alerts and toasts", () => {
	it("selects a clawbot key: green dot, agent and input target", () => {
		const view = play([key("1,5", "down")]);
		expect(view.activeClawbot).toEqual(Option.some("1,5"));
		expect(view.input.keyCode).toEqual(Option.some("1,5"));
		expect(view.input.agentId).toEqual(Option.some("weather"));
		expect(
			Option.map(view.conversation.activeAgent, (agent) => agent.id),
		).toEqual(Option.some("weather"));
	});
	it("expires invalid alerts after 2000 ms and toasts after 3000 ms; checkmarks stay", () => {
		let view = reduceVoice(
			initialVoiceView,
			{
				_tag: "event",
				event: {
					_tag: "KeyAlert",
					serial: "QK",
					keyCode: "1,6",
					alert: "invalid",
				},
			},
			keys,
			0,
		);
		view = reduceVoice(
			view,
			{
				_tag: "event",
				event: {
					_tag: "KeyAlert",
					serial: "QK",
					keyCode: "1,7",
					alert: "checkmark",
				},
			},
			keys,
			0,
		);
		view = reduceVoice(
			view,
			{
				_tag: "event",
				event: {
					_tag: "Toast",
					serial: "QK",
					messageKey: "aiIconViewTxt.busyToast",
				},
			},
			keys,
			0,
		);
		expect(nextExpiry(view)).toEqual(Option.some(2000));
		view = reduceVoice(view, { _tag: "expire" }, keys, 1999);
		expect(view.alerts.has("1,6")).toBe(true);
		view = reduceVoice(view, { _tag: "expire" }, keys, 2000);
		expect(view.alerts.has("1,6")).toBe(false);
		expect(view.alerts.has("1,7")).toBe(true);
		expect(view.toasts).toHaveLength(1);
		view = reduceVoice(view, { _tag: "expire" }, keys, 3000);
		expect(view.toasts).toHaveLength(0);
	});
	it("clears the active key, dot and live row on a profile change", () => {
		const view = play([
			key("1,5", "down"),
			stage("1,5", {
				_tag: "recording",
				status: "speaking",
				transcript: "hello",
			}),
			{ _tag: "profileReset" },
		]);
		expect(view.activeClawbot).toEqual(Option.none());
		expect(view.conversation.live).toEqual(Option.none());
		expect(view.input.keyCode).toEqual(Option.none());
	});
});

const copilotLayoutTiles = (() => {
	const envelope = Schema.decodeUnknownSync(ProfileEnvelope)(
		voiceFixtureEnvelope(copilotProfile, "QK"),
	);
	const { profile, page } = selectStripPage(envelope, "QK");
	return stripLayout(profile, page).tiles;
})();
const copilotTileFixture = copilotLayoutTiles.find(
	(tile) => tile.type === "aiChatView",
);
if (!copilotTileFixture) throw new Error("fixture has no aiChatView");
const copilotTile = copilotTileFixture;

describe("overlay markup", () => {
	it("draws backdrop, subtitle and bar with DK's text", () => {
		const view = play([
			stage("0,1", { _tag: "recording", status: "listening" }, "k"),
			{ _tag: "Toast", serial: "QK", messageKey: "aiIconViewTxt.busyToast" },
		]);
		const markup = renderToStaticMarkup(
			createElement(
				"div",
				null,
				createElement(VoiceOverlay, { view, locale: "en", motion: "full" }),
				createElement(StripToasts, { view, locale: "en" }),
			),
		);
		expect(markup).toContain('class="voice-backdrop"');
		expect(markup).toContain('class="voice-subtitle"');
		expect(markup).toContain("You can speak now");
		expect(markup).toContain('class="voice-bar"');
		expect(markup).toContain('data-bar="true"');
		expect(markup).toContain("System busy, please try later");
		// No transcript row under the backdrop (QSV:165).
		expect(markup).not.toContain("voice-bar-row");
	});
	it("draws only the bar and its transcript row for grid voice", () => {
		const view = play([
			stage("1,6", { _tag: "recording", status: "preparing" }),
		]);
		const markup = renderToStaticMarkup(
			createElement(VoiceOverlay, { view, locale: "en", motion: "full" }),
		);
		expect(markup).not.toContain("voice-backdrop");
		expect(markup).toContain("voice-bar-row");
		expect(markup).toContain("Preparing microphone…");
	});
});
