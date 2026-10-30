import { SessionId, TurnId } from "@open-quake/edge/chat/contracts";
import { Option, Schema } from "effect";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	dkClawProfile,
	voiceFixtureEnvelope,
} from "../../../../../main/test/voice-fixtures";
import { ProfileEnvelope } from "../../../../../shared/profiles";
import { stripLayout } from "../../geometry";
import { type StripLocale, stripText } from "../../overlays/voice/strings";
import { previewVoiceContext } from "../../overlays/voice/voice-context";
import { initialVoiceView } from "../../overlays/voice/voice-state";
import { selectStripPage } from "../../selection";
import { ClawBotInputTile } from "../clawBotInput/ClawBotInputTile";
import {
	checkSend,
	initialInput,
	inputScale,
	reduceInputStage,
	selectInput,
} from "../clawBotInput/input-state";
import { ClawBotTile, clawBotScale, formatChatTime } from "./ClawBotTile";
import {
	appendHint,
	type ConversationState,
	HINT_DEDUPE_MS,
	initialConversation,
	reduceConversation,
} from "./conversation";
import { errorCopy, isHintCopy } from "./error-copy";
import { parseRichText } from "./rich-text";
import { toolKind, toolPreview } from "./tool-parse";
import { applyFinal, emptyTranscript, mergePartial } from "./transcript-merge";

const sessionId = Schema.decodeUnknownSync(SessionId)(
	"00000000-0000-4000-8000-000000000021",
);
const turnId = Schema.decodeUnknownSync(TurnId)(
	"00000000-0000-4000-8000-000000000022",
);

describe("code fence boundaries", () => {
	it.each([
		["````md\n```\ninner\n```\n````\nafter", "```\ninner\n```"],
		["~~~js\nconst x = 1;\n```\n~~~~\nafter", "const x = 1;\n```"],
		[
			"```\ncode\n``` trailing text\nmore\n```\nafter",
			"code\n``` trailing text\nmore",
		],
		["~~~~\ncode\n~~~\nmore\n~~~~~ \t\nafter", "code\n~~~\nmore"],
	])("keeps nested or invalid closing lines inside code", (text, expected) => {
		const parsed = parseRichText(text);
		expect(parsed._tag).toBe("markdown");
		if (parsed._tag === "markdown") {
			expect(parsed.blocks[0]).toEqual({ _tag: "code", text: expected });
			expect(parsed.blocks[1]).toEqual({
				_tag: "paragraph",
				inlines: [{ _tag: "text", text: "after" }],
			});
		}
	});
});
const tiles = (() => {
	const envelope = Schema.decodeUnknownSync(ProfileEnvelope)(
		voiceFixtureEnvelope(dkClawProfile, "QK"),
	);
	const { profile, page } = selectStripPage(envelope, "QK");
	return stripLayout(profile, page).tiles;
})();
const tile = (type: string) => {
	const found = tiles.find((candidate) => candidate.type === type);
	if (!found) throw new Error(`no ${type}`);
	return found;
};

describe("live transcript merge (AI-164)", () => {
	const feed = (...parts: string[]) =>
		parts.reduce(mergePartial, emptyTranscript).text;
	it("replaces a growing hypothesis, even across a trailing boundary", () => {
		expect(feed("你查一下。", "你查一下今天的天气")).toBe("你查一下今天的天气");
		expect(feed("turn on the", "turn on the lights")).toBe(
			"turn on the lights",
		);
	});
	it("replaces a shrinking hypothesis and drops exact repeats", () => {
		expect(feed("turn on the lights", "turn on the")).toBe("turn on the");
		expect(feed("hello", "hello")).toBe("hello");
	});
	it("appends a short tail after a break on a new line", () => {
		expect(feed("The meeting starts at nine", "Bring slides")).toBe(
			"The meeting starts at nine\nBring slides",
		);
	});
	it("keeps earlier sentences while the current partial grows, shrinks and refreshes", () => {
		const prefix = "This is the first sentence.\n";
		let state = mergePartial(emptyTranscript, "This is the first sentence.");
		for (const partial of [
			"Next",
			"Next sentence",
			"Next",
			"Next sentence for ten",
			"Next sentence for two minutes",
			"Next sentence for two minutes.",
		]) {
			state = mergePartial(state, partial);
			expect(state.text).toBe(prefix + partial);
			expect(mergePartial(state, partial)).toBe(state);
		}
		state = mergePartial(state, "Third");
		state = mergePartial(state, "Third sentence");
		expect(state.text).toBe(
			`${prefix}Next sentence for two minutes.\nThird sentence`,
		);
		const final = applyFinal(state, "Authoritative final transcript\r\n");
		expect(final.text).toBe("Authoritative final transcript");
		expect(final.prefix).toBe("");
		expect(applyFinal(final, "")).toBe(final);
	});
	it("replaces on a full-hypothesis refresh", () => {
		expect(feed("set a timer for ten", "set a timer for two minutes")).toBe(
			"set a timer for two minutes",
		);
	});
	it("lets a final replace everything", () => {
		expect(
			applyFinal(mergePartial(emptyTranscript, "abc"), "final text\r\n").text,
		).toBe("final text");
	});
});

describe("conversation", () => {
	const turn = (state: ConversationState, source: "voice" | "typed") =>
		reduceConversation(
			state,
			{
				_tag: "TurnStarted",
				serial: "QK",
				keyCode: "1,5",
				sessionId,
				turnId,
				prompt: "weather?",
				source,
				agent: { id: "weather", name: "Weather", icon: "0-1" },
			},
			100,
		);
	const answer = (state: ConversationState, seq: number, textDelta: string) =>
		reduceConversation(
			state,
			{
				_tag: "Chunk",
				serial: "QK",
				keyCode: "1,5",
				chunk: {
					version: 1,
					sessionId,
					turnId,
					seq,
					type: "answer",
					textDelta,
				},
			},
			200,
		);

	it("moves the live row into the turn as a voice message and streams the answer", () => {
		let state = reduceConversation(
			initialConversation,
			{
				_tag: "Stage",
				serial: "QK",
				keyCode: "1,5",
				captureId: "c",
				stage: {
					_tag: "recording",
					status: "speaking",
					transcript: "weather in Lisbon",
				},
			},
			50,
		);
		expect(Option.map(state.live, (row) => row.transcript.text)).toEqual(
			Option.some("weather in Lisbon"),
		);
		state = answer(answer(turn(state, "voice"), 0, "Sunny"), 1, ", 22 °C");
		expect(state.live).toEqual(Option.none());
		const group = state.groups.at(-1);
		expect(group?.agent).toEqual({ id: "weather", name: "Weather", icon: 1 });
		expect(group?.messages.map((message) => message._tag)).toEqual([
			"text",
			"answer",
		]);
		const voice = group?.messages[0];
		expect(voice?._tag === "text" && voice.isVoice).toBe(true);
		const reply = group?.messages[1];
		expect(reply?._tag === "answer" && reply.view.text).toBe("Sunny, 22 °C");
	});

	it("echoes typed input as a Command group (AI-165)", () => {
		const state = turn(initialConversation, "typed");
		expect(state.groups.map((group) => group.kind)).toEqual(["user", "agent"]);
	});

	it("drops a repeated hint within 5000 ms (AI-168) and keeps it afterwards", () => {
		const text = { _tag: "literal" as const, text: "Gateway down" };
		let state = appendHint(initialConversation, text, 0);
		state = appendHint(state, text, HINT_DEDUPE_MS - 1);
		expect(state.groups).toHaveLength(1);
		state = appendHint(state, text, HINT_DEDUPE_MS);
		expect(state.groups).toHaveLength(2);
	});

	it("appends a connection hint on each status change", () => {
		let state = reduceConversation(
			initialConversation,
			{ _tag: "AgentStatus", state: "noService" },
			0,
		);
		state = reduceConversation(
			state,
			{ _tag: "AgentStatus", state: "noService" },
			10,
		);
		state = reduceConversation(
			state,
			{ _tag: "AgentStatus", state: "connected" },
			20,
		);
		expect(state.groups).toHaveLength(2);
		expect(state.connection).toBe("connected");
	});

	it("turns failed turns into hints or bubbles by code (AI-167)", () => {
		let state = turn(initialConversation, "voice");
		state = reduceConversation(
			state,
			{
				_tag: "Chunk",
				serial: "QK",
				keyCode: "1,5",
				chunk: {
					version: 1,
					sessionId,
					turnId,
					seq: 0,
					type: "end",
					outcome: "cancelled",
				},
			},
			300,
		);
		expect(state.groups.at(-1)?.kind).toBe("system");
		expect(errorCopy("4001")).toEqual({
			_tag: "string",
			key: "quakeBotIconView.chatFailed",
		});
		expect(errorCopy("2014")).toEqual({
			_tag: "string",
			key: "quakeBotIconView.chatFailed",
		});
		expect(errorCopy("__proto__")).toEqual({
			_tag: "string",
			key: "quakeBotIconView.chatFailed",
		});
		expect(isHintCopy(errorCopy("1003"))).toBe(false);
	});

	it("AI-178: only accepted later answer text finishes running tools", () => {
		let state = answer(
			answer(turn(initialConversation, "typed"), 0, "first"),
			1,
			"",
		);
		state = reduceConversation(
			state,
			{
				_tag: "Tool",
				serial: "QK",
				keyCode: "1,5",
				turnId,
				toolCallId: "t1",
				name: "exec",
				args: '{"command":"pwd"}',
				phase: "start",
			},
			201,
		);
		const render = (conversation: ConversationState) =>
			renderToStaticMarkup(
				createElement(ClawBotTile, {
					tile: tile("quakeBot"),
					context: {
						now: undefined,
						hourFormat: "24h",
						voice: {
							...previewVoiceContext,
							surface: "panel",
							view: { ...initialVoiceView, conversation },
						},
					},
				}),
			);
		const running = (conversation: ConversationState) =>
			expect(render(conversation)).toContain('data-phase="start"');
		running(answer(state, 0, "stale"));
		running(answer(state, 1, "duplicate"));
		running(answer(state, 2, ""));
		running(answer(state, 4, "sequence gap"));
		const ended = reduceConversation(
			state,
			{
				_tag: "Chunk",
				serial: "QK",
				keyCode: "1,5",
				chunk: {
					version: 1,
					sessionId,
					turnId,
					seq: 2,
					type: "end",
					outcome: "completed",
				},
			},
			202,
		);
		running(answer(ended, 3, "late"));
		const next = answer(state, 2, " next");
		expect(render(next)).toContain('data-phase="result"');
		expect(render(next)).toContain("first next");
	});

	it("upserts tool cards by call id", () => {
		let state = turn(initialConversation, "voice");
		const tool = (phase: "start" | "result") =>
			reduceConversation(
				state,
				{
					_tag: "Tool",
					serial: "QK",
					keyCode: "1,5",
					turnId,
					toolCallId: "t1",
					name: "bash",
					phase,
					...(phase === "start" ? { args: '{"command":"ls -la"}' } : {}),
				},
				400,
			);
		state = tool("start");
		state = tool("result");
		const tools = state.groups
			.at(-1)
			?.messages.filter((message) => message._tag === "tool");
		expect(tools).toHaveLength(1);
		expect(tools?.[0]?._tag === "tool" && tools[0].phase).toBe("result");
		expect(
			tools?.[0]?._tag === "tool" && Option.getOrUndefined(tools[0].args),
		).toBe('{"command":"ls -la"}');
	});

	it("clears the live row and selection on a profile change (AI-170)", () => {
		const state = reduceConversation(
			reduceConversation(
				initialConversation,
				{
					_tag: "Select",
					keyCode: "1,5",
					agent: { id: "w", name: "W", icon: 0 },
				},
				0,
			),
			{ _tag: "ProfileReset" },
			1,
		);
		expect(state.activeKey).toEqual(Option.none());
	});
});

describe("rich text and tools", () => {
	it("parses markdown blocks and keeps raw HTML literal", () => {
		const rich = parseRichText("## Plan\n- **one** `two`\n<script>x</script>");
		expect(rich._tag).toBe("markdown");
		if (rich._tag !== "markdown") return;
		expect(rich.blocks.map((block) => block._tag)).toEqual([
			"heading",
			"list",
			"paragraph",
		]);
		const paragraph = rich.blocks[2];
		expect(paragraph?._tag === "paragraph" && paragraph.inlines).toEqual([
			{ _tag: "text", text: "<script>x</script>" },
		]);
	});
	it("turns only safe http(s) URLs into chips", () => {
		const rich = parseRichText(
			"see https://example.com/docs. and javascript:alert(1) or ~/notes.txt",
		);
		expect(rich._tag).toBe("plain");
		if (rich._tag !== "plain") return;
		const links = rich.inlines.filter((inline) => inline._tag === "link");
		expect(links).toEqual([
			{
				_tag: "link",
				url: "https://example.com/docs",
				label: "example.com/docs",
			},
		]);
	});
	it("expands exec and search tools only", () => {
		expect(toolKind("run_exec")).toEqual(Option.some("exec"));
		expect(toolKind("calendar")).toEqual(Option.none());
		expect(toolPreview("bash", Option.some('{"command":"ls"}'))).toEqual(
			Option.some("ls"),
		);
		expect(
			toolPreview("web_search", Option.some('{"q":"lisbon weather"}')),
		).toEqual(Option.some("lisbon weather"));
		expect(toolPreview("shell", Option.some("raw cmd"))).toEqual(
			Option.some("raw cmd"),
		);
		expect(toolPreview("calendar", Option.some("{}"))).toEqual(Option.none());
	});
});

describe("ClawBotView rendering", () => {
	it("scales 940×460 by 1.0455 and formats HH:mm 24 h", () => {
		expect(clawBotScale(940, 460)).toBeCloseTo(1.0455, 4);
		expect(clawBotScale(10, 10)).toBe(0.4);
		expect(formatChatTime(new Date(2026, 9, 24, 21, 5).getTime(), "en")).toBe(
			"21:05",
		);
	});
	it("renders the header everywhere and messages only on the strip, escaped", () => {
		const view = {
			...initialVoiceView,
			conversation: appendHint(
				initialConversation,
				{ _tag: "literal", text: "<b>hi</b>" },
				0,
			),
		};
		const props = (surface: "panel" | "preview") => ({
			tile: tile("quakeBot"),
			context: {
				now: undefined,
				hourFormat: "24h" as const,
				voice: { ...previewVoiceContext, view, surface },
			},
		});
		const preview = renderToStaticMarkup(
			createElement(ClawBotTile, props("preview")),
		);
		expect(preview).toContain("Interaction history");
		expect(preview).toContain("Checking…");
		expect(preview).not.toContain("clawbot-messages");
		const panel = renderToStaticMarkup(
			createElement(ClawBotTile, props("panel")),
		);
		expect(panel).toContain("clawbot-messages");
		expect(panel).toContain("&lt;b&gt;hi&lt;/b&gt;");
		expect(panel).not.toContain("<b>hi</b>");
	});
});

describe("FunctionWheel interplay (AI-207)", () => {
	it("goes opaque without blur while the wheel is open", () => {
		const markup = (wheelOpen: boolean) =>
			renderToStaticMarkup(
				createElement(ClawBotTile, {
					tile: tile("quakeBot"),
					context: {
						now: undefined,
						hourFormat: "24h",
						voice: { ...previewVoiceContext, wheelOpen },
					},
				}),
			);
		expect(markup(true)).toContain('data-wheel="true"');
		expect(markup(false)).not.toContain("data-wheel");
	});
});

describe("ClawBotInput", () => {
	it("needs a tapped clawbot key, then text", () => {
		expect(checkSend(initialInput, "hi")).toEqual({
			_tag: "warn",
			key: "quakeBotInputIconView.warnings.selectAssistantCard",
		});
		const selected = selectInput(
			initialInput,
			"1,5",
			Option.some("weather"),
			Option.some("Weather"),
		);
		expect(checkSend(selected, "   ")).toEqual({ _tag: "empty" });
		expect(checkSend(selected, " hi ")).toEqual({
			_tag: "send",
			keyCode: "1,5",
			agentId: "weather",
			message: "hi",
		});
		expect(
			checkSend(
				selectInput(initialInput, "1,5", Option.none(), Option.none()),
				"hi",
			),
		).toEqual({
			_tag: "warn",
			key: "quakeBotInputIconView.warnings.selectAssistant",
		});
	});
	it("fills from voice: clears when the mic opens, merges partials, takes the final", () => {
		const stage = (value: Parameters<typeof reduceInputStage>[1]["stage"]) => ({
			_tag: "Stage" as const,
			serial: "QK",
			keyCode: "1,5",
			captureId: "c",
			stage: value,
		});
		let state = selectInput(
			initialInput,
			"1,5",
			Option.some("weather"),
			Option.none(),
		);
		state = reduceInputStage(
			state,
			stage({ _tag: "recording", status: "speaking", transcript: "old" }),
		);
		state = reduceInputStage(
			state,
			stage({ _tag: "recording", status: "listening" }),
		);
		expect(state.voice.text).toBe("");
		state = reduceInputStage(
			state,
			stage({ _tag: "recording", status: "speaking", transcript: "what is" }),
		);
		state = reduceInputStage(
			state,
			stage({ _tag: "processing", transcript: "what is the time" }),
		);
		expect(state.voice.text).toBe("what is the time");
		expect(state.revision).toBe(4);
	});
	it("scales 460×460 by 1.307 and omits Open WebChat", () => {
		expect(inputScale(460, 460)).toBeCloseTo(1.307, 3);
		const markup = renderToStaticMarkup(
			createElement(ClawBotInputTile, {
				tile: tile("quakeBotInput"),
				context: {
					now: undefined,
					hourFormat: "24h",
					voice: { ...previewVoiceContext, surface: "panel" },
				},
			}),
		);
		expect(markup).toContain("Command input");
		expect(markup).toContain("Tap to enter a command…");
		expect(markup).toContain("Send");
		expect(markup).toContain("Attach file");
		expect(markup).not.toContain("WebChat");
	});
});

describe("AI-167 retained error copy through the conversation renderer", () => {
	const cases = [
		["1401", "sttErrorUnauthorized", false],
		["2003", "sttErrorGeneric", false],
		["1003", "sttErrorNoAudioCapture", false],
		["1002", "sttErrorInvalidUserInput", false],
		["3005", "voiceStartFailed", false],
		["2009", "communicationCancelled", true],
		["2010", "openClawNotConnected", true],
		["2011", "sendChatFailed", true],
		["2012", "chatFailed", true],
		["2013", "chatResponseError", true],
		["4001", "chatFailed", true],
		["4003", "chatFailed", true],
		["2014", "chatFailed", true],
		["VOICE.GRID.RUNTIME_UNAVAILABLE", "voiceStartFailed", false],
		["VOICE.KNOB.ROUTE_UNAVAILABLE", "voiceStartFailed", false],
		["VOICE.CAPTURE.NO_DEVICE", "sttErrorNoAudioCapture", false],
		["VOICE.CAPTURE.PERMISSION_DENIED", "sttErrorNoAudioCapture", false],
		["VOICE.CAPTURE.RECORDER_UNAVAILABLE", "sttErrorNoAudioCapture", false],
		["VOICE.CAPTURE.PHASE_TIMEOUT", "sttErrorNoAudioCapture", false],
		["CHAT.RESPONSE.TIMEOUT", "chatResponseError", true],
		["CHAT.SESSION.BUSY", "chatFailed", true],
		["CHAT.TURN.CANCELLED", "communicationCancelled", true],
		["AI.PROVIDER.UNAVAILABLE", "chatFailed", true],
		["AI.PROVIDER.RATE_LIMITED", "chatFailed", true],
		["AI.PROVIDER.AUTH_REQUIRED", "sttErrorUnauthorized", false],
		["AI.PROVIDER.AUTH_REVOKED", "sttErrorUnauthorized", false],
		["AI.PROVIDER.PROTOCOL_INVALID", "chatResponseError", true],
	] as const;
	const render = (state: ConversationState, locale: StripLocale = "en") =>
		renderToStaticMarkup(
			createElement(ClawBotTile, {
				tile: tile("quakeBot"),
				context: {
					now: undefined,
					hourFormat: "24h",
					voice: {
						...previewVoiceContext,
						surface: "panel",
						locale,
						view: { ...initialVoiceView, conversation: state },
					},
				},
			}),
		);
	const failed = (code?: string, message?: string) =>
		reduceConversation(
			initialConversation,
			{
				_tag: "Stage",
				serial: "QK",
				keyCode: "1,5",
				captureId: "fixture",
				stage: {
					_tag: "failed",
					reason: "generic",
					...(code === undefined ? {} : { errorCode: code }),
					...(message === undefined ? {} : { message }),
				},
			},
			0,
		);
	it.each(cases)("renders %s as %s, hint=%s", (code, key, hint) => {
		const html = render(failed(code));
		expect(html).toContain(stripText("en", `quakeBotIconView.${key}`));
		expect(html.includes('data-variant="hint"')).toBe(hint);
		expect(html).toContain(
			hint ? stripText("en", "quakeBotIconView.systemSender") : "default",
		);
	});
	it("prefers a supplied message, otherwise localizes unknown code or generic fallback", () => {
		expect(render(failed("unknown", "  supplied <img>  "))).toContain(
			"supplied &lt;img&gt;",
		);
		expect(render(failed("2012", "supplied"))).toContain("supplied");
		expect(render(failed("unknown", " "))).toContain(
			stripText("en", "quakeBotIconView.chatFailed"),
		);
		expect(render(failed())).toContain(stripText("en", "aiAudio.error"));
	});
	it.each(["en", "zh", "de", "es", "fr", "it", "ja", "ko"] as const)(
		"AI-208: %s stage/error/input copy is bundled offline",
		(locale) => {
			const input = renderToStaticMarkup(
				createElement(ClawBotInputTile, {
					tile: tile("quakeBotInput"),
					context: {
						now: undefined,
						hourFormat: "24h",
						voice: { ...previewVoiceContext, locale, surface: "panel" },
					},
				}),
			);
			for (const key of [
				"quakeBotInputIconView.title",
				"quakeBotInputIconView.placeholder",
				"quakeBotInputIconView.quickActions.send.label",
				"quakeBotInputIconView.quickActions.fileAttach.label",
			] as const) {
				const text = stripText(locale, key);
				expect(text).not.toBe(key);
				expect(input).toContain(
					text
						.replaceAll("&", "&amp;")
						.replaceAll('"', "&quot;")
						.replaceAll("'", "&#x27;"),
				);
			}
			for (const [code, key] of cases)
				expect(render(failed(code), locale)).toContain(
					stripText(locale, `quakeBotIconView.${key}`).replaceAll(
						"'",
						"&#x27;",
					),
				);
		},
	);
});
