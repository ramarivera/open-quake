import { type Effect, Schema, type Stream } from "effect";
import { MeetingConfig, Segment } from "../../meetings/meeting-contracts.js";
import type { MeetingError } from "../../meetings/meeting-errors.js";

/** Host-private state, deliberately absent from MeetingRecord and renderer snapshots. */
export const MeetingResource = Schema.Struct({
	version: Schema.Literal(1),
	config: MeetingConfig,
	upload: Schema.optional(
		Schema.Struct({ url: Schema.NonEmptyString, expiresAt: Schema.Number }),
	),
	task: Schema.optional(Schema.String),
	internalRetries: Schema.optional(
		Schema.Number.pipe(Schema.int(), Schema.between(0, 3)),
	),
	segments: Schema.optional(Schema.Array(Segment)),
	remoteFiles: Schema.Array(Schema.String),
	cleanupPending: Schema.Boolean,
});
export type MeetingResource = typeof MeetingResource.Type;
export interface MeetingResources {
	readonly load: (
		ref: string,
	) => Effect.Effect<MeetingResource | undefined, MeetingError>;
	readonly save: (
		ref: string,
		resource: MeetingResource,
	) => Effect.Effect<void, MeetingError>;
	/** Converts the managed file to private mono MP3. Blob avoids retaining hours of audio in RAM. */
	readonly audio: (
		ref: string,
	) => Effect.Effect<
		{ readonly blob: Blob; readonly release: Effect.Effect<void> },
		MeetingError
	>;
	readonly pcm: (ref: string) => Effect.Effect<
		{
			readonly frames: Stream.Stream<Uint8Array, MeetingError>;
			readonly release: Effect.Effect<void>;
		},
		MeetingError
	>;
	readonly artifacts: (
		ref: string,
		raw: unknown,
		segments: readonly (typeof Segment.Type)[],
	) => Effect.Effect<void, MeetingError>;
}
export interface MeetingConnection {
	readonly key: string;
	/** Revokes this exact saved credential generation for the lifetime of a job. */
	readonly revoked: Effect.Effect<never, MeetingError>;
	readonly api: string;
	readonly files?: string;
	readonly realtime: string;
}
export type ResolveMeetingConnection = (
	config: typeof MeetingConfig.Type,
	translation?: boolean,
) => Effect.Effect<MeetingConnection, MeetingError>;
