import { Schema } from "effect";
import { toSafeDiagnosticCause } from "../ai/ai-errors.js";

const entry = <
	const C extends string,
	const K extends string,
	const M extends string,
>(
	code: C,
	category: K,
	message: M,
) => ({
	code,
	category,
	message,
	policy: { userFacing: true, userRecoverable: true, retry: "manual" as const },
});
export const AgentErrors = {
	AgentInvalid: entry(
		"AGENT.KEY.INVALID",
		"validation",
		"The agent ID or workspace content is invalid",
	),
	AgentProtected: entry(
		"AGENT.MAIN.PROTECTED",
		"validation",
		"The main agent is protected",
	),
	AgentDuplicate: entry(
		"AGENT.KEY.DUPLICATE",
		"conflict",
		"This agent ID already exists",
	),
	AgentMissing: entry(
		"AGENT.CATALOG.MISSING",
		"validation",
		"The agent does not exist",
	),
	AgentStorageFailed: entry(
		"AGENT.STORAGE.FAILED",
		"dependency",
		"Agent storage failed",
	),
	AgentRevisionConflict: entry(
		"AGENT.REVISION.CONFLICT",
		"conflict",
		"The workspace changed; reload before saving",
	),
	SkillConflict: entry(
		"AGENT.SKILL.CONFLICT",
		"conflict",
		"A skill with this folder already exists at the target",
	),
	SkillWorkspaceInvalid: entry(
		"AGENT.SKILL.WORKSPACE_INVALID",
		"validation",
		"The target workspace is invalid",
	),
	SkillMoved: entry(
		"AGENT.SKILL.MOVED",
		"conflict",
		"The skill moved or was deleted",
	),
	SkillMoveIncomplete: entry(
		"AGENT.SKILL.MOVE_INCOMPLETE",
		"dependency",
		"The skill move did not finish; the original is retained",
	),
	AgentDraftUnavailable: entry(
		"AGENT.DRAFT.UNAVAILABLE",
		"unavailable",
		"AI drafting needs a configured provider",
	),
	AgentDraftFailed: entry(
		"AGENT.DRAFT.FAILED",
		"dependency",
		"AI drafting failed",
	),
	AgentRuntimeUnavailable: entry(
		"AGENT.RUNTIME.UNAVAILABLE",
		"unavailable",
		"No agent runtime is installed",
	),
	AgentRuntimeFailed: entry(
		"AGENT.RUNTIME.FAILED",
		"dependency",
		"The runtime operation failed",
	),
	AgentRuntimeTimeout: entry(
		"AGENT.RUNTIME.TIMEOUT",
		"dependency",
		"The runtime operation timed out",
	),
	AgentRuntimeBusy: entry(
		"AGENT.RUNTIME.BUSY",
		"conflict",
		"A runtime operation is in progress",
	),
	AgentModelInvalid: entry(
		"AGENT.MODEL.INVALID",
		"validation",
		"Provider, model, valid URL and positive integer max tokens are required",
	),
	AgentModelLastRow: entry(
		"AGENT.MODEL.LAST_ROW",
		"validation",
		"At least one model is required",
	),
	AgentCredentialUnavailable: entry(
		"AGENT.CREDENTIAL.UNAVAILABLE",
		"unavailable",
		"The secure credential store is unavailable",
	),
	AgentProfileMissing: entry(
		"AGENT.PANEL.PROFILE_MISSING",
		"validation",
		"The DK-Claw profile is unavailable",
	),
	AgentSlotInvalid: entry(
		"AGENT.PANEL.SLOT_INVALID",
		"validation",
		"A DK-Claw slot is missing or is not a clawbot key",
	),
	AgentPanelFailed: entry(
		"AGENT.PANEL.SYNC_FAILED",
		"dependency",
		"DK-Claw panel sync failed",
	),
	AgentRollbackFailed: entry(
		"AGENT.PANEL.ROLLBACK_FAILED",
		"dependency",
		"DK-Claw panel rollback failed",
	),
};
type Entry = (typeof AgentErrors)[keyof typeof AgentErrors];
const fields = <const E extends Entry>(e: E) => ({
	code: Schema.Literal(e.code),
	category: Schema.Literal(e.category),
	message: Schema.Literal(e.message),
	diagnosticCause: Schema.Unknown,
});
const props = <const E extends Entry>(e: E, cause: unknown) => ({
	code: e.code,
	category: e.category,
	message: e.message,
	diagnosticCause: toSafeDiagnosticCause(cause),
});
export class AgentInvalid extends Schema.TaggedError<AgentInvalid>()(
	"AgentInvalid",
	fields(AgentErrors.AgentInvalid),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.AgentInvalid, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export class AgentProtected extends Schema.TaggedError<AgentProtected>()(
	"AgentProtected",
	fields(AgentErrors.AgentProtected),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.AgentProtected, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export class AgentDuplicate extends Schema.TaggedError<AgentDuplicate>()(
	"AgentDuplicate",
	fields(AgentErrors.AgentDuplicate),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.AgentDuplicate, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export class AgentMissing extends Schema.TaggedError<AgentMissing>()(
	"AgentMissing",
	fields(AgentErrors.AgentMissing),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.AgentMissing, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export class AgentStorageFailed extends Schema.TaggedError<AgentStorageFailed>()(
	"AgentStorageFailed",
	fields(AgentErrors.AgentStorageFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.AgentStorageFailed, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export class AgentRevisionConflict extends Schema.TaggedError<AgentRevisionConflict>()(
	"AgentRevisionConflict",
	fields(AgentErrors.AgentRevisionConflict),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.AgentRevisionConflict, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export class SkillConflict extends Schema.TaggedError<SkillConflict>()(
	"SkillConflict",
	fields(AgentErrors.SkillConflict),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.SkillConflict, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export class SkillWorkspaceInvalid extends Schema.TaggedError<SkillWorkspaceInvalid>()(
	"SkillWorkspaceInvalid",
	fields(AgentErrors.SkillWorkspaceInvalid),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.SkillWorkspaceInvalid, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export class SkillMoved extends Schema.TaggedError<SkillMoved>()(
	"SkillMoved",
	fields(AgentErrors.SkillMoved),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.SkillMoved, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export class SkillMoveIncomplete extends Schema.TaggedError<SkillMoveIncomplete>()(
	"SkillMoveIncomplete",
	fields(AgentErrors.SkillMoveIncomplete),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.SkillMoveIncomplete, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export class AgentDraftUnavailable extends Schema.TaggedError<AgentDraftUnavailable>()(
	"AgentDraftUnavailable",
	fields(AgentErrors.AgentDraftUnavailable),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.AgentDraftUnavailable, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export class AgentDraftFailed extends Schema.TaggedError<AgentDraftFailed>()(
	"AgentDraftFailed",
	fields(AgentErrors.AgentDraftFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.AgentDraftFailed, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export class AgentRuntimeUnavailable extends Schema.TaggedError<AgentRuntimeUnavailable>()(
	"AgentRuntimeUnavailable",
	fields(AgentErrors.AgentRuntimeUnavailable),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.AgentRuntimeUnavailable, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export class AgentRuntimeFailed extends Schema.TaggedError<AgentRuntimeFailed>()(
	"AgentRuntimeFailed",
	fields(AgentErrors.AgentRuntimeFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.AgentRuntimeFailed, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export class AgentRuntimeTimeout extends Schema.TaggedError<AgentRuntimeTimeout>()(
	"AgentRuntimeTimeout",
	fields(AgentErrors.AgentRuntimeTimeout),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.AgentRuntimeTimeout, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export class AgentRuntimeBusy extends Schema.TaggedError<AgentRuntimeBusy>()(
	"AgentRuntimeBusy",
	fields(AgentErrors.AgentRuntimeBusy),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.AgentRuntimeBusy, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export class AgentModelInvalid extends Schema.TaggedError<AgentModelInvalid>()(
	"AgentModelInvalid",
	fields(AgentErrors.AgentModelInvalid),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.AgentModelInvalid, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export class AgentModelLastRow extends Schema.TaggedError<AgentModelLastRow>()(
	"AgentModelLastRow",
	fields(AgentErrors.AgentModelLastRow),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.AgentModelLastRow, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export class AgentCredentialUnavailable extends Schema.TaggedError<AgentCredentialUnavailable>()(
	"AgentCredentialUnavailable",
	fields(AgentErrors.AgentCredentialUnavailable),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.AgentCredentialUnavailable, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export class AgentProfileMissing extends Schema.TaggedError<AgentProfileMissing>()(
	"AgentProfileMissing",
	fields(AgentErrors.AgentProfileMissing),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.AgentProfileMissing, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export class AgentSlotInvalid extends Schema.TaggedError<AgentSlotInvalid>()(
	"AgentSlotInvalid",
	fields(AgentErrors.AgentSlotInvalid),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.AgentSlotInvalid, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export class AgentPanelFailed extends Schema.TaggedError<AgentPanelFailed>()(
	"AgentPanelFailed",
	fields(AgentErrors.AgentPanelFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.AgentPanelFailed, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export class AgentRollbackFailed extends Schema.TaggedError<AgentRollbackFailed>()(
	"AgentRollbackFailed",
	fields(AgentErrors.AgentRollbackFailed),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(props(AgentErrors.AgentRollbackFailed, cause));
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
export type AgentError =
	| AgentInvalid
	| AgentProtected
	| AgentDuplicate
	| AgentMissing
	| AgentStorageFailed
	| AgentRevisionConflict
	| SkillConflict
	| SkillWorkspaceInvalid
	| SkillMoved
	| SkillMoveIncomplete
	| AgentDraftUnavailable
	| AgentDraftFailed
	| AgentRuntimeUnavailable
	| AgentRuntimeFailed
	| AgentRuntimeTimeout
	| AgentRuntimeBusy
	| AgentModelInvalid
	| AgentModelLastRow
	| AgentCredentialUnavailable
	| AgentProfileMissing
	| AgentSlotInvalid
	| AgentPanelFailed
	| AgentRollbackFailed;
