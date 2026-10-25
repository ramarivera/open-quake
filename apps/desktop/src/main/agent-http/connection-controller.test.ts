import { Deferred, Effect, Redacted } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeCapabilities } from "../../../../../packages/edge/src/agent-http/runtime-contracts.js";
import {
	RuntimeRequestFailed,
	RuntimeUnavailable,
} from "../../../../../packages/edge/src/agent-http/runtime-errors.js";
import {
	AGENT_CONNECTIONS_REQUEST,
	AGENT_CONNECTIONS_SNAPSHOT,
} from "../../shared/agent-connections";
import {
	type ConnectionOperations,
	createAgentConnectionsController,
} from "./connection-controller";
import {
	type AgentConnectionsState,
	type ConnectionCredentials,
	createAgentConnections,
} from "./connections";

const electron = vi.hoisted(() => ({
	handle: vi.fn(),
	removeHandler: vi.fn(),
	safeStorage: {},
}));
vi.mock("electron", () => ({
	ipcMain: { handle: electron.handle, removeHandler: electron.removeHandler },
	app: { getPath: () => "/unused" },
	safeStorage: electron.safeStorage,
}));

import { registerAgentConnections } from "./connection-registration";

const renderer = "file:///open-quake/renderer/index.html";
const source = { senderId: 42, frameURL: renderer, mainFrame: true };
const initial: AgentConnectionsState = {
	version: 1,
	revision: 0,
	connections: [
		{
			id: "local",
			name: "Local",
			kind: "hermes",
			baseURL: "http://localhost:8642/",
		},
	],
	cleanupRefs: [],
};
const health = { status: "ready", lifecycle: "externallyManaged" } as const;
const capabilities: RuntimeCapabilities = {
	health: "supported",
	chat: "supported",
	listAgents: "unsupported",
	sessions: "unverified",
	resources: "unsupported",
	models: "unsupported",
	toolEvents: "unverified",
	usage: "unsupported",
};
const credentials: ConnectionCredentials = {
	store: () => Effect.succeed("a8ab5f08-bf8d-4940-8790-7ea406d9cbec"),
	resolve: () => Effect.succeed(Redacted.make("token")),
	remove: () => Effect.void,
};
async function fixture(
	operations: ConnectionOperations = { health: () => Effect.succeed(health) },
) {
	let record = initial;
	const writes = vi.fn();
	const storage = {
		read: () => Effect.succeed(record),
		write: (state: AgentConnectionsState) =>
			Effect.sync(() => {
				record = state;
				writes(state);
			}),
	};
	const repository = await Effect.runPromise(
		createAgentConnections({ storage, credentials }),
	);
	let managementId: number | undefined = 42;
	const controller = createAgentConnectionsController({
		repository,
		renderer,
		managementId: () => managementId,
		operations,
	});
	return {
		repository,
		controller,
		storage,
		writes,
		setManagementId: (value: number | undefined) => {
			managementId = value;
		},
	};
}

describe("runtime connection management authority and dispatch", () => {
	it("rejects panel, subframe, wrong origin, wrong path, embedded credentials before touching storage or network", async () => {
		const operation = vi.fn(() => Effect.succeed(health));
		const f = await fixture({ health: operation });
		for (const authority of [
			{ ...source, senderId: 99 },
			{ ...source, mainFrame: false },
			{ ...source, frameURL: "https://evil.invalid/index.html" },
			{ ...source, frameURL: "file:///other/index.html" },
			{ ...source, frameURL: "http://user:secret@localhost/index.html" },
		]) {
			expect(
				await f.controller.request(authority, { type: "test", id: "local" }),
			).toMatchObject({
				_tag: "rejected",
				code: "AGENT.HTTP.IPC.UNAUTHORIZED",
			});
		}
		expect(operation).not.toHaveBeenCalled();
		expect(f.writes).not.toHaveBeenCalled();
		f.controller.dispose();
	});
	it("rejects excess and unsafe inputs and routes saves, selection, read and removal through the real repository", async () => {
		const f = await fixture();
		for (const input of [
			{
				type: "save",
				name: "bad",
				kind: "hermes",
				baseURL: "http://localhost?token=secret",
			},
			{ type: "select", id: "local", credentialRef: "forged" },
			{ type: "test", id: "local", token: "secret" },
		])
			expect(await f.controller.request(source, input)).toMatchObject({
				_tag: "rejected",
				code: "AGENT.HTTP.CONNECTION.INVALID",
			});
		expect(f.writes).not.toHaveBeenCalled();
		expect(
			await f.controller.request(source, {
				type: "save",
				id: "local",
				name: "Renamed",
				kind: "hermes",
				baseURL: "https://gateway.tailnet.ts.net/base",
			}),
		).toMatchObject({
			_tag: "success",
			view: {
				connections: [
					{ name: "Renamed", baseURL: "https://gateway.tailnet.ts.net/base/" },
				],
			},
		});
		expect(
			await f.controller.request(source, {
				type: "select",
				id: "local",
				agentId: "remote:opaque",
			}),
		).toMatchObject({
			_tag: "success",
			view: { selected: { connectionId: "local", agentId: "remote:opaque" } },
		});
		expect(await f.controller.request(source, { type: "list" })).toMatchObject({
			_tag: "success",
		});
		expect(
			await f.controller.request(source, { type: "remove", id: "local" }),
		).toMatchObject({ _tag: "success", view: { connections: [] } });
		f.controller.dispose();
	});
	it("cancels a superseded test and returns only the current test's result", async () => {
		const entered = Effect.runSync(Deferred.make<void>());
		let calls = 0,
			aborts = 0;
		const f = await fixture({
			health: () =>
				++calls === 1
					? Effect.zipRight(
							Deferred.succeed(entered, undefined),
							Effect.never,
						).pipe(
							Effect.ensuring(
								Effect.sync(() => {
									aborts++;
								}),
							),
						)
					: Effect.succeed(health),
		});
		const first = f.controller.request(source, { type: "test", id: "local" });
		await Effect.runPromise(Deferred.await(entered));
		expect(
			await f.controller.request(source, { type: "test", id: "local" }),
		).toMatchObject({ _tag: "success", health });
		expect(await first).toMatchObject({
			_tag: "rejected",
			code: "AGENT.HTTP.IPC.STALE",
		});
		expect(aborts).toBe(1);
		f.controller.dispose();
	});
	it("invalidates health requests when persisted config/selection changes", async () => {
		const entered = Effect.runSync(Deferred.make<void>());
		let aborted = false;
		const f = await fixture({
			health: () =>
				Effect.zipRight(
					Deferred.succeed(entered, undefined),
					Effect.never,
				).pipe(
					Effect.ensuring(
						Effect.sync(() => {
							aborted = true;
						}),
					),
				),
		});
		const pending = f.controller.request(source, { type: "test", id: "local" });
		await Effect.runPromise(Deferred.await(entered));
		await Effect.runPromise(f.repository.select("local"));
		expect(await pending).toMatchObject({
			_tag: "rejected",
			code: "AGENT.HTTP.IPC.STALE",
		});
		expect(aborted).toBe(true);
		f.controller.dispose();
	});
	it("cancels active network work and unregisters its repository subscription at shutdown", async () => {
		const entered = Effect.runSync(Deferred.make<void>());
		let aborted = false;
		const f = await fixture({
			health: () =>
				Effect.zipRight(
					Deferred.succeed(entered, undefined),
					Effect.never,
				).pipe(
					Effect.ensuring(
						Effect.sync(() => {
							aborted = true;
						}),
					),
				),
		});
		const pending = f.controller.request(source, { type: "test", id: "local" });
		await Effect.runPromise(Deferred.await(entered));
		f.controller.dispose();
		f.controller.dispose();
		expect(await pending).toMatchObject({
			_tag: "rejected",
			code: "AGENT.HTTP.IPC.DISPOSED",
		});
		expect(aborted).toBe(true);
		expect(await f.controller.request(source, { type: "list" })).toMatchObject({
			_tag: "rejected",
			code: "AGENT.HTTP.IPC.DISPOSED",
		});
	});
	it("redacts provider errors and rechecks current management authority after async work", async () => {
		const f = await fixture({
			health: () =>
				Effect.fail(
					new RuntimeRequestFailed(
						new Error("token=secret http://private-endpoint"),
					),
				),
		});
		const reply = await f.controller.request(source, {
			type: "test",
			id: "local",
		});
		expect(reply).toEqual({
			_tag: "rejected",
			code: "AGENT.HTTP.REQUEST.FAILED",
			message: "The runtime request failed",
		});
		expect(JSON.stringify(reply)).not.toContain("secret");
		f.controller.dispose();
		const next = await fixture({
			health: () =>
				Effect.sync(() => {
					next.setManagementId(81);
					return health;
				}),
		});
		expect(
			await next.controller.request(source, { type: "test", id: "local" }),
		).toMatchObject({ _tag: "rejected", code: "AGENT.HTTP.IPC.UNAUTHORIZED" });
		next.controller.dispose();
	});
	it("returns honest unsupported discovery while preserving empty real catalogs and explicit remote selection", async () => {
		const f = await fixture({
			health: () => Effect.succeed(health),
			discover: () => Effect.succeed({ capabilities, agents: [] }),
		});
		expect(
			await f.controller.request(source, { type: "discover", id: "local" }),
		).toMatchObject({
			_tag: "success",
			discovery: { capabilities: { listAgents: "unsupported" }, agents: [] },
		});
		expect(
			await f.controller.request(source, { type: "select", id: "local" }),
		).toMatchObject({
			_tag: "success",
			view: { selected: { connectionId: "local" } },
		});
		f.controller.dispose();
		const invalid = await fixture({
			health: () => Effect.succeed(health),
			discover: () =>
				Effect.succeed({
					capabilities,
					agents: [{ id: "main", name: "Fabricated" }],
				}),
		});
		expect(
			await invalid.controller.request(source, {
				type: "discover",
				id: "local",
			}),
		).toMatchObject({
			_tag: "rejected",
			code: "AGENT.HTTP.CONNECTION.INVALID",
		});
		invalid.controller.dispose();
	});
	it("preserves typed discovery errors, rejects secret-bearing native results and fails absent discovery explicitly", async () => {
		const f = await fixture({
			health: () => Effect.succeed({ ...health, secret: "token" }),
			discover: () => Effect.fail(new RuntimeUnavailable(new Error("secret"))),
		});
		expect(
			await f.controller.request(source, { type: "discover", id: "local" }),
		).toMatchObject({
			_tag: "rejected",
			code: "AGENT.HTTP.CONNECTION.UNAVAILABLE",
		});
		expect(
			await f.controller.request(source, { type: "test", id: "local" }),
		).toMatchObject({
			_tag: "rejected",
			code: "AGENT.HTTP.CONNECTION.INVALID",
		});
		f.controller.dispose();
		const noDiscovery = await fixture();
		expect(
			await noDiscovery.controller.request(source, {
				type: "discover",
				id: "local",
			}),
		).toMatchObject({
			_tag: "rejected",
			code: "AGENT.HTTP.CAPABILITY.UNSUPPORTED",
		});
		noDiscovery.controller.dispose();
	});
});

describe("production runtime connection IPC registration", () => {
	it("starts without network, authorizes actual sender frame, sends safe snapshots and removes handlers/listeners", async () => {
		electron.handle.mockClear();
		electron.removeHandler.mockClear();
		const healthCall = vi.fn(() => Effect.succeed(health));
		const f = await fixture();
		const send = vi.fn();
		const frame = { url: renderer };
		const webContents = {
			id: 42,
			mainFrame: frame,
			getURL: () => renderer,
			isDestroyed: () => false,
			send,
		};
		const management = { webContents, isDestroyed: () => false };
		const registration = await registerAgentConnections({
			management: () => management as unknown as Electron.BrowserWindow,
			renderer,
			storage: f.storage,
			credentials,
			operations: { health: healthCall },
		});
		expect(healthCall).not.toHaveBeenCalled();
		const handler: unknown = electron.handle.mock.calls.find(
			(call) => call[0] === AGENT_CONNECTIONS_REQUEST,
		)?.[1];
		expect(typeof handler).toBe("function");
		if (typeof handler !== "function") throw new Error("missing IPC handler");
		expect(
			await handler(
				{ sender: webContents, senderFrame: { url: renderer } },
				{ type: "test", id: "local" },
			),
		).toMatchObject({ _tag: "rejected", code: "AGENT.HTTP.IPC.UNAUTHORIZED" });
		expect(
			await handler(
				{ sender: webContents, senderFrame: frame },
				{ type: "test", id: "local" },
			),
		).toMatchObject({ _tag: "success", health });
		await Effect.runPromise(registration.repository.select("local"));
		expect(send).toHaveBeenCalledWith(
			AGENT_CONNECTIONS_SNAPSHOT,
			expect.objectContaining({ selected: { connectionId: "local" } }),
		);
		expect(JSON.stringify(send.mock.calls)).not.toContain("credentialRef");
		await registration.dispose();
		await registration.dispose();
		expect(electron.removeHandler).toHaveBeenCalledExactlyOnceWith(
			AGENT_CONNECTIONS_REQUEST,
		);
		const count = send.mock.calls.length;
		expect(
			(
				await Effect.runPromise(
					registration.repository.view().pipe(Effect.either),
				)
			)._tag,
		).toBe("Left");
		expect(send.mock.calls).toHaveLength(count);
		f.controller.dispose();
	});
	it("awaits cancellation of active production health work before disposal completes", async () => {
		const f = await fixture();
		const entered = Effect.runSync(Deferred.make<void>());
		let aborted = false;
		const frame = { url: renderer };
		const webContents = {
			id: 42,
			mainFrame: frame,
			getURL: () => renderer,
			isDestroyed: () => false,
			send: vi.fn(),
		};
		const window = { webContents, isDestroyed: () => false };
		const registration = await registerAgentConnections({
			management: () => window as unknown as Electron.BrowserWindow,
			renderer,
			storage: f.storage,
			credentials,
			operations: {
				health: () =>
					Effect.zipRight(
						Deferred.succeed(entered, undefined),
						Effect.never,
					).pipe(
						Effect.ensuring(
							Effect.sync(() => {
								aborted = true;
							}),
						),
					),
			},
		});
		const handler: unknown = electron.handle.mock.calls
			.filter((call) => call[0] === AGENT_CONNECTIONS_REQUEST)
			.at(-1)?.[1];
		if (typeof handler !== "function") throw new Error("missing IPC handler");
		const pending = handler(
			{ sender: webContents, senderFrame: frame },
			{ type: "test", id: "local" },
		);
		await Effect.runPromise(Deferred.await(entered));
		await registration.dispose();
		expect(aborted).toBe(true);
		expect(await pending).toMatchObject({
			_tag: "rejected",
			code: "AGENT.HTTP.IPC.DISPOSED",
		});
		f.controller.dispose();
	});
	it("does not send snapshots after navigation outside the management renderer", async () => {
		const f = await fixture(),
			send = vi.fn();
		let url = renderer;
		const window = {
			webContents: {
				id: 42,
				getURL: () => url,
				isDestroyed: () => false,
				send,
			},
			isDestroyed: () => false,
		};
		const registration = await registerAgentConnections({
			management: () => window as unknown as Electron.BrowserWindow,
			renderer,
			storage: f.storage,
			credentials,
			operations: { health: () => Effect.succeed(health) },
		});
		url = "https://outside.invalid";
		await Effect.runPromise(registration.repository.select("local"));
		expect(send).not.toHaveBeenCalled();
		await registration.dispose();
		f.controller.dispose();
	});
});
