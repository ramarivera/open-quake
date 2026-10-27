// @vitest-environment happy-dom
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Option, Redacted, Schema, Scope } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { defaultAssistantSettings } from "../../../../../packages/device/src/profiles/assistant-contracts";
import {
	SessionId,
	TurnId,
} from "../../../../../packages/edge/src/chat/chat-contracts";
import { PersonaSettings } from "../../renderer/src/management/agents/PersonaSettings";
import { DirectChatPanel } from "../../renderer/src/management/chat/DirectChatPanel";
import {
	button,
	click,
	input,
	mount,
	query,
	settle,
} from "../../renderer/test/dom";
import { CHAT_DISCONNECT, CHAT_REQUEST } from "../../shared/chat";
import { createModelCredentials } from "./credentials";
import { createDirectChat } from "./host";
import { createDirectChatBridge } from "./preload";
import { makeDesktopChatConnection } from "./rpc-server";

const sid = () => Schema.decodeUnknownSync(SessionId)(randomUUID());
const tid = () => Schema.decodeUnknownSync(TurnId)(randomUUID());
afterEach(() => vi.unstubAllGlobals());
async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), "oq-navigation-"));
	const credentials = await Effect.runPromise(
		createModelCredentials({
			put: async () => randomUUID(),
			get: async () => "fake-key",
			remove: async () => {},
		}),
	);
	const credentialRef = await Effect.runPromise(
		credentials.management.store(Redacted.make("fake-key")),
	);
	const calls: string[] = [];
	const host = createDirectChat({
		directory,
		credentials: credentials.ai,
		online: () => true,
		models: () =>
			Effect.succeed([
				{
					id: "configured",
					role: "default",
					provider: "generic",
					model: "fixture-model",
					baseUrl: "http://127.0.0.1:1/v1",
					maxTokens: 512,
					credentialRef,
				},
			]),
		fetch: async (_url, init) => {
			calls.push(String(init?.body));
			return new Response(
				`data: ${JSON.stringify({ id: "fixture", model: "fixture-model", choices: [{ index: 0, delta: { content: "answer" }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "fixture", model: "fixture-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 1, total_tokens: 21 } })}\n\ndata: [DONE]\n\n`,
				{ headers: { "content-type": "text/event-stream" } },
			);
		},
	});
	const connect = async () => {
		const listeners = new Set<(event: unknown, input: unknown) => void>();
		const scope = await host.runtime.runPromise(Scope.make());
		const connection = await host.runtime.runPromise(
			makeDesktopChatConnection(host, (m) => {
				for (const l of listeners) l({}, m);
			}).pipe(Scope.extend(scope)),
		);
		return createDirectChatBridge({
			invoke: async (channel, value) => {
				if (channel === CHAT_REQUEST)
					return host.runtime.runPromise(connection.write(value));
				if (channel === CHAT_DISCONNECT)
					return host.runtime.runPromise(Scope.close(scope, Exit.void));
				throw new Error("unexpected channel");
			},
			on: (_channel, l) => listeners.add(l),
			removeListener: (_channel, l) => listeners.delete(l),
		});
	};
	const bridge = await connect();
	const settings = (customPrompt: string) => ({
		...defaultAssistantSettings(),
		useAgent: false,
		roleId: -1,
		customPrompt,
	});
	await bridge.persona?.update(settings("Global persona"));
	const submit = async (sessionId: SessionId, text: string) => {
		const turnId = tid();
		await bridge.submit({ sessionId, turnId, text });
		await vi.waitFor(async () =>
			expect(
				Option.isSome((await bridge.snapshot(sessionId, turnId)).terminal),
			).toBe(true),
		);
	};
	return {
		host,
		bridge,
		connect,
		calls,
		settings,
		submit,
		close: async () => {
			await bridge.dispose();
			await host.dispose();
			await rm(directory, { recursive: true });
		},
	};
}

it.each(["new", "history"])(
	"PR128 final mounted %s navigation directs persona Update to the opened conversation",
	async (mode) => {
		const f = await fixture();
		const key = sid(),
			ordinary = sid();
		await f.submit(ordinary, "Ordinary");
		await f.host.runtime.runPromise(
			f.host.selectAssistant(key, f.settings("Key persona")),
		);
		await f.submit(key, "Key");
		vi.stubGlobal("quakeChat", f.bridge);
		const app = await mount(
			<>
				<DirectChatPanel
					bridge={f.bridge}
					model={{ ready: true, row: undefined }}
				/>
				<PersonaSettings rows={[]} />
			</>,
		);
		try {
			const persona = query(
				app.host,
				'[aria-label="Assistant personality"]',
				HTMLElement,
			);
			await settle(() =>
				expect(query(persona, "textarea", HTMLTextAreaElement).value).toBe(
					"Key persona",
				),
			);
			await settle(() =>
				expect(
					app.host.querySelector('[aria-current="true"]')?.textContent,
				).toContain("Key"),
			);
			if (mode === "new") await click(button(app.host, "New chat"));
			else {
				const history = Array.from(
					app.host.querySelectorAll("button.cw-session"),
				).find((b) => b.textContent?.includes("Ordinary"));
				if (!(history instanceof HTMLButtonElement))
					throw new Error("history button missing");
				await click(history);
			}
			await settle(() =>
				expect(query(persona, "textarea", HTMLTextAreaElement).value).toBe(
					"Global persona",
				),
			);
			expect(await f.bridge.selection?.()).toBeNull();
			await input(
				query(persona, "textarea", HTMLTextAreaElement),
				"Opened persona",
			);
			await click(button(persona, "Update"));
			await settle(() =>
				expect(persona.textContent).toContain("Assistant updated."),
			);
			expect((await f.bridge.persona?.read())?.customPrompt).toBe(
				"Opened persona",
			);
			const composer = query(
				app.host,
				".cw-composer textarea",
				HTMLTextAreaElement,
			);
			await input(composer, "next in opened chat");
			await click(button(app.host, "Send"));
			await settle(() => expect(f.calls.at(-1)).toContain("Opened persona"));
			expect(f.calls.at(-1)).not.toContain("Key persona");
			await settle(() =>
				expect(button(app.host, "New chat").disabled).toBe(false),
			);
			const keyHistory = Array.from(
				app.host.querySelectorAll("button.cw-session"),
			).find((b) => b.textContent?.includes("Key"));
			if (!(keyHistory instanceof HTMLButtonElement))
				throw new Error("key history button missing");
			await click(keyHistory);
			await settle(() =>
				expect(query(persona, "textarea", HTMLTextAreaElement).value).toBe(
					"Key persona",
				),
			);
			const selected = await f.bridge.selection?.();
			expect(selected?.sessionId).toBe(key);
			await f.bridge.persona?.update(
				f.settings("Reopened key"),
				selected?.generation,
			);
			await f.submit(key, "key again");
			expect(f.calls.at(-1)).toContain("Reopened key");
			const other = sid();
			await f.submit(other, "global still shared");
			expect(f.calls.at(-1)).toContain("Opened persona");
		} finally {
			await app.close();
			await f.close();
		}
	},
);

it("PR128 final navigation retains same-session updates and rejects stale or foreign destinations", async () => {
	const f = await fixture();
	const other = await f.connect();
	const key = sid(),
		ordinary = sid(),
		newer = sid();
	try {
		await f.host.runtime.runPromise(
			f.host.selectAssistant(
				key,
				f.settings("Key persona"),
				"pending dictation",
			),
		);
		const selected = await f.bridge.selection?.();
		if (!selected || !f.bridge.navigate || !other.navigate)
			throw new Error("missing navigation bridge");
		await f.bridge.persona?.update(
			f.settings("Local update"),
			selected.generation,
		);
		expect(await f.bridge.navigate(key, selected.generation)).toMatchObject({
			sessionId: key,
			generation: selected.generation,
			transcript: "pending dictation",
			settings: { customPrompt: "Local update" },
		});
		await expect(
			other.navigate(ordinary, selected.generation),
		).rejects.toMatchObject({ code: "CHAT.INPUT.INVALID" });
		expect(await f.bridge.navigate(ordinary, selected.generation)).toBeNull();
		await expect(
			f.bridge.persona?.update(f.settings("Stale draft"), selected.generation),
		).rejects.toMatchObject({ code: "CHAT.INPUT.INVALID" });
		// The old owned key stays protected even after its device selection is released.
		await expect(other.navigate(key, null)).rejects.toMatchObject({
			code: "CHAT.INPUT.INVALID",
		});
		expect(await f.bridge.selection?.()).toBeNull();
		const reopened = await f.bridge.navigate(key, null);
		expect(reopened?.settings.customPrompt).toBe("Local update");
		expect(reopened?.generation).toBeGreaterThan(selected.generation);
		expect(reopened?.transcript).toBeUndefined();
		await f.host.runtime.runPromise(
			f.host.selectAssistant(newer, f.settings("Newer key"), "newer dictation"),
		);
		await expect(
			f.bridge.navigate(ordinary, reopened?.generation ?? null),
		).rejects.toMatchObject({ code: "CHAT.INPUT.INVALID" });
		expect(await f.bridge.selection?.()).toMatchObject({
			sessionId: newer,
			transcript: "newer dictation",
		});
	} finally {
		await other.dispose();
		await f.close();
	}
});
