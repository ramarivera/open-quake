// @vitest-environment happy-dom
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Option, Redacted, Schema, Scope } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { defaultAssistantSettings } from "../../../../../packages/device/src/profiles/assistant-contracts";
import { initialAgentState } from "../../../../../packages/edge/src/agents/agents-invariants";
import {
	SessionId,
	TurnId,
} from "../../../../../packages/edge/src/chat/chat-contracts";
import { AppLocaleProvider } from "../../renderer/src/i18n";
import { AgentsPage } from "../../renderer/src/management/agents/AgentsPage";
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
import type {
	AgentsBridge,
	AgentView,
	PublicModelRow,
} from "../../shared/agents";
import { CHAT_DISCONNECT, CHAT_REQUEST } from "../../shared/chat";
import { createModelCredentials } from "./credentials";
import { createDirectChat } from "./host";
import { createDirectChatBridge } from "./preload";
import { makeDesktopChatConnection } from "./rpc-server";

const sid = () => Schema.decodeUnknownSync(SessionId)(randomUUID());
const tid = () => Schema.decodeUnknownSync(TurnId)(randomUUID());
afterEach(() => vi.unstubAllGlobals());
async function fixture(missingMain = false) {
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
		models: (scope) =>
			Effect.succeed(
				scope === "main" && missingMain
					? [
							{
								id: "main-keyless",
								role: "default",
								provider: "generic",
								model: "keyless",
								baseUrl: "https://fake.invalid/v1",
								maxTokens: 512,
								credentialRef: "",
							},
						]
					: [
							{
								id: "configured",
								role: "default",
								provider: "generic",
								model: "fixture-model",
								baseUrl: "http://127.0.0.1:1/v1",
								maxTokens: 512,
								credentialRef,
							},
						],
			),
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

const readyRow: PublicModelRow = {
	id: "configured",
	role: "default",
	provider: "generic",
	model: "fixture-model",
	baseUrl: "http://127.0.0.1:1/v1",
	maxTokens: 512,
	credentialAvailable: true,
};
function agentsBridge() {
	let view: AgentView = {
		...initialAgentState(),
		models: {
			default: [readyRow],
			main: [
				{
					...readyRow,
					id: "main-keyless",
					model: "keyless",
					credentialAvailable: false,
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
	let snapshot: (view: AgentView) => void = () => {};
	const bridge: AgentsBridge & {
		credentialAvailable: (ready: boolean) => void;
	} = {
		credentialAvailable: (ready) => {
			view = {
				...view,
				revision: view.revision + 1,
				models: {
					...view.models,
					default: [{ ...readyRow, credentialAvailable: ready }],
				},
			};
			snapshot(view);
		},
		request: vi.fn(async () => ({ _tag: "success" as const, view, draft: "" })),
		onSnapshot: (listener) => {
			snapshot = listener;
			return () => {};
		},
		onProgress: () => () => {},
	};
	return bridge;
}

it("PR128 mounted AgentsPage enables explicit persona and key models without changing the keyless main default", async () => {
	const f = await fixture(true);
	const key = sid();
	vi.stubGlobal("quakeChat", f.bridge);
	const management = agentsBridge();
	const app = await mount(
		<AppLocaleProvider bridge={null}>
			<AgentsPage bridge={management} />
		</AppLocaleProvider>,
	);
	const composer = () =>
		query(app.host, ".cw-composer textarea", HTMLTextAreaElement);
	try {
		await settle(() =>
			expect(app.host.textContent).toContain("Set up a model to chat"),
		);
		expect(composer().disabled).toBe(true);
		await f.bridge.persona?.update({
			...f.settings("Valid global"),
			modelRowId: "configured",
		});
		await settle(() => expect(composer().disabled).toBe(false));
		expect(app.host.textContent).toContain(
			"Answers from generic / fixture-model",
		);
		management.credentialAvailable(false);
		await settle(() => expect(composer().disabled).toBe(true));
		management.credentialAvailable(true);
		await settle(() => expect(composer().disabled).toBe(false));
		await input(composer(), "global with explicit model");
		await click(button(app.host, "Send"));
		await settle(() => expect(f.calls.at(-1)).toContain("Valid global"));
		await settle(() =>
			expect(button(app.host, "New chat").disabled).toBe(false),
		);
		await f.bridge.persona?.update(f.settings("Keyless global"));
		await settle(() => expect(composer().disabled).toBe(true));
		await f.host.runtime.runPromise(
			f.host.selectAssistant(
				key,
				{ ...f.settings("Key persona"), modelRowId: "configured" },
				"dictated for key",
			),
		);
		await settle(() => expect(composer().value).toBe("dictated for key"));
		await settle(() => expect(composer().disabled).toBe(false));
		await click(button(app.host, "Send"));
		await settle(() => expect(f.calls.at(-1)).toContain("Key persona"));
		await settle(() =>
			expect(button(app.host, "New chat").disabled).toBe(false),
		);
		// An update of this session must refresh readiness without another selection generation.
		const selected = await f.bridge.selection?.();
		await f.bridge.persona?.update(
			{ ...f.settings("Key unavailable"), modelRowId: "missing" },
			selected?.generation,
		);
		await settle(() => expect(composer().disabled).toBe(true));
		await f.bridge.persona?.update(
			{ ...f.settings("Key restored"), modelRowId: "configured" },
			selected?.generation,
		);
		await settle(() => expect(composer().disabled).toBe(false));
		await click(button(app.host, "New chat"));
		await settle(() => expect(composer().disabled).toBe(true));
		const keyTitle = (await f.bridge.history(key)).title;
		const history = Array.from(
			app.host.querySelectorAll("button.cw-session"),
		).find(
			(b) => b.querySelector(".cw-session-title")?.textContent === keyTitle,
		);
		if (!(history instanceof HTMLButtonElement))
			throw new Error("missing key history");
		await click(history);
		await settle(() => expect(composer().disabled).toBe(false));
		await input(composer(), "reopened key");
		await click(button(app.host, "Send"));
		await settle(() => expect(f.calls.at(-1)).toContain("Key restored"));
		expect(management.request).toHaveBeenCalled();
		expect(
			vi
				.mocked(management.request)
				.mock.calls.every(([request]) => request.type === "read"),
		).toBe(true);
	} finally {
		await app.close();
		await f.close();
	}
});

it("PR128 mounted composer discards a persona read that finishes after New chat", async () => {
	const f = await fixture(true);
	const key = sid();
	await f.host.runtime.runPromise(
		f.host.selectAssistant(key, {
			...f.settings("Valid key"),
			modelRowId: "configured",
		}),
	);
	await f.submit(key, "seed key history");
	const original = f.bridge.persona;
	if (!original) throw new Error("missing persona");
	const read = vi.fn(original.read);
	const bridge = { ...f.bridge, persona: { ...original, read } };
	vi.stubGlobal("quakeChat", bridge);
	const app = await mount(
		<AppLocaleProvider bridge={null}>
			<AgentsPage bridge={agentsBridge()} />
		</AppLocaleProvider>,
	);
	let release = () => {};
	try {
		const composer = () =>
			query(app.host, ".cw-composer textarea", HTMLTextAreaElement);
		await settle(() => expect(composer().disabled).toBe(false));
		const pending = new Promise<ReturnType<typeof f.settings>>((resolve) => {
			release = () =>
				resolve({ ...f.settings("Stale valid key"), modelRowId: "configured" });
		});
		read.mockImplementationOnce(() => pending);
		const calls = read.mock.calls.length;
		await vi.waitFor(() =>
			expect(read.mock.calls.length).toBeGreaterThan(calls),
		);
		await click(button(app.host, "New chat"));
		await vi.waitFor(async () => expect(await bridge.selection?.()).toBeNull());
		await settle(() => expect(composer().disabled).toBe(true));
		release();
		await settle(() =>
			expect(app.host.textContent).toContain("Set up a model to chat"),
		);
		expect(composer().disabled).toBe(true);
		expect(app.host.textContent).not.toContain(
			"Answers from generic / fixture-model",
		);
	} finally {
		release();
		await app.close();
		await f.close();
	}
});
