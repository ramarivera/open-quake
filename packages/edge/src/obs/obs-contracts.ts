import { Schema } from "effect";
import { ObsCommand } from "../../../device/src/actions/obs-contracts.js";
import type { ObsError } from "./obs-errors.js";

export const ObsHost = Schema.NonEmptyTrimmedString.pipe(
	Schema.maxLength(253),
	Schema.filter((host) => {
		if (
			/[\s/@?#\\]/.test(host) ||
			host === "0.0.0.0" ||
			host === "::" ||
			host === "[::]"
		)
			return false;
		try {
			const url = new URL(`ws://${host}:4455`);
			return (
				url.hostname.length > 0 &&
				url.hostname !== "0.0.0.0" &&
				url.hostname !== "[::]" &&
				url.pathname === "/" &&
				!url.username &&
				!url.password &&
				url.port === "4455"
			);
		} catch {
			return false;
		}
	}),
);
export const ObsConnectionConfig = Schema.Struct({
	host: ObsHost,
	port: Schema.Int.pipe(Schema.between(1, 65535)),
	autoConnect: Schema.Boolean,
});
export type ObsConnectionConfig = typeof ObsConnectionConfig.Type;
export const ObsSaved = Schema.Struct({
	...ObsConnectionConfig.fields,
	credentialRef: Schema.String,
	manualOverride: Schema.Boolean,
});
export type ObsSaved = typeof ObsSaved.Type;
export const emptyObsSaved: ObsSaved = {
	host: "127.0.0.1",
	port: 4455,
	autoConnect: true,
	credentialRef: "",
	manualOverride: false,
};
export const ObsStatus = Schema.Struct({
	...ObsConnectionConfig.fields,
	state: Schema.Literal("disconnected", "connecting", "connected", "failed"),
	code: Schema.String,
	passwordSet: Schema.Boolean,
	manualOverride: Schema.Boolean,
	detection: Schema.Literal("not-run", "found", "not-found"),
	source: Schema.String,
});
export type ObsStatus = typeof ObsStatus.Type;
export const ObsVisible = Schema.Struct({
	id: Schema.NonEmptyString.pipe(Schema.maxLength(256)),
	command: ObsCommand,
});
export type ObsVisible = typeof ObsVisible.Type;
export const ObsTile = Schema.Struct({
	id: Schema.String,
	type: Schema.String,
	connected: Schema.Boolean,
	text: Schema.String,
	color: Schema.String,
	active: Schema.Boolean,
	values: Schema.Array(Schema.Union(Schema.Number, Schema.Null)),
	image: Schema.String.pipe(Schema.maxLength(2_000_000)),
});
export type ObsTile = typeof ObsTile.Type;
export interface ObsConnection {
	readonly connected: () => boolean;
	readonly terminalError: () => ObsError | undefined;
	readonly transitioning: () => boolean;
	readonly request: (
		type: string,
		data?: Readonly<Record<string, unknown>>,
		signal?: AbortSignal,
	) => Promise<Record<string, unknown>>;
	readonly close: () => void;
}
export interface ObsDetection {
	readonly source: string;
	readonly port: number;
	readonly password: string;
}
export const ObsCatalog = Schema.Struct({
	scenes: Schema.Array(
		Schema.Struct({ sceneUuid: Schema.String, sceneName: Schema.String }),
	),
	inputs: Schema.Array(
		Schema.Struct({
			inputUuid: Schema.String,
			inputName: Schema.String,
			inputKind: Schema.String,
			special: Schema.optional(Schema.Boolean),
			hasAudio: Schema.optional(Schema.Boolean),
		}),
	),
	transitions: Schema.Array(Schema.Struct({ transitionName: Schema.String })),
	items: Schema.Array(
		Schema.Struct({ sceneItemId: Schema.Int, sourceName: Schema.String }),
	),
});
export type ObsCatalog = typeof ObsCatalog.Type;
