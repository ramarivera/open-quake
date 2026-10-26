import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Layer, ManagedRuntime, Redacted } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelRow } from "../../../../../packages/edge/src/agents/agents-contracts";
import { AiAuthRequired } from "../../../../../packages/edge/src/ai/ai-errors";
import {
	ShortcutPorts,
	ShortcutService,
} from "../../../../../packages/edge/src/shortcuts/shortcut-service";
import { createDirectChat } from "./host";

const row: ModelRow = {
	id: "saved-default",
	role: "default",
	provider: "generic",
	model: "saved-model",
	baseUrl: "https://example.invalid/v1",
	maxTokens: 8000,
	credentialRef: "00000000-0000-4000-8000-000000000001",
};
const generated = JSON.stringify({
	ConfigTitle: "Editor shortcuts",
	ConfigData: [
		{
			title: "Copy",
			config: {
				functionType: "hotkey",
				actions: [{ type: "key", value: "control+c" }],
			},
		},
		{
			title: "Unsafe",
			config: {
				functionType: "cmd",
				actions: [{ type: "shell", value: "private-command" }],
			},
		},
	],
});
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const packet = (content: string, finish_reason: string | null = null) =>
	`data: ${JSON.stringify({ id: "fixture", model: "saved-model", object: "chat.completion.chunk", created: 1, choices: [{ index: 0, delta: { content }, finish_reason }] })}\n\n`;
async function fixture(
	options: {
		text?: string;
		blocked?: boolean;
		credentialFailure?: boolean;
	} = {},
) {
	const directory = await mkdtemp(join(tmpdir(), "oq-shortcut-draft-"));
	cleanups.push(() => rm(directory, { recursive: true, force: true }));
	const requests: {
		body: Record<string, unknown>;
		authorization: string | null;
	}[] = [];
	const resolved: string[] = [];
	let rows: readonly ModelRow[] = [row];
	let started!: () => void;
	const opening = new Promise<void>((resolve) => {
		started = resolve;
	});
	let aborted = false;
	const host = createDirectChat({
		directory,
		models: (scope) => {
			expect(scope).toBe("default");
			return Effect.succeed(rows);
		},
		credentials: {
			resolve: (reference) =>
				Effect.suspend(() => {
					resolved.push(reference);
					return options.credentialFailure
						? Effect.fail(new AiAuthRequired(new Error("private-key-failure")))
						: Effect.succeed(Redacted.make("native-key"));
				}),
			revoked: () => Effect.never,
		},
		fetch: async (_input, init) => {
			requests.push({
				body: JSON.parse(String(init?.body)),
				authorization: new Headers(init?.headers).get("authorization"),
			});
			const stream = new ReadableStream<Uint8Array>({
				start(controller) {
					const signal = init?.signal;
					if (options.blocked)
						signal?.addEventListener(
							"abort",
							() => {
								aborted = true;
								controller.error(new DOMException("Aborted", "AbortError"));
							},
							{ once: true },
						);
					else {
						const text = options.text ?? generated;
						for (let offset = 0; offset < text.length; offset += 7)
							controller.enqueue(
								new TextEncoder().encode(
									packet(text.slice(offset, offset + 7)),
								),
							);
						controller.enqueue(
							new TextEncoder().encode(`${packet("", "stop")}data: [DONE]\n\n`),
						);
						controller.close();
					}
					started();
				},
			});
			return new Response(stream, {
				headers: { "content-type": "text/event-stream" },
			});
		},
	});
	cleanups.push(host.dispose);
	let writes = 0,
		syncs = 0;
	const service = ManagedRuntime.make(
		ShortcutService.Default.pipe(
			Layer.provide(
				Layer.succeed(ShortcutPorts, {
					store: {
						read: async () => ({ version: 1, libraries: [] }),
						write: async () => {
							writes++;
						},
					},
					id: () => "draft-id",
					now: () => "fixture",
					sync: async () => {
						syncs++;
						return "profile";
					},
					draft: host.draftShortcuts,
				}),
			),
		),
	);
	cleanups.push(() => service.dispose());
	return {
		host,
		service,
		requests,
		resolved,
		opening,
		aborted: () => aborted,
		writes: () => writes,
		syncs: () => syncs,
		setRows: (value: readonly ModelRow[]) => {
			rows = value;
		},
	};
}

describe("saved-model shortcut drafting through the production facade", () => {
	it("assembles fragmented output, validates inert hotkeys and never persists chat, libraries or profiles", async () => {
		const f = await fixture();
		const result = await f.service.runPromise(
			ShortcutService.generate("Editor", "copy text"),
		);
		expect(result).toMatchObject({
			title: "Editor shortcuts",
			rows: [{ name: "Copy", chord: "control+c", app: "Editor" }],
			dropped: 1,
		});
		expect(f.resolved).toEqual([row.credentialRef]);
		expect(f.requests).toHaveLength(1);
		expect(f.requests[0]).toMatchObject({
			authorization: "Bearer native-key",
			body: {
				model: "saved-model",
				max_tokens: 4096,
				messages: [
					{ role: "system" },
					{ role: "user", content: "Editor：copy text" },
				],
			},
		});
		expect(f.requests[0]?.body).not.toHaveProperty("tools");
		expect(await f.host.runtime.runPromise(f.host.list())).toEqual([]);
		expect(f.writes()).toBe(0);
		expect(f.syncs()).toBe(0);
	});
	it("uses a newly selected model only for the next draft", async () => {
		const f = await fixture();
		await f.host.draftShortcuts("Editor：copy");
		f.setRows([{ ...row, model: "replacement", maxTokens: 200 }]);
		await f.host.draftShortcuts("Editor：paste");
		expect(
			f.requests.map((request) => [
				request.body.model,
				request.body.max_tokens,
			]),
		).toEqual([
			["saved-model", 4096],
			["replacement", 200],
		]);
	});
	for (const scenario of [
		"missing-model",
		"missing-credential",
		"vault-failure",
	]) {
		it(`refuses ${scenario} without dispatch or writes`, async () => {
			const f = await fixture({
				credentialFailure: scenario === "vault-failure",
			});
			if (scenario === "missing-model") f.setRows([]);
			if (scenario === "missing-credential")
				f.setRows([{ ...row, credentialRef: "" }]);
			const result = await f.service.runPromise(
				ShortcutService.generate("Editor", "copy").pipe(Effect.either),
			);
			expect(Either.isLeft(result) && result.left.code).toBe(
				"INTEGRATION.DRAFT.UNAVAILABLE",
			);
			expect(JSON.stringify(result)).not.toContain("private-key-failure");
			expect(f.requests).toHaveLength(0);
			expect(f.writes()).toBe(0);
		});
	}
	for (const text of ["not JSON", "", "界".repeat(11000)]) {
		it(`rejects invalid or excessive output of ${text.length} characters`, async () => {
			const f = await fixture({ text });
			const result = await f.service.runPromise(
				ShortcutService.generate("Editor", "copy").pipe(Effect.either),
			);
			expect(Either.isLeft(result)).toBe(true);
			expect(f.writes()).toBe(0);
			expect(f.syncs()).toBe(0);
		});
	}
	it("rejects overlapping drafts and aborts the provider when the caller cancels", async () => {
		const f = await fixture({ blocked: true });
		const controller = new AbortController();
		const pending = f.host.draftShortcuts("Editor：copy", controller.signal);
		const rejected = pending.then(
			() => null,
			(error: unknown) => error,
		);
		await f.opening;
		await expect(f.host.draftShortcuts("Editor：paste")).rejects.toMatchObject({
			code: "AI.PROVIDER.UNAVAILABLE",
		});
		expect(f.requests).toHaveLength(1);
		controller.abort();
		expect(await rejected).not.toBeNull();
		expect(f.aborted()).toBe(true);
	});
	it("joins cancelled generation on disposal and refuses later starts", async () => {
		const f = await fixture({ blocked: true });
		const pending = f.host.draftShortcuts("Editor：copy");
		const rejected = pending.then(
			() => null,
			(error: unknown) => error,
		);
		await f.opening;
		const close = f.host.dispose();
		expect(f.host.dispose()).toBe(close);
		await close;
		expect(await rejected).not.toBeNull();
		expect(f.aborted()).toBe(true);
		await expect(f.host.draftShortcuts("Editor：paste")).rejects.toBeDefined();
		expect(f.requests).toHaveLength(1);
	});
});
