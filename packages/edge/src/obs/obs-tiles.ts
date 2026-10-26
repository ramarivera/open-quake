import { Effect } from "effect";
import type { ObsCommand } from "../../../device/src/actions/obs-contracts.js";
import { type ObsRequest, obsInputTarget } from "./obs-actions.js";
import type { ObsTile } from "./obs-contracts.js";
import { type ObsError, ObsRequestFailed } from "./obs-errors.js";

const number = (value: unknown): number | null =>
	typeof value === "number" && Number.isFinite(value) ? value : null;
export const unavailableObsTile = (id: string, type: string): ObsTile => ({
	id,
	type,
	connected: false,
	text: "disconnected",
	color: "#888888",
	active: false,
	values: [],
	image: "",
});
export const readObsTile = Effect.fn("ObsService.readTile")(function* (
	id: string,
	command: ObsCommand,
	request: ObsRequest,
	transitioning: boolean,
): Effect.fn.Return<ObsTile, ObsError> {
	let text = "",
		color = "#888888",
		active = false;
	const base = {
		id,
		type: command.type,
		connected: true,
		values: [],
		image: "",
		text,
		color,
		active,
	};
	switch (command.type) {
		case "obsStats": {
			const stats = yield* request("GetStats");
			return {
				...base,
				values: [
					number(stats.cpuUsage),
					number(stats.outputSkippedFrames),
					number(stats.renderSkippedFrames),
					number(stats.renderTotalFrames),
				],
			};
		}
		case "obsScreenshot": {
			// The UUID survives scene renames; imported settings may only have a name.
			const source = command.settings.sceneUuid
				? { sourceUuid: command.settings.sceneUuid }
				: { sourceName: command.settings.sourceName };
			const shot = yield* request("GetSourceScreenshot", {
				...source,
				imageFormat: "jpeg",
				imageWidth: 128,
				imageHeight: 128,
			});
			if (typeof shot.imageData !== "string")
				return yield* new ObsRequestFailed();
			const image = shot.imageData.startsWith("data:")
				? shot.imageData
				: `data:image/jpeg;base64,${shot.imageData}`;
			if (
				image.length > 2_000_000 ||
				!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(image)
			)
				return yield* new ObsRequestFailed();
			return { ...base, image };
		}
		case "obsStream":
		case "obsRecord":
		case "obsReplayBuffer":
		case "obsVirtualCam": {
			const requestType = {
				obsStream: "GetStreamStatus",
				obsRecord: "GetRecordStatus",
				obsReplayBuffer: "GetReplayBufferStatus",
				obsVirtualCam: "GetVirtualCamStatus",
			}[command.type];
			const state = yield* request(requestType);
			if (typeof state.outputActive !== "boolean")
				return yield* new ObsRequestFailed();
			active = state.outputActive;
			text =
				command.type === "obsStream"
					? active
						? "live"
						: "standby"
					: command.type === "obsRecord"
						? state.outputPaused === true
							? "pause"
							: active
								? "rec"
								: "standby"
						: command.type === "obsReplayBuffer"
							? active
								? "replaying"
								: "replay"
							: active
								? "camOn"
								: "camOff";
			color = active
				? command.type === "obsReplayBuffer"
					? "#FFAA00"
					: command.type === "obsVirtualCam"
						? "#33CC33"
						: "#FF5555"
				: "#888888";
			break;
		}
		case "obsStudioMode": {
			const state = yield* request("GetStudioModeEnabled");
			if (typeof state.studioModeEnabled !== "boolean")
				return yield* new ObsRequestFailed();
			active = state.studioModeEnabled;
			text = active ? "studioOn" : "studioOff";
			color = active ? "#33CC33" : "#888888";
			break;
		}
		case "obsScene":
		case "obsPreviewScene": {
			const state = yield* request(
				command.type === "obsScene"
					? "GetCurrentProgramScene"
					: "GetCurrentPreviewScene",
			);
			active = state.sceneUuid === command.settings.sceneUuid;
			text =
				command.settings.sceneName ??
				(command.type === "obsScene" ? "scene" : "preview");
			color = active
				? command.type === "obsScene"
					? "#33CC33"
					: "#33AACC"
				: "#888888";
			break;
		}
		case "obsMute":
		case "obsVolume": {
			const state = yield* request(
				"GetInputMute",
				obsInputTarget(command.settings),
			);
			if (typeof state.inputMuted !== "boolean")
				return yield* new ObsRequestFailed();
			active = state.inputMuted;
			text = active ? "muted" : "unmuted";
			color = active ? "#FF5555" : "#33CC33";
			break;
		}
		case "obsSource": {
			const state = yield* request("GetSceneItemEnabled", {
				sceneUuid: command.settings.sceneUuid,
				sceneItemId: command.settings.sceneItemId,
			});
			if (typeof state.sceneItemEnabled !== "boolean")
				return yield* new ObsRequestFailed();
			active = state.sceneItemEnabled;
			text = active ? "shown" : "hidden";
			color = active ? "#33CC33" : "#888888";
			break;
		}
		case "obsTransition":
			text = transitioning ? "transitioning" : "transition";
			color = transitioning ? "#FFAA00" : "#888888";
			active = transitioning;
			break;
		default:
			text = command.type;
	}
	return { ...base, text, color, active };
});
