import { Schema } from "effect";
import { DiagnosticCause, toSafeDiagnosticCause } from "../ai/ai-errors.js";

const policy = {
	userFacing: true,
	userRecoverable: true,
	retry: "manual" as const,
};
export const ChatErrors = {
	Invalid: {
		code: "CHAT.INPUT.INVALID",
		category: "validation",
		message: "The chat input is invalid",
		policy,
	},
	Busy: {
		code: "CHAT.SESSION.BUSY",
		category: "conflict",
		message: "The chat session is busy",
		policy,
	},
	NotFound: {
		code: "CHAT.SESSION.NOT_FOUND",
		category: "validation",
		message: "The chat session is unavailable",
		policy,
	},
	ModeUnavailable: {
		code: "CHAT.MODE.UNAVAILABLE",
		category: "validation",
		message: "The chat mode is unavailable",
		policy,
	},
	ContextTooLarge: {
		code: "CHAT.CONTEXT.TOO_LARGE",
		category: "validation",
		message: "The chat context exceeds the model budget",
		policy,
	},
	ResyncRequired: {
		code: "CHAT.STREAM.RESYNC_REQUIRED",
		category: "conflict",
		message: "The chat view needs a fresh snapshot",
		policy,
	},
	LimitExceeded: {
		code: "CHAT.LIMIT.EXCEEDED",
		category: "validation",
		message: "The chat limit was reached",
		policy,
	},
	StorageFailed: {
		code: "CHAT.HISTORY.STORAGE_FAILED",
		category: "dependency",
		message: "The private chat history could not be saved",
		policy,
	},
	Timeout: {
		code: "CHAT.RESPONSE.TIMEOUT",
		category: "timeout",
		message: "The chat response timed out",
		policy,
	},
	Interrupted: {
		code: "CHAT.RESPONSE.INTERRUPTED",
		category: "unavailable",
		message: "The chat response was interrupted",
		policy,
	},
} as const;
const definition = <const K extends keyof typeof ChatErrors>(key: K) => {
	const entry = ChatErrors[key];
	return {
		code: Schema.Literal(entry.code),
		category: Schema.Literal(entry.category),
		message: Schema.Literal(entry.message),
		diagnosticCause: DiagnosticCause,
	};
};
const properties = <const K extends keyof typeof ChatErrors>(
	key: K,
	cause: unknown,
) => ({
	code: ChatErrors[key].code,
	category: ChatErrors[key].category,
	message: ChatErrors[key].message,
	diagnosticCause: toSafeDiagnosticCause(cause),
});
const retain = (target: object, cause: unknown) =>
	Object.defineProperty(target, "originalCause", {
		value: cause,
		enumerable: false,
	});

export class ChatInvalid extends Schema.TaggedError<ChatInvalid>()(
	"ChatInvalid",
	definition("Invalid"),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(properties("Invalid", cause));
		retain(this, cause);
	}
}

export class ChatBusy extends Schema.TaggedError<ChatBusy>()(
	"ChatBusy",
	definition("Busy"),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(properties("Busy", cause));
		retain(this, cause);
	}
}

export class ChatNotFound extends Schema.TaggedError<ChatNotFound>()(
	"ChatNotFound",
	definition("NotFound"),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(properties("NotFound", cause));
		retain(this, cause);
	}
}

export class ChatModeUnavailable extends Schema.TaggedError<ChatModeUnavailable>()(
	"ChatModeUnavailable",
	definition("ModeUnavailable"),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(properties("ModeUnavailable", cause));
		retain(this, cause);
	}
}

export class ChatContextTooLarge extends Schema.TaggedError<ChatContextTooLarge>()(
	"ChatContextTooLarge",
	definition("ContextTooLarge"),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(properties("ContextTooLarge", cause));
		retain(this, cause);
	}
}

export class ChatResyncRequired extends Schema.TaggedError<ChatResyncRequired>()(
	"ChatResyncRequired",
	definition("ResyncRequired"),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(properties("ResyncRequired", cause));
		retain(this, cause);
	}
}

export class ChatLimitExceeded extends Schema.TaggedError<ChatLimitExceeded>()(
	"ChatLimitExceeded",
	definition("LimitExceeded"),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(properties("LimitExceeded", cause));
		retain(this, cause);
	}
}

export class ChatStorageFailed extends Schema.TaggedError<ChatStorageFailed>()(
	"ChatStorageFailed",
	definition("StorageFailed"),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(properties("StorageFailed", cause));
		retain(this, cause);
	}
}

export class ChatTimeout extends Schema.TaggedError<ChatTimeout>()(
	"ChatTimeout",
	definition("Timeout"),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(properties("Timeout", cause));
		retain(this, cause);
	}
}

export class ChatInterrupted extends Schema.TaggedError<ChatInterrupted>()(
	"ChatInterrupted",
	definition("Interrupted"),
) {
	declare readonly originalCause: unknown;
	constructor(cause: unknown = undefined) {
		super(properties("Interrupted", cause));
		retain(this, cause);
	}
}

export type ChatError =
	| ChatInvalid
	| ChatBusy
	| ChatNotFound
	| ChatModeUnavailable
	| ChatContextTooLarge
	| ChatResyncRequired
	| ChatLimitExceeded
	| ChatStorageFailed
	| ChatTimeout
	| ChatInterrupted;
