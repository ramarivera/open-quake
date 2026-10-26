import { Schema } from "effect";
import { ProviderSettings } from "../ai/ai-contracts.js";
import { GenerationControls } from "../ai/ai-workflow-contracts.js";
import {
	ManagedEnvironment,
	ServiceSettings,
} from "./service-settings-contracts.js";
export const AgentId = Schema.String.pipe(
	Schema.pattern(/^[a-z][a-z0-9-]*$/),
	Schema.maxLength(48),
	Schema.brand("AgentId"),
);
export const FolderName = Schema.String.pipe(
	Schema.pattern(/^[a-z][a-z0-9-]*$/),
	Schema.maxLength(80),
);
export const MarkdownFile = Schema.String.pipe(
	Schema.pattern(/^[A-Za-z0-9_-]+\.md$/),
	Schema.maxLength(100),
);
export const Content = Schema.String.pipe(Schema.maxLength(262144));
export const Agent = Schema.Struct({
	id: AgentId,
	name: Schema.NonEmptyTrimmedString,
	emoji: Schema.String,
	files: Schema.Record({ key: MarkdownFile, value: Content }),
});
export type Agent = typeof Agent.Type;
export const Skill = Schema.Struct({
	folder: FolderName,
	owner: Schema.String,
	name: Schema.NonEmptyTrimmedString,
	description: Schema.String,
	content: Content,
});
export type Skill = typeof Skill.Type;
export const ModelRole = Schema.Literal("none", "default", "fallback");
export const ModelRow = Schema.Struct({
	id: Schema.NonEmptyString,
	role: ModelRole,
	provider: Schema.String,
	model: Schema.String,
	baseUrl: Schema.String,
	maxTokens: Schema.Int.pipe(Schema.positive()),
	temperature: Schema.optional(
		Schema.Number.pipe(Schema.finite(), Schema.between(0, 2)),
	),
	topP: Schema.optional(
		Schema.Number.pipe(Schema.finite(), Schema.between(0, 1)),
	),
	credentialRef: Schema.String,
	settings: Schema.optional(ProviderSettings),
	controls: Schema.optional(GenerationControls),
});
export type ModelRow = typeof ModelRow.Type;
export const Slots = Schema.Struct({
	"1,5": AgentId,
	"1,6": AgentId,
	"2,5": AgentId,
	"2,6": AgentId,
});
export type Slots = typeof Slots.Type;
export const SLOT_CODES = ["1,5", "1,6", "2,5", "2,6"] as const;
export const AgentState = Schema.Struct({
	schemaVersion: Schema.Literal(1),
	revision: Schema.Int.pipe(Schema.nonNegative()),
	agents: Schema.Array(Agent),
	skills: Schema.Array(Skill),
	models: Schema.Record({ key: Schema.String, value: Schema.Array(ModelRow) }),
	slots: Slots,
});
export type AgentState = typeof AgentState.Type;
export const RuntimeState = Schema.Struct({
	available: Schema.Boolean,
	status: Schema.Literal("ready", "starting", "stopping", "error", "stopped"),
	code: Schema.String,
	operation: Schema.Literal("start", "stop", "restart", "none"),
});
export type RuntimeState = typeof RuntimeState.Type;
export const PanelProgress = Schema.Struct({
	percent: Schema.Literal(0, 5, 40, 80, 100),
	stage: Schema.Literal(
		"idle",
		"preflight",
		"profile",
		"device",
		"done",
		"error",
	),
	deviceApplied: Schema.Boolean,
});
export type PanelProgress = typeof PanelProgress.Type;
export const PublicModelRow = Schema.Struct({
	...ModelRow.omit("credentialRef").fields,
	credentialAvailable: Schema.Boolean,
});
export type PublicModelRow = typeof PublicModelRow.Type;
export const AgentView = Schema.Struct({
	revision: Schema.Number,
	agents: Schema.Array(Agent),
	skills: Schema.Array(Skill),
	models: Schema.Record({
		key: Schema.String,
		value: Schema.Array(PublicModelRow),
	}),
	slots: Slots,
	runtime: RuntimeState,
	progress: PanelProgress,
	draftingAvailable: Schema.Boolean,
});
export type AgentView = typeof AgentView.Type;
const revision = Schema.Int.pipe(Schema.nonNegative());
export const AgentCommand = Schema.Union(
	Schema.Struct({
		type: Schema.Literal("rename"),
		id: AgentId,
		name: Schema.NonEmptyTrimmedString.pipe(Schema.maxLength(200)),
		revision,
	}),
	Schema.Struct({
		type: Schema.Literal("reset-templates"),
		id: AgentId,
		confirmed: Schema.Boolean,
		revision,
	}),
	Schema.Struct({ type: Schema.Literal("export-pack"), id: AgentId }),
	Schema.Struct({
		type: Schema.Literal("import-pack"),
		pack: Schema.String.pipe(Schema.maxLength(2097152)),
		revision,
	}),
	Schema.Struct({ type: Schema.Literal("diagnostics") }),
	Schema.Struct({ type: Schema.Literal("export-workspace-backup") }),
	Schema.Struct({ type: Schema.Literal("service-settings") }),
	Schema.Struct({
		type: Schema.Literal("save-service-settings"),
		settings: ServiceSettings,
		restart: Schema.Boolean,
		revision,
	}),
	Schema.Struct({
		type: Schema.Literal("clear-runtime-data"),
		confirmed: Schema.Boolean,
		revision,
	}),
	Schema.Struct({
		type: Schema.Literal("update-environment"),
		environment: ManagedEnvironment,
		revision,
	}),
	Schema.Struct({ type: Schema.Literal("read") }),
	Schema.Struct({
		type: Schema.Literal("runtime"),
		action: Schema.Literal("start", "stop", "restart"),
	}),
	Schema.Struct({
		type: Schema.Literal("create"),
		id: AgentId,
		name: Schema.NonEmptyTrimmedString,
		emoji: Schema.String,
	}),
	Schema.Struct({
		type: Schema.Literal("delete"),
		id: AgentId,
		confirmed: Schema.Boolean,
	}),
	Schema.Struct({
		type: Schema.Literal("save-file"),
		id: AgentId,
		file: MarkdownFile,
		content: Content,
		revision,
	}),
	Schema.Struct({
		type: Schema.Literal("draft-agent"),
		id: AgentId,
		prompt: Schema.NonEmptyTrimmedString,
		revision,
	}),
	Schema.Struct({
		type: Schema.Literal("draft-skill"),
		name: Schema.NonEmptyTrimmedString,
		prompt: Schema.String,
	}),
	Schema.Struct({
		type: Schema.Literal("save-skill"),
		create: Schema.Boolean,
		folder: FolderName,
		owner: Schema.String,
		name: Schema.NonEmptyTrimmedString,
		content: Content.pipe(Schema.minLength(1)),
		revision,
	}),
	Schema.Struct({
		type: Schema.Literal("delete-skill"),
		folder: FolderName,
		owner: Schema.String,
		confirmed: Schema.Boolean,
		revision,
	}),
	Schema.Struct({
		type: Schema.Literal("move-skill"),
		folder: FolderName,
		owner: Schema.String,
		target: Schema.String,
		revision,
	}),
	Schema.Struct({
		type: Schema.Literal("save-model"),
		scope: Schema.String,
		row: ModelRow.omit("credentialRef"),
		secret: Schema.String,
		revision,
	}),
	Schema.Struct({
		type: Schema.Literal("delete-model"),
		scope: Schema.String,
		id: Schema.String,
		confirmed: Schema.Boolean,
		revision,
	}),
	Schema.Struct({
		type: Schema.Literal("inherit"),
		scope: AgentId,
		enabled: Schema.Boolean,
		revision,
	}),
	Schema.Struct({ type: Schema.Literal("sync-panel"), slots: Slots, revision }),
);
export type AgentCommand = typeof AgentCommand.Type;
export type AgentInput = typeof AgentCommand.Encoded;
export const AgentReply = Schema.Union(
	Schema.Struct({
		_tag: Schema.Literal("success"),
		view: AgentView,
		draft: Schema.String,
	}),
	Schema.Struct({
		_tag: Schema.Literal("rejected"),
		code: Schema.String,
		message: Schema.String,
	}),
);
export type AgentReply = typeof AgentReply.Type;
export const EMOJI_PRESETS = [
	"🤖",
	"🦁",
	"🐯",
	"🦊",
	"🐼",
	"🐨",
	"🐮",
	"🐸",
	"🐧",
	"🦉",
	"🐙",
	"🦄",
	"🐺",
	"🦅",
	"⚡",
	"🔥",
	"🌙",
	"⭐",
	"🧠",
	"🎯",
] as const;
