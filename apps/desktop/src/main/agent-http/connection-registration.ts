import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Effect, Redacted } from "effect";
import { app, type BrowserWindow, ipcMain } from "electron";
import { RuntimeCredentialUnavailable } from "../../../../../packages/edge/src/agent-http/runtime-errors.js";
import {
	AGENT_CONNECTIONS_REQUEST,
	AGENT_CONNECTIONS_SNAPSHOT,
} from "../../shared/agent-connections";
import { agentRequestAllowed } from "../agents/controller";
import type { DesktopDiagnostics } from "../diagnostics";
import { systemCredentialVault } from "../integrations/storage";
import {
	type ConnectionOperations,
	createAgentConnectionsController,
} from "./connection-controller";
import {
	type AgentConnections,
	type ConnectionCredentials,
	type ConnectionStorage,
	connectionFileStorage,
	createAgentConnections,
} from "./connections";

export interface RegisterAgentConnectionsOptions {
	readonly diagnostics?: DesktopDiagnostics;
	readonly management: () => BrowserWindow | undefined;
	readonly renderer: string;
	readonly root?: string;
	readonly credentials?: ConnectionCredentials;
	readonly storage?: ConnectionStorage;
	readonly operations: ConnectionOperations;
}
/** Same OS-backed encryption convention as managementAgentCredentials, plus main-only resolution. */
export function connectionCredentials(root: string): ConnectionCredentials {
	const vault = systemCredentialVault(root);
	const secureRoot = async (): Promise<void> => {
		await mkdir(root, { recursive: true, mode: 0o700 });
		if (
			(await lstat(root)).isSymbolicLink() ||
			(await realpath(root)) !== resolve(root)
		)
			throw new RuntimeCredentialUnavailable();
	};
	return {
		references: () =>
			Effect.tryPromise({
				try: async () => {
					await secureRoot();
					return (await readdir(root)).filter((entry) =>
						/^[0-9a-f-]{36}$/.test(entry),
					);
				},
				catch: (cause) => new RuntimeCredentialUnavailable(cause),
			}),
		store: (secret) =>
			Effect.tryPromise({
				try: async () => {
					await secureRoot();
					return vault.put(Redacted.value(secret));
				},
				catch: (cause) => new RuntimeCredentialUnavailable(cause),
			}),
		resolve: (reference) =>
			Effect.tryPromise({
				try: async () => {
					await secureRoot();
					return vault.get(reference);
				},
				catch: (cause) => new RuntimeCredentialUnavailable(cause),
			}).pipe(
				Effect.flatMap((value) =>
					value.trim()
						? Effect.succeed(Redacted.make(value))
						: Effect.fail(new RuntimeCredentialUnavailable()),
				),
			),
		remove: (reference) =>
			Effect.tryPromise({
				try: async () => {
					await secureRoot();
					return vault.remove(reference);
				},
				catch: (cause) => new RuntimeCredentialUnavailable(cause),
			}),
	};
}
export interface AgentConnectionsRegistration {
	readonly repository: AgentConnections;
	readonly dispose: () => Promise<void>;
}
/** Acquisition belongs to the application graph; no IPC or network starts here. */
export function acquireAgentConnections(
	options: RegisterAgentConnectionsOptions,
) {
	const root = options.root ?? join(app.getPath("userData"), "agent-http-v1");
	return createAgentConnections({
		storage: options.storage ?? connectionFileStorage(root),
		credentials:
			options.credentials ?? connectionCredentials(join(root, "credentials")),
	});
}

/** Activate IPC against an acquired repository without owning its lifetime. */
export function activateAgentConnections(
	repository: AgentConnections,
	options: RegisterAgentConnectionsOptions,
): AgentConnectionsRegistration {
	const controller = createAgentConnectionsController({
		repository,
		managementId: () => options.management()?.webContents.id,
		renderer: options.renderer,
		operations: options.operations,
		...(options.diagnostics ? { diagnostics: options.diagnostics } : {}),
	});
	let disposed = false;
	const pending = new Set<Promise<unknown>>();
	const off = repository.subscribe((view) => {
		const window = options.management();
		if (
			disposed ||
			!window ||
			window.isDestroyed() ||
			window.webContents.isDestroyed()
		)
			return;
		if (
			agentRequestAllowed(
				{
					senderId: window.webContents.id,
					frameURL: window.webContents.getURL(),
					mainFrame: true,
				},
				window.webContents.id,
				options.renderer,
			)
		)
			window.webContents.send(AGENT_CONNECTIONS_SNAPSHOT, view);
	});
	ipcMain.handle(AGENT_CONNECTIONS_REQUEST, async (event, input: unknown) => {
		const work = controller.request(
			{
				senderId: event.sender.id,
				frameURL: event.senderFrame?.url ?? "",
				mainFrame: event.senderFrame === event.sender.mainFrame,
			},
			input,
		);
		pending.add(work);
		try {
			return await work;
		} finally {
			pending.delete(work);
		}
	});
	let disposal: Promise<void> | undefined;
	return {
		repository,
		dispose: () => {
			if (disposal) return disposal;
			disposed = true;
			ipcMain.removeHandler(AGENT_CONNECTIONS_REQUEST);
			off();
			controller.dispose();
			disposal = Promise.allSettled([...pending]).then(() => undefined);
			return disposal;
		},
	};
}

/** Standalone compatibility wrapper owns and releases the acquired repository. */
export async function registerAgentConnections(
	options: RegisterAgentConnectionsOptions,
): Promise<AgentConnectionsRegistration> {
	const acquisition = acquireAgentConnections(options);
	const repository = await Effect.runPromise(
		options.diagnostics
			? options.diagnostics
					.instrument(acquisition, "agent.connection")
					.pipe(Effect.provide(options.diagnostics.layer))
			: acquisition,
	);
	const registration = activateAgentConnections(repository, options);
	return {
		repository,
		dispose: async () => {
			await registration.dispose();
			repository.dispose();
		},
	};
}
