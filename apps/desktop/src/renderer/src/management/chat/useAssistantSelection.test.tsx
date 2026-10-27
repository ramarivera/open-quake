// @vitest-environment happy-dom
import { Schema } from "effect";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { defaultAssistantSettings } from "../../../../../../../packages/device/src/profiles/assistant-contracts";
import { SessionId } from "../../../../../../../packages/edge/src/chat/chat-contracts";
import type { DirectChatBridge } from "../../../../shared/chat";
import { mount, settle } from "../../../test/dom";
import { createChatController } from "./controller";
import { useAssistantSelection } from "./useAssistantSelection";

afterEach(() => vi.unstubAllGlobals());

function fixture() {
	const selection = {
		generation: 1,
		sessionId: Schema.decodeUnknownSync(SessionId)(crypto.randomUUID()),
		settings: defaultAssistantSettings(),
		transcript: "dictated text",
	};
	const acknowledge = vi.fn(async (_generation: number) => {});
	const list = vi.fn(async (): Promise<readonly []> => []);
	const bridge: DirectChatBridge = {
		selection: async () => selection,
		acknowledgeSelection: acknowledge,
		assistantVisibility: vi.fn(async () => {}),
		list,
		submit: vi.fn(async () => {
			throw new Error("dictation must not submit");
		}),
		subscribe: () => () => {},
		snapshot: async () => {
			throw new Error("unused");
		},
		cancel: async () => {},
		close: async () => {},
		clear: async () => {},
		rename: async () => {},
		history: async () => {
			throw new Error("unused");
		},
		dispose: async () => {},
	};
	const controller = createChatController(bridge);
	function Consumer() {
		const [text, setText] = useState("existing draft");
		useAssistantSelection(bridge, controller, false, setText);
		return <output>{text}</output>;
	}
	return { selection, bridge, acknowledge, list, controller, Consumer };
}

it("AI-088 mounts dictation once and retries a failed acknowledgement without submitting", async () => {
	const f = fixture();
	f.acknowledge.mockRejectedValueOnce(new Error("temporary disconnect"));
	const app = await mount(<f.Consumer />);
	try {
		await vi.waitFor(() =>
			expect(f.bridge.acknowledgeSelection).toHaveBeenCalledTimes(2),
		);
		expect(app.host.textContent).toBe("existing draft\ndictated text");
		expect(f.controller.getSnapshot().sessionId).toBe(f.selection.sessionId);
		expect(f.bridge.submit).not.toHaveBeenCalled();
	} finally {
		await app.close();
		f.controller.dispose();
	}
	expect(f.bridge.assistantVisibility).toHaveBeenLastCalledWith(false);
});

it("AI-088 doesn't install or acknowledge dictation after the user switches session during history loading", async () => {
	const f = fixture();
	let release = () => {};
	const loading = new Promise<readonly []>((resolve) => {
		release = () => resolve([]);
	});
	f.list.mockImplementation(() => loading);
	const app = await mount(<f.Consumer />);
	try {
		const other = Schema.decodeUnknownSync(SessionId)(crypto.randomUUID());
		const switching = f.controller.select(other);
		release();
		await switching;
		await settle(() => expect(app.host.textContent).toBe("existing draft"));
		expect(app.host.textContent).toBe("existing draft");
		expect(f.bridge.acknowledgeSelection).not.toHaveBeenCalled();
		expect(f.controller.getSnapshot().sessionId).toBe(other);
	} finally {
		release();
		await app.close();
		f.controller.dispose();
	}
});

it("PR128 final discards a selection read started before desktop navigation", async () => {
	const f = fixture();
	let release: () => void = () => {};
	const pending = new Promise<typeof f.selection>((resolve) => {
		release = () => resolve(f.selection);
	});
	const selection = vi.fn(() => pending);
	const bridge = { ...f.bridge, selection };
	const controller = createChatController(bridge);
	function Consumer() {
		const [text, setText] = useState("");
		useAssistantSelection(bridge, controller, false, setText);
		return <output>{text}</output>;
	}
	const app = await mount(<Consumer />);
	try {
		await vi.waitFor(() => expect(selection).toHaveBeenCalled());
		const ordinary = Schema.decodeUnknownSync(SessionId)(crypto.randomUUID());
		await controller.select(ordinary);
		release();
		await settle(() => expect(selection).toHaveBeenCalledTimes(2));
		expect(controller.getSnapshot().sessionId).toBe(ordinary);
		expect(app.host.textContent).toBe("");
		expect(f.acknowledge).not.toHaveBeenCalled();
	} finally {
		release();
		await app.close();
		controller.dispose();
		f.controller.dispose();
	}
});
