// @vitest-environment happy-dom

import assert from "node:assert/strict";
import { Option, Schema } from "effect";
import { act } from "react";
import { afterEach, it, vi } from "vitest";

const mock = { fn: vi.fn };

import { initialAgentState } from "../../../../../../packages/edge/src/agents/agents-invariants";
import type { TurnSnapshot } from "../../../../../../packages/edge/src/chat/chat-contracts";
import { SessionId } from "../../../../../../packages/edge/src/chat/chat-contracts";
import type {
	ChatDelivery,
	ChatInput,
	PublicChatHistory,
} from "../../../../../../packages/edge/src/chat/chat-rpc";
import type { AgentsBridge, AgentView } from "../../../shared/agents";
import type { DirectChatBridge } from "../../../shared/chat";
import { click, mount, input as type } from "../../test/dom";
import { AppLocaleProvider } from "../i18n";
import { AgentsPage } from "../management/agents/AgentsPage";
import {
	chatStrings,
	DirectChatPanel,
} from "../management/chat/DirectChatPanel";
import { directChatModel } from "../management/chat/model-scope";

const element = <T extends Element = HTMLElement>(selector: string): T => {
	const found = document.querySelector<T>(selector);
	if (!found) throw new Error(`Missing ${selector}`);
	return found;
};
let mounted: Awaited<ReturnType<typeof mount>> | undefined;
afterEach(async () => {
	await mounted?.close();
	mounted = undefined;
	Reflect.deleteProperty(window, "quakeChat");
	vi.unstubAllGlobals();
});

function fixture() {
	const state = initialAgentState();
	const view: AgentView = {
		...state,
		models: {
			default: [
				{
					id: "saved",
					role: "default",
					provider: "openai",
					model: "fixture-model",
					baseUrl: "https://invalid.example",
					maxTokens: 512,
					credentialAvailable: true,
				},
			],
		},
		runtime: {
			available: false,
			status: "stopped",
			code: "AGENT.RUNTIME.UNAVAILABLE",
			operation: "none",
		},
		progress: { percent: 0, stage: "idle", deviceApplied: false },
		draftingAvailable: false,
	};
	const histories: PublicChatHistory[] = [1, 2].map((n) => ({
		sessionId: Schema.decodeUnknownSync(SessionId)(
			`00000000-0000-4000-8000-00000000000${n}`,
		),
		title: `saved ${n}`,
		manualTitle: false,
		revision: 1,
		contextEpoch: 0,
		updatedAt: n,
		turns: [],
	}));
	let receive: (delivery: ChatDelivery) => void = () => {};
	let accepted: ChatInput | undefined;
	const initial = (value: ChatInput): TurnSnapshot => ({
		sessionId: value.sessionId,
		turnId: value.turnId,
		lastSeq: -1,
		text: "",
		suggestions: [],
		terminal: Option.none(),
	});
	const chat = {
		list: mock.fn(async () => histories),
		history: mock.fn(async (id) => {
			const h = histories.find((h) => h.sessionId === id);
			if (!h) throw new Error("missing history");
			return h;
		}),
		submit: mock.fn(async (value) => {
			accepted = value;
			return initial(value);
		}),
		subscribe: mock.fn((_s, _t, callback) => {
			receive = callback;
			return () => {};
		}),
		snapshot: mock.fn(async () => {
			if (!accepted) throw new Error("missing turn");
			return initial(accepted);
		}),
		cancel: mock.fn(async () => {}),
		close: mock.fn(async () => {}),
		clear: mock.fn(async () => {}),
		rename: mock.fn(async () => {}),
		dispose: mock.fn(async () => {}),
	} satisfies DirectChatBridge;
	const agents: AgentsBridge = {
		request: mock.fn(async () => ({
			_tag: "success" as const,
			view,
			draft: "",
		})),
		onProgress: () => () => {},
		onSnapshot: () => () => {},
	};
	return {
		view,
		chat,
		agents,
		receive: (delivery: ChatDelivery) => receive(delivery),
		input: () => {
			if (!accepted) throw new Error("missing turn");
			return accepted;
		},
	};
}
const button = (text: string) => {
	const found = [
		...document.querySelectorAll<HTMLButtonElement>("button"),
	].find((b) => b.textContent?.trim() === text);
	if (!found) throw new Error(`Missing button ${text}`);
	return found;
};
it.each(["en", "de"] as const)(
	"AI-223: %s New Chat clears draft/session and locks switching during streaming",
	async (locale) => {
		const f = fixture(),
			t = chatStrings(locale);
		const screen = await mount(
			<DirectChatPanel
				bridge={f.chat}
				model={directChatModel(f.view.models)}
				locale={locale}
			/>,
		);
		mounted = screen;
		try {
			assert.deepEqual(
				[...document.querySelectorAll(".cw-session-title")].map(
					(n) => n.textContent,
				),
				["saved 2", "saved 1"],
			);
			const box = element<HTMLTextAreaElement>("textarea");
			await type(box, "discard this draft");
			await click(button(t.newChat));
			assert.equal(box.value, "");
			assert.equal(
				document.querySelector(".cw-session[aria-current=true]"),
				null,
			);
			assert.equal(f.chat.submit.mock.calls.length, 0);
			await type(box, "new question");
			await act(async () => {
				element("form").dispatchEvent(
					new Event("submit", { bubbles: true, cancelable: true }),
				);
			});
			assert.equal(f.chat.submit.mock.calls.length, 1);
			assert.equal(f.input().text, "new question");
			assert(!/00000000000[12]$/.test(f.input().sessionId));
			assert(button(t.newChat).disabled);
			for (const item of document.querySelectorAll<HTMLButtonElement>(
				".cw-session",
			))
				assert(item.disabled);
			const input = f.input();
			await act(async () => {
				f.receive({
					_tag: "chunk",
					chunk: {
						version: 1,
						sessionId: input.sessionId,
						turnId: input.turnId,
						seq: 0,
						type: "answer",
						textDelta: "stream retained",
					},
				});
			});
			await click(button(t.newChat));
			assert(document.body.textContent?.includes("stream retained"));
			assert.equal(f.chat.submit.mock.calls.length, 1);
		} finally {
			await screen.close();
			mounted = undefined;
		}
	},
);
it("AI-227: the real AgentsPage settings callback opens Models and retains the conversation on return", async () => {
	const f = fixture();
	Object.defineProperty(window, "quakeChat", {
		configurable: true,
		value: f.chat,
	});
	const screen = await mount(
		<AppLocaleProvider bridge={null}>
			<AgentsPage bridge={f.agents} />
		</AppLocaleProvider>,
	);
	mounted = screen;
	try {
		const box = element<HTMLTextAreaElement>(".cw-composer textarea");
		await type(box, "keep this draft");
		const selected = element(".cw-session[aria-current=true]").textContent;
		await click(button(chatStrings("en").modelSettings));
		assert.equal(
			element("#agents-tab-ai").getAttribute("aria-selected"),
			"true",
		);
		assert.equal(element<HTMLElement>("#agents-ai").hidden, false);
		assert(
			element<HTMLInputElement>('#agents-ai input[value="fixture-model"]'),
		);
		await click(element<HTMLButtonElement>("#agents-tab-sessions"));
		assert.equal(element<HTMLElement>("#agents-sessions").hidden, false);
		assert.equal(box.value, "keep this draft");
		assert.equal(
			element(".cw-session[aria-current=true]").textContent,
			selected,
		);
		assert.equal(f.chat.list.mock.calls.length, 1);
	} finally {
		await screen.close();
		mounted = undefined;
		Reflect.deleteProperty(window, "quakeChat");
	}
});
