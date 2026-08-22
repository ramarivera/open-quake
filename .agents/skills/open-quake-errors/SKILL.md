---
name: open-quake-errors
description: Error-handling convention for the open-quake DK-Suite reimplementation - shared error catalog, Schema.TaggedError leaves, privacy-scrubbed diagnostic causes, tag/code-based handling. Governing for all packages.
---

# open-quake error hygiene

Calibration: apply the pattern, don't be religious about it. The point is
stable identity, safe diagnostics, and policy-driven handling - not ceremony.

## 1. One shared error catalog

Every error leaf owns a unique stable `code`, a `category`, a canonical
`message`, and a handling `policy`:

```ts
export const Errors = {
  UserLoadFailed: {
    code: "APP.USER.LOAD_FAILED",
    category: "dependency",
    message: "Loading the user failed",
    policy: { userFacing: false, userRecoverable: true, retry: "automatic" },
  },
} as const
```

Codes are stable API surface (`<SCOPE>.<SUBJECT>.<FAILURE>`, e.g.
`QUAKE.HID.OPEN_FAILED`) - consumers branch on them, never on message text.

## 2. Typed Effect errors derived from the catalog

Each leaf becomes a `Schema.TaggedError` whose public fields come from the
catalog entry; the constructor retains the original unknown cause privately:

```ts
const def = Errors.QuakeHidOpenFailed

export class QuakeHidOpenFailed extends Schema.TaggedError<QuakeHidOpenFailed>()(
	"QuakeHidOpenFailed",
	{
		code: Schema.Literal(def.code),
		category: Schema.Literal(def.category),
		message: Schema.Literal(def.message),
		diagnosticCause: Schema.optional(DiagnosticCause),
	},
) {
	declare readonly originalCause: unknown

	constructor(cause: unknown) {
		super({
			code: def.code,
			category: def.category,
			message: def.message,
			diagnosticCause: toSafeDiagnosticCause(cause),
		})
		Object.defineProperty(this, "originalCause", {
			value: cause,
			enumerable: false,
		})
	}
}
```

## 3. `toSafeDiagnosticCause`

Walks `Error.cause` to a fixed depth, truncates strings, strips secrets, and
emits only safe fields: error name, source code, operation, fingerprint.
The full original stays on the instance (non-enumerable) for server-side
debugging; it never serializes.

## 4. Translate at real boundaries only

Wrap a failing call where it actually fails (`Effect.tryPromise({ try, catch })`
with `catch: (cause) => new TheLeafError(cause)`). Keep the outer
operation-specific identity plus ordered source identities. Never re-wrap
through generic `Error`.

## 5. Handle by tag or code, never by message text

`Effect.catchTag` / `catchTags`; edge adapters explicitly allowlist which
fields are user-visible (driven by `policy.userFacing`).

## 6. Testing expectations per changed branch

Prove with the real consumer: exact tag/code, retained `originalCause`,
scrubbed serialized projection, missing/broken dependency behavior, and that
no generic or cause-dropping path was used.

## Relation to effect-best-practices

This refines (not replaces) the loaded `effect-best-practices` skill: same
`Schema.TaggedError` spine, plus catalog-derived identity, policy metadata,
and diagnostic scrubbing.
