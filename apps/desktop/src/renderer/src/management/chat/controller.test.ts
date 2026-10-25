import { Option, Schema } from "effect";
import { describe, expect, it, vi } from "vitest";
import {
	SessionId,
	TurnId,
	type TurnSnapshot,
} from "../../../../../../../packages/edge/src/chat/chat-contracts";
import type {
	ChatDelivery,
	ChatInput,
	PublicChatHistory,
} from "../../../../../../../packages/edge/src/chat/chat-rpc";
import type { DirectChatBridge } from "../../../../shared/chat";
import { createChatController } from "./controller";

function fixture() {
	let receive: (delivery: ChatDelivery) => void = () => {};
	let input: ChatInput | undefined;
	const initial = (value: ChatInput): TurnSnapshot => ({
		sessionId: value.sessionId,
		turnId: value.turnId,
		lastSeq: -1,
		text: "",
		suggestions: [],
		terminal: Option.none(),
	});
	const off = vi.fn();
	const bridge: DirectChatBridge = {
		submit: vi.fn(async (value) => {
			input = value;
			return initial(value);
		}),
		subscribe: vi.fn((_session, _turn, callback) => {
			receive = callback;
			return off;
		}),
		snapshot: vi.fn(async (): Promise<TurnSnapshot> => {
			if (!input) throw new Error("missing turn");
			return {
				...initial(input),
				lastSeq: 3,
				text: "restored answer",
				terminal: Option.some({ outcome: "completed" }),
			};
		}),
		list: vi.fn(async (): Promise<readonly PublicChatHistory[]> => []),
		cancel: vi.fn(async () => {}),
		close: vi.fn(async () => {}),
		clear: vi.fn(async () => {}),
		rename: vi.fn(async () => {}),
		history: vi.fn(async () => {
			throw new Error("unused");
		}),
		dispose: vi.fn(async () => {}),
	};
	return {
		bridge,
		off,
		receive: (delivery: ChatDelivery) => receive(delivery),
		input: () => {
			if (!input) throw new Error("missing turn");
			return input;
		},
	};
}

describe("direct chat renderer lifecycle", () => {
	it("recovers a sequence gap from a snapshot without replaying provider input", async () => {
		const f = fixture(),
			controller = createChatController(f.bridge);
		await controller.submit("keep user input");
		const identity = f.input();
		f.receive({
			_tag: "chunk",
			chunk: {
				version: 1,
				sessionId: identity.sessionId,
				turnId: identity.turnId,
				seq: 2,
				type: "answer",
				textDelta: "gap",
			},
		});
		await vi.waitFor(() =>
			expect(controller.getSnapshot().pending).toBe(false),
		);
		expect(controller.getSnapshot()).toMatchObject({
			input: "keep user input",
			turn: { text: "restored answer" },
		});
		expect(f.bridge.submit).toHaveBeenCalledOnce();
		expect(f.bridge.snapshot).toHaveBeenCalledOnce();
		controller.dispose();
	});
	it("cancels an accepted turn that arrives after its view closed", async () => {
		const f = fixture();
		let accept: (snapshot: TurnSnapshot) => void = () => {};
		vi.mocked(f.bridge.submit).mockImplementation(
			(value) =>
				new Promise((resolve) => {
					accept = () =>
						resolve({
							sessionId: value.sessionId,
							turnId: value.turnId,
							lastSeq: -1,
							text: "",
							suggestions: [],
							terminal: Option.none(),
						});
				}),
		);
		const controller = createChatController(f.bridge);
		const submit = controller.submit("private input");
		controller.dispose();
		accept({
			sessionId: Schema.decodeUnknownSync(SessionId)(crypto.randomUUID()),
			turnId: Schema.decodeUnknownSync(TurnId)(crypto.randomUUID()),
			lastSeq: -1,
			text: "",
			suggestions: [],
			terminal: Option.none(),
		});
		await submit;
		expect(f.bridge.cancel).toHaveBeenCalled();
		expect(f.bridge.subscribe).not.toHaveBeenCalled();
	});
	it("keeps a failed history refresh from unlocking a running turn", async () => {
		const f = fixture(),
			controller = createChatController(f.bridge);
		await controller.submit("blocked");
		vi.mocked(f.bridge.list).mockRejectedValue({ code: "CHAT.STORAGE.FAILED" });
		await controller.refresh();
		expect(controller.getSnapshot()).toMatchObject({
			pending: true,
			error: "CHAT.STORAGE.FAILED",
		});
		await controller.submit("duplicate");
		expect(f.bridge.submit).toHaveBeenCalledOnce();
		controller.dispose();
	});
	it("discards stale history refreshes after selecting a new conversation", async () => {
		const f = fixture();
		let release: (value: readonly PublicChatHistory[]) => void = () => {};
		vi.mocked(f.bridge.list).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		const controller = createChatController(f.bridge),
			old = controller.refresh();
		const selected = Schema.decodeUnknownSync(SessionId)(crypto.randomUUID());
		await controller.select(selected);
		release([]);
		await old;
		expect(controller.getSnapshot()).toMatchObject({
			sessionId: selected,
			loading: false,
		});
		controller.dispose();
	});
});
