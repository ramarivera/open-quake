import { Context, type Effect, type Option, type Redacted } from "effect";
import type {
	Agent,
	AgentState,
	RuntimeState,
	Slots,
} from "./agents-contracts.js";
import type { AgentError, AgentStorageFailed } from "./agents-errors.js";
export interface AgentDraftAdapter {
	/** Optional late-acquired backend capability. Omitted adapters remain available. */
	readonly available?: () => boolean;
	readonly agent: (input: {
		readonly agent: Agent;
		readonly prompt: string;
	}) => Effect.Effect<Readonly<Record<string, string>>, AgentError>;
	readonly skill: (input: {
		readonly name: string;
		readonly prompt: string;
	}) => Effect.Effect<string, AgentError>;
}
export class AgentDraftPort extends Context.Tag("AgentDraftPort")<
	AgentDraftPort,
	AgentDraftAdapter
>() {}
/** Resolves only when the backend reports the target state. Interruption must cancel its work. */
export interface AgentRuntimeAdministration {
	readonly logs: () => Effect.Effect<
		readonly {
			readonly status: RuntimeState["status"];
			readonly operation: RuntimeState["operation"];
			readonly code: string;
		}[],
		AgentError
	>;
	readonly settings: () => Effect.Effect<
		import("./administration-contracts.js").ServiceSettings,
		AgentError
	>;
	readonly save: (
		settings: import("./administration-contracts.js").ServiceSettings,
		restart: boolean,
	) => Effect.Effect<void, AgentError>;
	readonly clear: Effect.Effect<void, AgentError>;
	readonly environment: (
		settings: typeof import("./administration-contracts.js").ManagedEnvironment.Type,
	) => Effect.Effect<void, AgentError>;
}
export interface AgentRuntimeAdapter {
	/** Only a locally owned backend may expose these operations. HTTP adapters omit it. */
	readonly administration?: AgentRuntimeAdministration;
	readonly available: boolean;
	readonly dispose?: Effect.Effect<void, AgentError>;
	readonly initial: RuntimeState;
	readonly start: Effect.Effect<void, AgentError>;
	readonly stop: Effect.Effect<void, AgentError>;
	readonly restart: Effect.Effect<void, AgentError>;
	readonly subscribe: (listener: (state: RuntimeState) => void) => () => void;
}
export class AgentRuntimePort extends Context.Tag("AgentRuntimePort")<
	AgentRuntimePort,
	AgentRuntimeAdapter
>() {}
export interface AgentCredentialAdapter {
	readonly store: (
		secret: Redacted.Redacted<string>,
	) => Effect.Effect<string, AgentError>;
	readonly available: (reference: string) => Effect.Effect<boolean, AgentError>;
	readonly remove: (reference: string) => Effect.Effect<void, AgentError>;
}
export class AgentCredentialPort extends Context.Tag("AgentCredentialPort")<
	AgentCredentialPort,
	AgentCredentialAdapter
>() {}
export interface AgentPanelTransaction {
	readonly apply: Effect.Effect<boolean, AgentError>;
	readonly rollback: Effect.Effect<void, AgentError>;
}
export class AgentPanelPort extends Context.Tag("AgentPanelPort")<
	AgentPanelPort,
	{
		readonly prepare: (
			slots: Slots,
			agents: readonly Agent[],
		) => Effect.Effect<AgentPanelTransaction, AgentError>;
	}
>() {}
export type AgentMutation = (
	state: AgentState,
) => Effect.Effect<AgentState, AgentError>;
export type AgentRead = Effect.Effect<
	Option.Option<unknown>,
	AgentStorageFailed
>;
