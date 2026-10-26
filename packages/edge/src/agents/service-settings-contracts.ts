import { Schema } from "effect";
export const ServiceSettings = Schema.Struct({
	port: Schema.Int.pipe(Schema.between(1, 65535)),
	logLevel: Schema.Literal("debug", "info", "warn", "error"),
	autoStart: Schema.Boolean,
	dataDirectory: Schema.NonEmptyTrimmedString.pipe(Schema.maxLength(4096)),
});
export type ServiceSettings = typeof ServiceSettings.Type;
/** Only managed preferences, never arbitrary process.env or provider credentials. */
export const ManagedEnvironment = Schema.Struct({
	logLevel: Schema.Literal("debug", "info", "warn", "error"),
});
