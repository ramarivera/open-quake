import type { RuntimeHealth } from "../../../../../../../packages/edge/src/agent-http/runtime-contracts";
import { RuntimeErrors } from "../../../../../../../packages/edge/src/agent-http/runtime-errors";
import type {
	AgentConnectionCommand,
	AgentConnectionDiscovery,
	AgentConnectionReply,
	AgentConnectionsBridge,
	AgentConnectionView,
} from "../../../../shared/agent-connections";
import t from "./strings.json";

export interface ConnectionState {
	readonly view: AgentConnectionView | undefined;
	readonly busy: boolean;
	readonly error:
		| { readonly code: string; readonly message: string }
		| undefined;
	readonly health: Readonly<Record<string, RuntimeHealth>>;
	readonly discovery: Readonly<Record<string, AgentConnectionDiscovery>>;
}

/** Only public snapshots enter state. Credential-bearing commands stay transient. */
export function createConnectionsController(
	bridge: AgentConnectionsBridge | undefined,
) {
	let state: ConnectionState = {
		view: undefined,
		busy: false,
		error: undefined,
		health: {},
		discovery: {},
	};
	const listeners = new Set<() => void>();
	let epoch = 0;
	let mounted = false;
	let off: (() => void) | undefined;
	const update = (next: ConnectionState) => {
		state = next;
		for (const listener of listeners) listener();
	};
	const apply = (view: AgentConnectionView) => {
		if (state.view && view.revision < state.view.revision) return;
		const revisionChanged = state.view?.revision !== view.revision;
		const unchanged = new Set(
			view.connections
				.filter((connection) => {
					const previous = state.view?.connections.find(
						(item) => item.id === connection.id,
					);
					return (
						!revisionChanged &&
						previous?.baseURL === connection.baseURL &&
						previous.kind === connection.kind &&
						previous.credentialAvailable === connection.credentialAvailable
					);
				})
				.map((connection) => connection.id),
		);
		update({
			...state,
			view,
			health: Object.fromEntries(
				Object.entries(state.health).filter(([id]) => unchanged.has(id)),
			),
			discovery: Object.fromEntries(
				Object.entries(state.discovery).filter(([id]) => unchanged.has(id)),
			),
		});
	};
	const request = async (
		command: AgentConnectionCommand,
		selectSaved = false,
	): Promise<AgentConnectionReply | undefined> => {
		if (!mounted || state.busy) return undefined;
		if (!bridge) {
			update({
				...state,
				error: {
					code: RuntimeErrors.RuntimeUnavailable.code,
					message: t.unavailable,
				},
			});
			return undefined;
		}
		const previousIds = new Set(
			state.view?.connections.map((connection) => connection.id),
		);
		const requestEpoch = epoch;
		update({ ...state, busy: true, error: undefined });
		try {
			let reply = await bridge.request(command);
			if (!mounted || epoch !== requestEpoch) return undefined;
			if (selectSaved && command.type === "save" && reply._tag === "success") {
				const savedId =
					command.id ??
					reply.view.connections.find(
						(connection) => !previousIds.has(connection.id),
					)?.id;
				if (savedId && reply.view.selected?.connectionId !== savedId) {
					// Keep the busy interval across both writes. An automatic discovery
					// must not consume the gap and silently discard the selection.
					apply(reply.view);
					const selection = await bridge
						.request({
							type: "select",
							id: savedId,
						})
						.catch(() => ({
							_tag: "rejected" as const,
							code: RuntimeErrors.RuntimeRequestFailed.code,
							message: t.disconnected,
						}));
					if (!mounted || epoch !== requestEpoch) return undefined;
					if (selection._tag === "rejected") {
						update({ ...state, error: selection });
						return reply;
					}
					reply = selection;
				}
			}
			if (reply._tag === "rejected") update({ ...state, error: reply });
			else {
				const currentReply =
					!state.view || reply.view.revision >= state.view.revision;
				apply(reply.view);
				if (command.type === "save" && command.id) {
					const health = { ...state.health };
					const discovery = { ...state.discovery };
					delete health[command.id];
					delete discovery[command.id];
					update({ ...state, health, discovery });
				}
				if (currentReply && command.type === "test" && reply.health)
					update({
						...state,
						health: { ...state.health, [command.id]: reply.health },
					});
				if (currentReply && command.type === "discover" && reply.discovery)
					update({
						...state,
						discovery: { ...state.discovery, [command.id]: reply.discovery },
					});
			}
			return reply;
		} catch {
			if (mounted && epoch === requestEpoch)
				update({
					...state,
					error: {
						code: RuntimeErrors.RuntimeRequestFailed.code,
						message: t.disconnected,
					},
				});
			return undefined;
		} finally {
			if (mounted && epoch === requestEpoch) update({ ...state, busy: false });
		}
	};
	return {
		getSnapshot: () => state,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		request,
		saveAndSelect: (
			command: Extract<AgentConnectionCommand, { type: "save" }>,
		) => request(command, true),
		dismissError: () => update({ ...state, error: undefined }),
		start: () => {
			mounted = true;
			epoch++;
			update({ ...state, busy: false });
			off = bridge?.onSnapshot((view) => {
				if (mounted) apply(view);
			});
			void request({ type: "list" });
		},
		dispose: () => {
			mounted = false;
			epoch++;
			off?.();
			off = undefined;
		},
	};
}
