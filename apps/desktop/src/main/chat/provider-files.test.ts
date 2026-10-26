import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit, Redacted, Scope } from "effect";
import { expect, it } from "vitest";
import type { ModelRow } from "../../../../../packages/edge/src/agents/agents-contracts";
import { CHAT_DISCONNECT, CHAT_REQUEST } from "../../shared/chat";
import { createDirectChat } from "./host";
import { createDirectChatBridge } from "./preload";
import { makeDesktopChatConnection } from "./rpc-server";

async function fixture(fetcher: typeof fetch) {
	const directory = await mkdtemp(join(tmpdir(), "oq-provider-files-"));
	let row: ModelRow = {
		id: "saved",
		role: "default",
		provider: "openai",
		model: "gpt-4o",
		maxTokens: 1024,
		baseUrl: "https://selected.invalid/v1",
		credentialRef: randomUUID(),
		settings: { filesEnabled: true },
	};
	const host = createDirectChat({
		directory,
		models: () => Effect.succeed([row]),
		credentials: {
			resolve: () => Effect.succeed(Redacted.make("selected-secret")),
			revoked: () => Effect.never,
		},
		fetch: fetcher,
		online: () => true,
	});
	const listeners = new Set<(event: unknown, input: unknown) => void>();
	const scope = await host.runtime.runPromise(Scope.make());
	const connection = await host.runtime.runPromise(
		makeDesktopChatConnection(host, (message) => {
			for (const listener of listeners) listener({}, message);
		}).pipe(Scope.extend(scope)),
	);
	const bridge = createDirectChatBridge({
		invoke: async (channel, input) => {
			if (channel === CHAT_REQUEST)
				return host.runtime.runPromise(connection.write(input));
			if (channel === CHAT_DISCONNECT)
				return host.runtime.runPromise(Scope.close(scope, Exit.void));
			throw new Error("channel");
		},
		on: (_channel, listener) => listeners.add(listener),
		removeListener: (_channel, listener) => listeners.delete(listener),
	});
	return {
		disableFiles: () => {
			row = { ...row, settings: { filesEnabled: false } };
		},
		host,
		bridge,
		close: async () => {
			await bridge.dispose();
			await host.dispose();
			await rm(directory, { recursive: true, force: true });
		},
	};
}
it("AI-017/038/244 typed preload IPC isolates destinations and correlates concurrent CRUD", async () => {
	const calls: string[] = [];
	const f = await fixture(async (url, init) => {
		calls.push(String(url));
		expect(init?.redirect).toBe("error");
		expect(new Headers(init?.headers).get("authorization")).toBe(
			"Bearer selected-secret",
		);
		return Response.json({
			id: String(url).split("/").at(-1),
			filename: "fixture.txt",
			bytes: 7,
			purpose: "assistants",
		});
	});
	try {
		expect(await f.bridge.providers?.()).toMatchObject([
			{ id: "saved", available: true, directCapable: true },
		]);
		const a = randomUUID(),
			b = randomUUID();
		const result = await Promise.all([
			f.bridge.files?.({
				requestId: a,
				modelRowId: "saved",
				operation: { _tag: "retrieve", fileId: "file-a" },
			}),
			f.bridge.files?.({
				requestId: b,
				modelRowId: "saved",
				operation: { _tag: "retrieve", fileId: "file-b" },
			}),
		]);
		expect(result).toMatchObject([
			{ requestId: a, result: { _tag: "metadata", file: { id: "file-a" } } },
			{ requestId: b, result: { _tag: "metadata", file: { id: "file-b" } } },
		]);
		expect(calls.sort()).toEqual([
			"https://selected.invalid/v1/files/file-a",
			"https://selected.invalid/v1/files/file-b",
		]);
		await expect(
			f.bridge.files?.({
				requestId: randomUUID(),
				modelRowId: "other",
				operation: { _tag: "list" },
			}),
		).rejects.toMatchObject({ code: "AI.PROVIDER.CONFIG_INVALID" });
		f.disableFiles();
		await expect(
			f.bridge.files?.({
				requestId: randomUUID(),
				modelRowId: "saved",
				operation: { _tag: "upload", name: "fixture.txt", content: "local" },
			}),
		).rejects.toMatchObject({ code: "AI.PROVIDER.CONFIG_INVALID" });
		expect(calls).toHaveLength(2);
	} finally {
		await f.close();
	}
});
it("AI-244 disposal interrupts a pending upload and aborts provider I/O", async () => {
	let started: () => void = () => {};
	const ready = new Promise<void>((resolve) => {
		started = resolve;
	});
	let aborted = false;
	const f = await fixture(
		(_url, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener(
					"abort",
					() => {
						aborted = true;
						reject(new DOMException("Aborted", "AbortError"));
					},
					{ once: true },
				);
				started();
			}),
	);
	try {
		const pending = f.bridge
			.files?.({
				requestId: randomUUID(),
				modelRowId: "saved",
				operation: { _tag: "upload", name: "fixture.txt", content: "fixture" },
			})
			?.catch(() => {});
		await ready;
		await f.bridge.dispose();
		await pending;
		expect(aborted).toBe(true);
	} finally {
		await f.close();
	}
});
it("AI-051 profile entry method preserves custom endpoint and settings pin identity", async () => {
	const { profileFromModel } = await import("./host");
	const row: ModelRow = {
		id: "volc",
		role: "default",
		provider: "volc",
		model: "default-model",
		maxTokens: 1024,
		baseUrl: "https://selected.invalid/api/v3/bots",
		credentialRef: randomUUID(),
		settings: { entryMethod: "agent", botId: "bot-selected" },
	};
	expect(profileFromModel(row)).toMatchObject({
		baseUrl: row.baseUrl,
		modelId: "bot-selected",
		provider: "volc",
	});
	expect(
		profileFromModel({
			...row,
			settings: { entryMethod: "inference", botId: "ep-selected" },
		}).id,
	).not.toBe(profileFromModel(row).id);
});
