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
			_tag: "errorCode",
			code: "__proto__",
		});
		expect(isHintCopy(errorCopy("1003"))).toBe(false);
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
		expect(preview).toContain("Interaction History");
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
		expect(markup).toContain("Command Input");
		expect(markup).toContain("Click to enter command...");
		expect(markup).toContain("Send");
		expect(markup).toContain("File Attach");
		expect(markup).not.toContain("WebChat");
	});
});
