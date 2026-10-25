import { randomUUID } from "node:crypto";
import {
	lstat,
	mkdir,
	open,
	readFile,
	realpath,
	rename,
	rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { Effect, Either, Redacted, Schema } from "effect";
import { RuntimeConnection } from "../../../../../packages/edge/src/agent-http/runtime-contracts.js";
import {
	RuntimeConnectionInvalid,
	RuntimeCredentialUnavailable,
	type RuntimeError,
	RuntimeStorageFailed,
	RuntimeUnavailable,
} from "../../../../../packages/edge/src/agent-http/runtime-errors.js";
import { normalizeRuntimeBaseURL } from "../../../../../packages/edge/src/agent-http/runtime-invariants.js";
import {
	AgentConnectionSelection,
	type AgentConnectionView,
	SaveAgentConnection,
} from "../../shared/agent-connections";

const PersistedConnection = RuntimeConnection.omit("credentialRef").pipe(
	Schema.extend(Schema.Struct({ credentialRef: Schema.optional(Schema.UUID) })),
);
export const AgentConnectionsState = Schema.Struct({
	version: Schema.Literal(1),
	revision: Schema.Int.pipe(Schema.nonNegative()),
	connections: Schema.Array(PersistedConnection).pipe(Schema.maxItems(100)),
	selected: Schema.optional(AgentConnectionSelection),
	cleanupRefs: Schema.Array(Schema.UUID).pipe(Schema.maxItems(1000)),
}).pipe(
	Schema.filter((state) => {
		const ids = new Set(state.connections.map((connection) => connection.id));
		const refs = state.connections.flatMap((connection) =>
			connection.credentialRef ? [connection.credentialRef] : [],
		);
		return (
			ids.size === state.connections.length &&
			new Set(refs).size === refs.length &&
			(!state.selected || ids.has(state.selected.connectionId)) &&
			!state.cleanupRefs.some((reference) => refs.includes(reference))
		);
	}),
);
export type AgentConnectionsState = typeof AgentConnectionsState.Type;
const initial = (): AgentConnectionsState => ({
	version: 1,
	revision: 0,
	connections: [],
	cleanupRefs: [],
});
export interface ConnectionStorage {
	readonly read: () => Effect.Effect<unknown, RuntimeError>;
	/** Atomic commit. A failed write must leave the previous record intact. */
	readonly write: (
		state: AgentConnectionsState,
	) => Effect.Effect<void, RuntimeError>;
}
export interface ConnectionCredentials {
	/** Enumerates only this store's dedicated encrypted credential directory for crash recovery. */
	readonly references?: () => Effect.Effect<readonly string[], RuntimeError>;
	readonly store: (
		secret: Redacted.Redacted<string>,
	) => Effect.Effect<string, RuntimeError>;
	readonly resolve: (
		reference: string,
	) => Effect.Effect<Redacted.Redacted<string>, RuntimeError>;
	/** Idempotent deletion. */
	readonly remove: (reference: string) => Effect.Effect<void, RuntimeError>;
}
export interface AgentConnections {
	readonly view: () => Effect.Effect<AgentConnectionView, RuntimeError>;
	readonly get: (id: string) => Effect.Effect<RuntimeConnection, RuntimeError>;
	readonly selected: () => Effect.Effect<
		AgentConnectionSelection | undefined,
		RuntimeError
	>;
	readonly resolveCredential: (
		reference: string,
	) => Effect.Effect<Redacted.Redacted<string>, RuntimeError>;
	readonly save: (
		input: SaveAgentConnection,
	) => Effect.Effect<AgentConnectionView, RuntimeError>;
	readonly select: (
		id?: string,
		agentId?: string,
	) => Effect.Effect<AgentConnectionView, RuntimeError>;
	readonly remove: (
		id: string,
	) => Effect.Effect<AgentConnectionView, RuntimeError>;
	readonly subscribe: (
		receive: (view: AgentConnectionView) => void,
	) => () => void;
	readonly dispose: () => void;
}
/** Repository factory has no process, renderer or network dependency. Mutations commit in order. */
export const createAgentConnections = Effect.fn("AgentConnections.create")(
	function* (options: {
		readonly storage: ConnectionStorage;
		readonly credentials: ConnectionCredentials;
	}): Effect.fn.Return<AgentConnections, RuntimeError> {
		const decode = (input: unknown) =>
			Schema.decodeUnknown(AgentConnectionsState, {
				onExcessProperty: "error",
			})(input).pipe(
				Effect.mapError((cause) => new RuntimeStorageFailed(cause)),
			);
		let state = yield* options.storage.read().pipe(Effect.flatMap(decode));
		const lock = yield* Effect.makeSemaphore(1);
		let disposed = false;
		const listeners = new Set<(view: AgentConnectionView) => void>();
		const active = (): Effect.Effect<void, RuntimeError> =>
			disposed ? Effect.fail(new RuntimeUnavailable()) : Effect.void;
		const snapshot = (
			record: AgentConnectionsState,
		): Effect.Effect<AgentConnectionView> =>
			Effect.gen(function* () {
				const connections = yield* Effect.forEach(
					record.connections,
					(connection) =>
						(connection.credentialRef
							? options.credentials
									.resolve(connection.credentialRef)
									.pipe(Effect.either, Effect.map(Either.isRight))
							: Effect.succeed(false)
						).pipe(
							Effect.map((credentialAvailable) => ({
								id: connection.id,
								name: connection.name,
								kind: connection.kind,
								baseURL: connection.baseURL,
								credentialAvailable,
							})),
						),
					{ concurrency: 1 },
				);
				return {
					revision: record.revision,
					connections,
					...(record.selected ? { selected: { ...record.selected } } : {}),
					cleanupPending: record.cleanupRefs.length > 0,
				};
			});
		const cleanup = (): Effect.Effect<void, RuntimeError> =>
			Effect.gen(function* () {
				const remaining: string[] = [];
				for (const reference of state.cleanupRefs) {
					const removed = yield* options.credentials
						.remove(reference)
						.pipe(Effect.either);
					if (Either.isLeft(removed)) remaining.push(reference);
				}
				if (remaining.length !== state.cleanupRefs.length) {
					const next = { ...state, cleanupRefs: remaining };
					yield* options.storage.write(next);
					state = next;
				}
			});
		const publish = (): Effect.Effect<AgentConnectionView> =>
			Effect.gen(function* () {
				const view = yield* snapshot(state);
				if (!disposed)
					for (const listener of listeners)
						yield* Effect.sync(() => listener(view)).pipe(
							Effect.catchAllCause(() => Effect.void),
						);
				return view;
			});
		const commit = (
			next: AgentConnectionsState,
		): Effect.Effect<AgentConnectionView, RuntimeError> =>
			Effect.gen(function* () {
				const validated = yield* decode(next);
				yield* options.storage.write(validated);
				state = validated;
				// A committed replacement stays committed if later credential cleanup fails.
				yield* cleanup().pipe(Effect.either);
				return yield* publish();
			});
		const exclusive = <A>(
			work: Effect.Effect<A, RuntimeError>,
		): Effect.Effect<A, RuntimeError> =>
			lock.withPermits(1)(
				Effect.uninterruptible(active().pipe(Effect.zipRight(work))),
			);
		const get = Effect.fn("AgentConnections.get")(function* (
			id: string,
		): Effect.fn.Return<RuntimeConnection, RuntimeError> {
			yield* active();
			const connection = state.connections.find(
				(candidate) => candidate.id === id,
			);
			return connection
				? { ...connection }
				: yield* new RuntimeConnectionInvalid();
		});
		// Recover an orphan left if both a config write and immediate keychain rollback failed.
		if (options.credentials.references) {
			const references = yield* options.credentials.references();
			const activeRefs = new Set(
				state.connections.flatMap((connection) =>
					connection.credentialRef ? [connection.credentialRef] : [],
				),
			);
			const cleanupRefs = [
				...new Set([
					...state.cleanupRefs,
					...references.filter(
						(reference) =>
							Schema.is(Schema.UUID)(reference) && !activeRefs.has(reference),
					),
				]),
			];
			if (cleanupRefs.length !== state.cleanupRefs.length) {
				state = yield* decode({ ...state, cleanupRefs });
				yield* options.storage.write(state);
			}
		}
		// Retried after restart, without ever deleting a currently referenced credential.
		yield* cleanup().pipe(Effect.either);
		return {
			view: Effect.fn("AgentConnections.view")(() =>
				active().pipe(Effect.zipRight(Effect.suspend(() => snapshot(state)))),
			),
			get,
			selected: Effect.fn("AgentConnections.selected")(() =>
				active().pipe(
					Effect.map(() =>
						state.selected ? { ...state.selected } : undefined,
					),
				),
			),
			resolveCredential: Effect.fn("AgentConnections.resolveCredential")(
				(reference: string) =>
					Effect.gen(function* () {
						yield* active();
						if (
							!Schema.is(Schema.UUID)(reference) ||
							!state.connections.some(
								(connection) => connection.credentialRef === reference,
							)
						)
							return yield* new RuntimeCredentialUnavailable();
						return yield* options.credentials.resolve(reference);
					}),
			),
			save: Effect.fn("AgentConnections.save")((input: SaveAgentConnection) =>
				exclusive(
					Effect.gen(function* () {
						const value = yield* Schema.decodeUnknown(SaveAgentConnection, {
							onExcessProperty: "error",
						})(input).pipe(
							Effect.mapError((cause) => new RuntimeConnectionInvalid(cause)),
						);
						if (value.clearCredential && value.credential !== undefined)
							return yield* new RuntimeConnectionInvalid();
						if (state.cleanupRefs.length >= 1000)
							return yield* new RuntimeStorageFailed();
						const old = value.id
							? state.connections.find((candidate) => candidate.id === value.id)
							: undefined;
						if (value.id && !old) return yield* new RuntimeConnectionInvalid();
						if (!old && state.connections.length >= 100)
							return yield* new RuntimeConnectionInvalid();
						const baseURL = normalizeRuntimeBaseURL(value.baseURL);
						if (!baseURL) return yield* new RuntimeConnectionInvalid();
						if (
							old?.credentialRef &&
							(old.baseURL !== baseURL || old.kind !== value.kind) &&
							value.credential === undefined &&
							!value.clearCredential
						)
							return yield* new RuntimeConnectionInvalid();
						let reference = value.clearCredential
							? undefined
							: old?.credentialRef;
						let created: string | undefined;
						if (value.credential !== undefined) {
							created = yield* options.credentials.store(
								Redacted.make(value.credential),
							);
							if (
								!Schema.is(Schema.UUID)(created) ||
								state.connections.some(
									(connection) => connection.credentialRef === created,
								) ||
								state.cleanupRefs.includes(created)
							)
								return yield* new RuntimeCredentialUnavailable();
							reference = created;
						}
						const connection: RuntimeConnection = {
							id: old?.id ?? randomUUID(),
							name: value.name,
							kind: value.kind,
							baseURL,
							...(reference ? { credentialRef: reference } : {}),
						};
						const obsolete =
							old?.credentialRef && old.credentialRef !== reference
								? [old.credentialRef]
								: [];
						const endpointChanged =
							old && (old.baseURL !== baseURL || old.kind !== value.kind);
						const selected =
							endpointChanged && state.selected?.connectionId === old.id
								? { connectionId: old.id }
								: state.selected;
						const next: AgentConnectionsState = {
							...state,
							...(selected ? { selected } : {}),
							revision: state.revision + 1,
							connections: old
								? state.connections.map((candidate) =>
										candidate.id === old.id ? connection : candidate,
									)
								: [...state.connections, connection],
							cleanupRefs: [...state.cleanupRefs, ...obsolete],
						};
						const written = yield* options.storage
							.write(next)
							.pipe(Effect.either);
						if (Either.isLeft(written)) {
							if (created) {
								const removed = yield* options.credentials
									.remove(created)
									.pipe(Effect.either);
								if (Either.isLeft(removed)) {
									// Preserve an unreachable replacement for later secure cleanup, including restart.
									state = {
										...state,
										cleanupRefs: [...state.cleanupRefs, created],
									};
									yield* options.storage.write(state).pipe(Effect.either);
								}
							}
							return yield* written.left;
						}
						state = next;
						yield* cleanup().pipe(Effect.either);
						return yield* publish();
					}),
				),
			),
			select: Effect.fn("AgentConnections.select")(
				(id?: string, agentId?: string) =>
					exclusive(
						Effect.gen(function* () {
							if (!id && agentId !== undefined)
								return yield* new RuntimeConnectionInvalid();
							if (id) yield* get(id);
							const selected = id
								? yield* Schema.decodeUnknown(AgentConnectionSelection)({
										connectionId: id,
										...(agentId !== undefined ? { agentId } : {}),
									}).pipe(
										Effect.mapError(
											(cause) => new RuntimeConnectionInvalid(cause),
										),
									)
								: undefined;
							return yield* commit({
								version: 1,
								revision: state.revision + 1,
								connections: state.connections,
								cleanupRefs: state.cleanupRefs,
								...(selected ? { selected } : {}),
							});
						}),
					),
			),
			remove: Effect.fn("AgentConnections.remove")((id: string) =>
				exclusive(
					Effect.gen(function* () {
						const old = yield* get(id);
						return yield* commit({
							version: 1,
							revision: state.revision + 1,
							connections: state.connections.filter(
								(connection) => connection.id !== id,
							),
							cleanupRefs: [
								...state.cleanupRefs,
								...(old.credentialRef ? [old.credentialRef] : []),
							],
							...(state.selected && state.selected.connectionId !== id
								? { selected: state.selected }
								: {}),
						});
					}),
				),
			),
			subscribe: (receive) => {
				if (!disposed) listeners.add(receive);
				return () => {
					listeners.delete(receive);
				};
			},
			dispose: () => {
				disposed = true;
				listeners.clear();
			},
		};
	},
);

/** One bounded, versioned record, private permissions, atomic rename and no plaintext credentials. */
export function connectionFileStorage(root: string): ConnectionStorage {
	const file = join(root, "connections-v1.json");
	const initialize = async (): Promise<void> => {
		await mkdir(root, { recursive: true, mode: 0o700 });
		if (
			(await lstat(root)).isSymbolicLink() ||
			(await realpath(root)) !== resolve(root)
		)
			throw new RuntimeStorageFailed();
	};
	return {
		read: () =>
			Effect.tryPromise({
				try: async () => {
					await initialize();
					try {
						const info = await lstat(file);
						if (
							!info.isFile() ||
							info.isSymbolicLink() ||
							info.size > 1024 * 1024
						)
							throw new RuntimeStorageFailed();
						return JSON.parse(await readFile(file, "utf8"));
					} catch (cause) {
						if (
							cause instanceof Error &&
							"code" in cause &&
							cause.code === "ENOENT"
						)
							return initial();
						throw cause;
					}
				},
				catch: (cause) => new RuntimeStorageFailed(cause),
			}),
		write: (state) =>
			Effect.tryPromise({
				try: async () => {
					const validated = Schema.decodeUnknownSync(AgentConnectionsState, {
						onExcessProperty: "error",
					})(state);
					await initialize();
					const pending = join(root, `${randomUUID()}.pending`);
					try {
						const fd = await open(pending, "wx", 0o600);
						try {
							await fd.writeFile(JSON.stringify(validated), "utf8");
							await fd.sync();
						} finally {
							await fd.close();
						}
						await rename(pending, file);
					} finally {
						await rm(pending, { force: true });
					}
				},
				catch: (cause) => new RuntimeStorageFailed(cause),
			}),
	};
}
