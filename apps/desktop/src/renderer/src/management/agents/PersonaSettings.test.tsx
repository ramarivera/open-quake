// @vitest-environment happy-dom
import { Schema } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { defaultAssistantSettings } from "../../../../../../../packages/device/src/profiles/assistant-contracts";
import { SessionId } from "../../../../../../../packages/edge/src/chat/chat-contracts";
import type { AssistantSelection } from "../../../../../../../packages/edge/src/chat/chat-rpc";
import { button, click, mount, query, settle } from "../../../test/dom";
import { PersonaSettings } from "./PersonaSettings";

afterEach(() => vi.unstubAllGlobals());
const selection = (generation: number): AssistantSelection => ({
	generation,
	sessionId: Schema.decodeUnknownSync(SessionId)(crypto.randomUUID()),
	settings: {
		...defaultAssistantSettings(),
		useAgent: false,
		roleId: -1,
		customPrompt: `Key ${generation}`,
	},
});

it("PR128 refreshes a mounted persona on key switches and ignores a late prior read", async () => {
	let current = selection(1);
	let release: (value: typeof current.settings) => void = () => {};
	const pending = new Promise<typeof current.settings>((resolve) => {
		release = resolve;
	});
	const read = vi
		.fn(async () => current.settings)
		.mockImplementationOnce(() => pending);
	const update = vi.fn(async (settings: typeof current.settings) => settings);
	vi.stubGlobal("quakeChat", {
		selection: async () => current,
		persona: { read, update },
	});
	const app = await mount(<PersonaSettings rows={[]} />);
	try {
		await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
		const first = current;
		current = selection(2);
		await settle(() =>
			expect(query(app.host, "textarea", HTMLTextAreaElement).value).toBe(
				"Key 2",
			),
		);
		release(first.settings);
		await click(button(app.host, "Update"));
		expect(update).toHaveBeenCalledWith(current.settings, current.generation);
		expect(query(app.host, "textarea", HTMLTextAreaElement).value).toBe(
			"Key 2",
		);
	} finally {
		release(current.settings);
		await app.close();
	}
});

it("PR128 discards a pending Update result after the destination changes", async () => {
	let current = selection(1);
	let release: (value: typeof current.settings) => void = () => {};
	const pending = new Promise<typeof current.settings>((resolve) => {
		release = resolve;
	});
	const update = vi.fn(() => pending);
	vi.stubGlobal("quakeChat", {
		selection: async () => current,
		persona: { read: async () => current.settings, update },
	});
	const app = await mount(<PersonaSettings rows={[]} />);
	try {
		await settle(() =>
			expect(query(app.host, "textarea", HTMLTextAreaElement).value).toBe(
				"Key 1",
			),
		);
		const first = current;
		await click(button(app.host, "Update"));
		expect(update).toHaveBeenCalledWith(first.settings, first.generation);
		current = selection(2);
		await settle(() =>
			expect(query(app.host, "textarea", HTMLTextAreaElement).value).toBe(
				"Key 2",
			),
		);
		release(first.settings);
		await settle(() =>
			expect(query(app.host, "textarea", HTMLTextAreaElement).value).toBe(
				"Key 2",
			),
		);
		expect(app.host.textContent).not.toContain("Assistant updated");
		expect(button(app.host, "Update").disabled).toBe(false);
	} finally {
		release(current.settings);
		await app.close();
	}
});
