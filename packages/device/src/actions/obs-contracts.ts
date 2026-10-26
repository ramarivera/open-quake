import { Either, Schema } from "effect";

const name = Schema.NonEmptyTrimmedString.pipe(Schema.maxLength(512));
const scene = { sceneUuid: name, sceneName: Schema.optional(name) };
const input = { inputUuid: name, inputName: Schema.optional(name) };
const transition = {
	transitionName: name,
	durationMs: Schema.optionalWith(Schema.Int.pipe(Schema.between(50, 20000)), {
		default: () => 300,
	}),
};
const command = <const I extends string, F extends Schema.Struct.Fields>(
	type: I,
	fields: F,
) =>
	Schema.Struct({
		type: Schema.Literal(type),
		settings: Schema.Struct(fields),
	});
export const ObsCommand = Schema.Union(
	command("obsScene", scene),
	command("obsPreviewScene", scene),
	command("obsTransition", {}),
	command("obsStudioMode", {}),
	command("obsStream", { mode: Schema.optional(Schema.Literal("toggle")) }),
	command("obsRecord", {
		mode: Schema.optionalWith(Schema.Literal("toggle", "pause"), {
			default: () => "toggle",
		}),
	}),
	command("obsSource", {
		...scene,
		sceneItemId: Schema.Int.pipe(Schema.nonNegative()),
		sourceName: Schema.optional(name),
	}),
	command("obsMute", input),
	command("obsVolume", {
		...input,
		step: Schema.optionalWith(Schema.Number.pipe(Schema.between(0.01, 0.2)), {
			default: () => 0.05,
		}),
		allowGain: Schema.optionalWith(Schema.Boolean, { default: () => false }),
		pressAction: Schema.optional(Schema.Literal("mute")),
	}),
	command("obsCut", {}),
	command("obsTransitionSet", transition),
	command("obsAudioMonitor", {
		...input,
		monitorType: Schema.Literal(
			"monitorOff",
			"monitorOnly",
			"monitorAndOutput",
		),
	}),
	command("obsReplayBuffer", {
		action: Schema.Literal("toggle", "save", "start", "stop"),
	}),
	command("obsVirtualCam", {}),
	command("obsMedia", {
		...input,
		mediaAction: Schema.Literal(
			"play",
			"OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY",
			"OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PAUSE",
			"OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP",
			"OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
			"OBS_WEBSOCKET_MEDIA_INPUT_ACTION_NEXT",
			"OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PREVIOUS",
		),
	}),
	command("obsFilter", {
		sourceName: name,
		filterName: name,
		filterEnabled: Schema.Boolean,
	}),
	command("obsProfile", {
		kind: Schema.Literal("profile", "sceneCollection"),
		name,
	}),
	command("obsRecordSplit", {}),
	command("obsSceneTransitionOverride", { sceneUuid: name, ...transition }),
	command("obsStats", {}),
	command("obsScreenshot", {
		sceneUuid: Schema.optional(name),
		sourceName: name,
	}),
);
export type ObsCommand = typeof ObsCommand.Type;
export type ObsId = ObsCommand["type"];
export const OBS_IDS = [
	"obsScene",
	"obsPreviewScene",
	"obsTransition",
	"obsStudioMode",
	"obsStream",
	"obsRecord",
	"obsSource",
	"obsMute",
	"obsVolume",
	"obsCut",
	"obsTransitionSet",
	"obsAudioMonitor",
	"obsReplayBuffer",
	"obsVirtualCam",
	"obsMedia",
	"obsFilter",
	"obsProfile",
	"obsRecordSplit",
	"obsSceneTransitionOverride",
	"obsStats",
	"obsScreenshot",
] as const satisfies readonly ObsId[];
export const isObsId = (id: string): id is ObsId =>
	OBS_IDS.some((value) => value === id);
const json = Schema.parseJson(Schema.Unknown);
export const decodeObsCommand = (type: string, value: string) =>
	Schema.decodeUnknownEither(json)(value).pipe(
		Either.flatMap((settings) =>
			Schema.decodeUnknownEither(ObsCommand)(
				{ type, settings },
				{ onExcessProperty: "error" },
			),
		),
	);
export const obsCommandFromKey = (key: {
	readonly config: {
		readonly type: string;
		readonly actions: readonly {
			readonly type: string;
			readonly value: unknown;
		}[];
	};
}) => {
	const action = key.config.actions[0];
	return decodeObsCommand(
		key.config.type,
		key.config.actions.length === 1 &&
			action?.type === "configData" &&
			typeof action.value === "string"
			? action.value
			: "",
	);
};
export const obsKeyConfig = <const I extends ObsId>(type: I) =>
	Schema.Struct({
		type: Schema.Literal(type),
		actions: Schema.Tuple(
			Schema.Struct({
				type: Schema.Literal("configData"),
				value: Schema.String.pipe(
					Schema.maxLength(8192),
					Schema.filter((value) =>
						Either.isRight(decodeObsCommand(type, value)),
					),
				),
			}),
		),
	});
export const obsDraft = (id: ObsId): string => {
	switch (id) {
		case "obsStream":
		case "obsRecord":
			return '{"mode":"toggle"}';
		case "obsReplayBuffer":
			return '{"action":"toggle"}';
		case "obsTransition":
		case "obsStudioMode":
		case "obsCut":
		case "obsVirtualCam":
		case "obsRecordSplit":
		case "obsStats":
			return "{}";
		default:
			return "";
	}
};
