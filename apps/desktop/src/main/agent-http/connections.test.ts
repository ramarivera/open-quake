import { randomUUID } from "node:crypto";
import {
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { Effect, Either, Redacted } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
	RuntimeCredentialUnavailable,
	RuntimeStorageFailed,
} from "../../../../../packages/edge/src/agent-http/runtime-errors.js";
import {
	type AgentConnectionsState,
	type ConnectionCredentials,
	type ConnectionStorage,
	connectionFileStorage,
	createAgentConnections,
} from "./connections";

function fixture() {
	let record: unknown = {
		version: 1,
		revision: 0,
		connections: [],
		cleanupRefs: [],
	};
	const secrets = new Map<string, string>();
	const controls = { failWrite: false, failRemove: false, failResolve: false };
	const removed: string[] = [];
	const credentials: ConnectionCredentials = {
		references: () => Effect.succeed([...secrets.keys()]),
		store: (secret) =>
			Effect.sync(() => {
				const reference = randomUUID();
				secrets.set(reference, Redacted.value(secret));
				return reference;
			}),
		resolve: (reference) =>
			Effect.suspend(() => {
				const secret = secrets.get(reference);
				return secret && !controls.failResolve
					? Effect.succeed(Redacted.make(secret))
					: Effect.fail(new RuntimeCredentialUnavailable());
			}),
		remove: (reference) =>
			Effect.suspend(() =>
				controls.failRemove
					? Effect.fail(
							new RuntimeCredentialUnavailable(new Error("secret-token")),
						)
					: Effect.sync(() => {
							removed.push(reference);
							secrets.delete(reference);
						}),
			),
	};
	const storage: ConnectionStorage = {
		read: () => Effect.succeed(structuredClone(record)),
		write: (state) =>
			Effect.suspend(() =>
				controls.failWrite
					? Effect.fail(new RuntimeStorageFailed(new Error("secret-token")))
					: Effect.sync(() => {
							record = structuredClone(state);
						}),
			),
	};
	return {
		credentials,
		storage,
		secrets,
		controls,
		removed,
		record: () => record,
		replace: (next: unknown) => {
			record = next;
		},
		create: () =>
			Effect.runPromise(createAgentConnections({ storage, credentials })),
	};
}
const save = {
	type: "save",
	name: "Local Hermes",
	kind: "hermes",
	baseURL: "http://localhost:8642",
} as const;
const scratch =
	"/Volumes/ExtSSD/SCRATCHPADS_FOR_AGENTS/open-quake-agent-http/lane-5";
const temporary: string[] = [];
afterEach(async () => {
	for (const path of temporary.splice(0))
		await rm(path, { recursive: true, force: true });
});

describe("runtime connection repository", () => {
	it("persists normalized configs and explicit remote selection, excludes credential references and plaintext from public views", async () => {
		const f = fixture(),
			repository = await f.create();
		const view = await Effect.runPromise(
			repository.save({ ...save, credential: "secret-token" }),
		);
		const connection = view.connections[0];
		expect(connection).toMatchObject({
			kind: "hermes",
			baseURL: "http://localhost:8642/",
			credentialAvailable: true,
		});
		if (!connection) throw new Error("missing fixture connection");
		await Effect.runPromise(
			repository.select(connection.id, "remote:agent/opaque"),
		);
		const restored = await f.create();
		expect(await Effect.runPromise(restored.selected())).toEqual({
			connectionId: connection.id,
			agentId: "remote:agent/opaque",
		});
		const internal = await Effect.runPromise(restored.get(connection.id));
		expect(internal.credentialRef).toBeDefined();
		expect(
			JSON.stringify(await Effect.runPromise(restored.view())),
		).not.toContain("credentialRef");
		expect(JSON.stringify(f.record())).not.toContain("secret-token");
		if (!internal.credentialRef) throw new Error("missing fixture credential");
		expect(
			Redacted.value(
				await Effect.runPromise(
					restored.resolveCredential(internal.credentialRef),
				),
			),
		).toBe("secret-token");
		f.controls.failResolve = true;
		expect(
			(await Effect.runPromise(restored.view())).connections[0]
				?.credentialAvailable,
		).toBe(false);
	});
	it("rolls back a replacement secret when config commit fails and retains the old binding", async () => {
		const f = fixture(),
			repository = await f.create();
		const view = await Effect.runPromise(
			repository.save({ ...save, credential: "old-token" }),
		);
		const id = view.connections[0]?.id ?? "missing";
		const before = await Effect.runPromise(repository.get(id));
		f.controls.failWrite = true;
		const failed = await Effect.runPromise(
			repository
				.save({ ...save, id, credential: "replacement" })
				.pipe(Effect.either),
		);
		expect(failed).toMatchObject({
			_tag: "Left",
			left: { _tag: "RuntimeStorageFailed", code: "AGENT.HTTP.STORAGE.FAILED" },
		});
		expect(await Effect.runPromise(repository.get(id))).toEqual(before);
		expect([...f.secrets.values()]).toEqual(["old-token"]);
		expect(JSON.stringify(failed)).not.toContain("secret-token");
	});
	it("commits replacement then journals failed old-secret cleanup and retries on restart", async () => {
		const f = fixture(),
			repository = await f.create();
		const id =
			(
				await Effect.runPromise(
					repository.save({ ...save, credential: "old-token" }),
				)
			).connections[0]?.id ?? "missing";
		f.controls.failRemove = true;
		const view = await Effect.runPromise(
			repository.save({ ...save, id, credential: "new-token" }),
		);
		expect(view.cleanupPending).toBe(true);
		expect(f.secrets.size).toBe(2);
		f.controls.failRemove = false;
		const restored = await f.create();
		expect((await Effect.runPromise(restored.view())).cleanupPending).toBe(
			false,
		);
		expect([...f.secrets.values()]).toEqual(["new-token"]);
		expect((f.record() as AgentConnectionsState).cleanupRefs).toEqual([]);
	});
	it("removes selected configs before deleting credentials and permits safe explicit clearing", async () => {
		const f = fixture(),
			repository = await f.create();
		const id =
			(
				await Effect.runPromise(
					repository.save({ ...save, credential: "token" }),
				)
			).connections[0]?.id ?? "missing";
		await Effect.runPromise(repository.select(id));
		const cleared = await Effect.runPromise(
			repository.save({
				...save,
				id,
				clearCredential: true,
				baseURL: "https://gateway.tailnet.ts.net/base",
			}),
		);
		expect(cleared.connections[0]?.credentialAvailable).toBe(false);
		expect(f.secrets.size).toBe(0);
		const removed = await Effect.runPromise(repository.remove(id));
		expect(removed.connections).toEqual([]);
		expect(removed.selected).toBeUndefined();
		expect(await Effect.runPromise(repository.selected())).toBeUndefined();
	});
	it("does not silently send an existing credential to an edited URL or another runtime kind", async () => {
		const f = fixture(),
			repository = await f.create();
		const id =
			(
				await Effect.runPromise(
					repository.save({ ...save, credential: "token" }),
				)
			).connections[0]?.id ?? "missing";
		for (const change of [
			{ baseURL: "http://another-host:8642" },
			{ kind: "openclaw" as const },
		]) {
			expect(
				await Effect.runPromise(
					repository.save({ ...save, id, ...change }).pipe(Effect.either),
				),
			).toMatchObject({
				_tag: "Left",
				left: { code: "AGENT.HTTP.CONNECTION.INVALID" },
			});
		}
		expect(f.secrets.size).toBe(1);
	});
	it("serializes concurrent saves, delivers secret-free snapshots, and disposes listeners", async () => {
		const f = fixture(),
			repository = await f.create();
		const snapshots: unknown[] = [];
		const off = repository.subscribe((view) => snapshots.push(view));
		await Promise.all([
			Effect.runPromise(repository.save({ ...save, name: "A" })),
			Effect.runPromise(repository.save({ ...save, name: "B" })),
		]);
		expect(
			(await Effect.runPromise(repository.view())).connections.map(
				(c) => c.name,
			),
		).toEqual(["A", "B"]);
		expect(snapshots).toHaveLength(2);
		off();
		off();
		await Effect.runPromise(repository.select());
		expect(snapshots).toHaveLength(2);
		repository.dispose();
		expect(
			await Effect.runPromise(repository.view().pipe(Effect.either)),
		).toMatchObject({
			_tag: "Left",
			left: { code: "AGENT.HTTP.CONNECTION.UNAVAILABLE" },
		});
	});
	it.each([
		{ version: 2, revision: 0, connections: [], cleanupRefs: [] },
		{
			version: 1,
			revision: 0,
			connections: [],
			cleanupRefs: [],
			secret: "token",
		},
		{
			version: 1,
			revision: 0,
			connections: [],
			cleanupRefs: [],
			selected: { connectionId: "missing" },
		},
		{
			version: 1,
			revision: 0,
			connections: [
				{
					id: "a",
					name: "bad",
					kind: "hermes",
					baseURL: "http://localhost",
					credentialRef: "../../outside",
				},
			],
			cleanupRefs: [],
		},
		{
			version: 1,
			revision: 0,
			connections: [
				{
					id: "a",
					name: "bad",
					kind: "hermes",
					baseURL: "http://user:token@localhost",
				},
			],
			cleanupRefs: [],
		},
	])("fails closed on malformed persisted state %#", async (record) => {
		const f = fixture();
		f.replace(record);
		expect(
			await Effect.runPromise(createAgentConnections(f).pipe(Effect.either)),
		).toMatchObject({ _tag: "Left", left: { _tag: "RuntimeStorageFailed" } });
	});
	it("does not resolve arbitrary or deleted credential references", async () => {
		const f = fixture(),
			repository = await f.create();
		const ref = randomUUID();
		f.secrets.set(ref, "unrelated");
		expect(
			await Effect.runPromise(
				repository.resolveCredential(ref).pipe(Effect.either),
			),
		).toMatchObject({
			_tag: "Left",
			left: { _tag: "RuntimeCredentialUnavailable" },
		});
		expect(f.secrets.get(ref)).toBe("unrelated");
	});
});

describe("credential crash recovery", () => {
	it("recovers an orphan replacement after config commit and immediate rollback both fail", async () => {
		const f = fixture(),
			repository = await f.create();
		const id =
			(
				await Effect.runPromise(
					repository.save({ ...save, credential: "old-token" }),
				)
			).connections[0]?.id ?? "missing";
		f.controls.failWrite = true;
		f.controls.failRemove = true;
		expect(
			await Effect.runPromise(
				repository
					.save({ ...save, id, credential: "orphan-token" })
					.pipe(Effect.either),
			),
		).toMatchObject({ _tag: "Left" });
		expect(f.secrets.size).toBe(2);
		f.controls.failWrite = false;
		f.controls.failRemove = false;
		const restored = await f.create();
		expect([...f.secrets.values()]).toEqual(["old-token"]);
		expect((await Effect.runPromise(restored.view())).cleanupPending).toBe(
			false,
		);
	});
	it("clears an old remote agent selection when the selected endpoint changes", async () => {
		const f = fixture(),
			repository = await f.create();
		const id =
			(await Effect.runPromise(repository.save(save))).connections[0]?.id ??
			"missing";
		await Effect.runPromise(repository.select(id, "previous-agent"));
		const view = await Effect.runPromise(
			repository.save({
				...save,
				id,
				baseURL: "https://another-gateway.example/base",
			}),
		);
		expect(view.selected).toEqual({ connectionId: id });
	});
});

describe("runtime connection atomic file storage", () => {
	it("reopens actual private files with selection and no plaintext secrets or leftover pending files", async () => {
		await mkdir(scratch, { recursive: true });
		const root = await mkdtemp(join(scratch, "files-"));
		temporary.push(root);
		const f = fixture(),
			storage = connectionFileStorage(root);
		const repository = await Effect.runPromise(
			createAgentConnections({ storage, credentials: f.credentials }),
		);
		const id =
			(
				await Effect.runPromise(
					repository.save({ ...save, credential: "secret-token" }),
				)
			).connections[0]?.id ?? "missing";
		await Effect.runPromise(repository.select(id));
		const contents = await readFile(join(root, "connections-v1.json"), "utf8");
		expect(contents).not.toContain("secret-token");
		expect((await lstat(join(root, "connections-v1.json"))).mode & 0o777).toBe(
			0o600,
		);
		expect(await readdir(root)).toEqual(["connections-v1.json"]);
		const restored = await Effect.runPromise(
			createAgentConnections({ storage, credentials: f.credentials }),
		);
		expect(await Effect.runPromise(restored.selected())).toEqual({
			connectionId: id,
		});
	});
	it("rejects corrupt and symlinked records instead of replacing them with empty state", async () => {
		await mkdir(scratch, { recursive: true });
		const root = await mkdtemp(join(scratch, "unsafe-"));
		temporary.push(root);
		const file = join(root, "connections-v1.json");
		await writeFile(file, "invalid-json");
		expect(
			Either.isLeft(
				await Effect.runPromise(
					connectionFileStorage(root).read().pipe(Effect.either),
				),
			),
		).toBe(true);
		await rm(file);
		await writeFile(join(root, "target"), "{}");
		await symlink(join(root, "target"), file);
		expect(
			Either.isLeft(
				await Effect.runPromise(
					connectionFileStorage(root).read().pipe(Effect.either),
				),
			),
		).toBe(true);
	});
});
