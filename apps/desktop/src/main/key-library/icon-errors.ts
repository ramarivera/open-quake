import { Schema } from "effect";
import { toSafeDiagnosticCause } from "../../../../../packages/device/src/device-errors.js";
export const IconErrors = {
	invalid: {
		code: "QUAKE.ICON.INVALID_PACK",
		category: "validation",
		message: "Invalid icon pack",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
	storage: {
		code: "QUAKE.ICON.STORAGE_FAILED",
		category: "dependency",
		message: "Saving the icon library failed",
		policy: { userFacing: true, userRecoverable: true, retry: "manual" },
	},
} as const;
const definition = IconErrors.storage;
export class IconStorageFailed extends Schema.TaggedError<IconStorageFailed>()(
	"IconStorageFailed",
	{
		code: Schema.Literal(definition.code),
		category: Schema.Literal(definition.category),
		message: Schema.Literal(definition.message),
	},
) {
	declare readonly originalCause: unknown;
	readonly diagnosticCause: ReturnType<typeof toSafeDiagnosticCause>;
	constructor(cause: unknown) {
		super({
			code: definition.code,
			category: definition.category,
			message: definition.message,
		});
		this.diagnosticCause = toSafeDiagnosticCause(cause);
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
const importDefinition = IconErrors.invalid;
export class IconImportFailed extends Schema.TaggedError<IconImportFailed>()(
	"IconImportFailed",
	{
		code: Schema.Literal(importDefinition.code),
		category: Schema.Literal(importDefinition.category),
		message: Schema.Literal(importDefinition.message),
	},
) {
	declare readonly originalCause: unknown;
	readonly diagnosticCause: ReturnType<typeof toSafeDiagnosticCause>;
	constructor(cause: unknown) {
		super({
			code: importDefinition.code,
			category: importDefinition.category,
			message: importDefinition.message,
		});
		this.diagnosticCause = toSafeDiagnosticCause(cause);
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		});
	}
}
