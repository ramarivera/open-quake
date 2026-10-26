import { Schema } from "effect";
import {
	ObsCatalog,
	ObsConnectionConfig,
	ObsStatus,
	ObsTile,
	ObsVisible,
} from "../../../../packages/edge/src/obs/obs-contracts";
export const OBS_REQUEST = "obs:request",
	OBS_LIVE = "obs:live";
export const ObsRequest = Schema.Union(
	Schema.Struct({
		type: Schema.Literal("catalog"),
		sceneUuid: Schema.String.pipe(Schema.maxLength(512)),
	}),
	Schema.Struct({
		type: Schema.Literal("status", "connect", "disconnect", "detect"),
	}),
	Schema.Struct({
		type: Schema.Literal("configure"),
		config: ObsConnectionConfig,
		password: Schema.optional(Schema.String.pipe(Schema.maxLength(4096))),
	}),
	Schema.Struct({
		type: Schema.Literal("visible"),
		lease: Schema.NonEmptyString.pipe(Schema.maxLength(256)),
		tiles: Schema.Array(ObsVisible).pipe(Schema.maxItems(16)),
	}),
);
export type ObsRequest = typeof ObsRequest.Type;
export const ObsReply = Schema.Union(
	Schema.Struct({ type: Schema.Literal("catalog"), catalog: ObsCatalog }),
	Schema.Struct({ type: Schema.Literal("status"), status: ObsStatus }),
	Schema.Struct({ type: Schema.Literal("ok") }),
	Schema.Struct({
		type: Schema.Literal("error"),
		code: Schema.String,
		message: Schema.String,
	}),
);
export type ObsReply = typeof ObsReply.Type;
export const ObsLive = Schema.Struct({
	lease: Schema.String,
	tiles: Schema.Array(ObsTile),
});
export type ObsLive = typeof ObsLive.Type;
export interface ObsBridge {
	readonly request: (request: ObsRequest) => Promise<ObsReply>;
	readonly onLive: (receive: (live: ObsLive) => void) => () => void;
}
declare global {
	interface Window {
		readonly quakeObs?: ObsBridge;
	}
}
