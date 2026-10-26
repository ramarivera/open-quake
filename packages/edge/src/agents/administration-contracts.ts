import { Schema } from "effect";
import { Agent, Skill, Slots } from "./agents-contracts.js";
/** No archive paths, models or credentials cross the portable workspace boundary. */
export const AgentPack = Schema.Struct({
	version: Schema.Literal(1),
	agent: Agent,
	skills: Schema.Array(Skill).pipe(Schema.maxItems(64)),
});
export type AgentPack = typeof AgentPack.Type;
/** User-exported backup of authored workspaces only, never runtime or provider secrets. */
export const WorkspaceBackup = Schema.Struct({
	version: Schema.Literal(1),
	kind: Schema.Literal("local-agent-workspaces"),
	revision: Schema.Int.pipe(Schema.nonNegative()),
	agents: Schema.Array(Agent).pipe(Schema.maxItems(128)),
	skills: Schema.Array(Skill).pipe(Schema.maxItems(1024)),
	slots: Slots,
});
export type WorkspaceBackup = typeof WorkspaceBackup.Type;
export {
	ManagedEnvironment,
	ServiceSettings,
} from "./service-settings-contracts.js";
