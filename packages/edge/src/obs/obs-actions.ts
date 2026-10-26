import { Effect } from "effect";
import type { ObsCommand } from "../../../device/src/actions/obs-contracts.js";
import { type ObsError, ObsRequestFailed } from "./obs-errors.js";
export const obsInputTarget = (input: {
	readonly inputUuid: string;
	readonly inputName?: string | undefined;
}): Readonly<Record<string, string>> =>
	input.inputName === input.inputUuid
		? { inputName: input.inputName }
		: { inputUuid: input.inputUuid };
export type ObsRequest = (
	type: string,
	data?: Readonly<Record<string, unknown>>,
) => Effect.Effect<Record<string, unknown>, ObsError>;
export const obsExecute = Effect.fn("ObsService.executeCommand")(function* (
	command: ObsCommand,
	request: ObsRequest,
	delta?: -1 | 1,
): Effect.fn.Return<void, ObsError> {
	const c = command.settings;
	switch (command.type) {
		case "obsScene":
			yield* request("SetCurrentProgramScene", {
				sceneUuid: command.settings.sceneUuid,
			});
			break;
		case "obsPreviewScene":
			yield* request("SetCurrentPreviewScene", {
				sceneUuid: command.settings.sceneUuid,
			});
			break;
		case "obsTransition":
			yield* request("TriggerStudioModeTransition");
			break;
		case "obsStudioMode": {
			const state = yield* request("GetStudioModeEnabled");
			if (typeof state.studioModeEnabled !== "boolean")
				return yield* new ObsRequestFailed();
			yield* request("SetStudioModeEnabled", {
				studioModeEnabled: !state.studioModeEnabled,
			});
			break;
		}
		case "obsStream":
			yield* request("ToggleStream");
			break;
		case "obsRecord":
			yield* request(
				command.settings.mode === "pause" ? "PauseRecord" : "ToggleRecord",
			);
			break;
		case "obsSource": {
			const { sceneUuid, sceneItemId } = command.settings;
			const state = yield* request("GetSceneItemEnabled", {
				sceneUuid,
				sceneItemId,
			});
			if (typeof state.sceneItemEnabled !== "boolean")
				return yield* new ObsRequestFailed();
			yield* request("SetSceneItemEnabled", {
				sceneUuid,
				sceneItemId,
				sceneItemEnabled: !state.sceneItemEnabled,
			});
			break;
		}
		case "obsMute":
			yield* request("ToggleInputMute", obsInputTarget(command.settings));
			break;
		case "obsVolume": {
			const { step, allowGain } = command.settings;
			const target = obsInputTarget(command.settings);
			if (delta === undefined) {
				yield* request("ToggleInputMute", target);
				break;
			}
			const state = yield* request("GetInputVolume", target);
			if (
				typeof state.inputVolumeMul !== "number" ||
				!Number.isFinite(state.inputVolumeMul)
			)
				return yield* new ObsRequestFailed();
			yield* request("SetInputVolume", {
				...target,
				inputVolumeMul: Math.max(
					0,
					Math.min(allowGain ? 20 : 1, state.inputVolumeMul + step * delta),
				),
			});
			break;
		}
		case "obsCut":
			yield* request("SetCurrentSceneTransition", { transitionName: "Cut" });
			yield* request("TriggerStudioModeTransition");
			break;
		case "obsTransitionSet":
			yield* request("SetCurrentSceneTransition", {
				transitionName: command.settings.transitionName,
			});
			yield* request("SetCurrentSceneTransitionDuration", {
				transitionDuration: command.settings.durationMs,
			});
			break;
		case "obsAudioMonitor":
			yield* request("SetInputAudioMonitorType", {
				...obsInputTarget(command.settings),
				monitorType: {
					monitorOff: "OBS_MONITORING_TYPE_NONE",
					monitorOnly: "OBS_MONITORING_TYPE_MONITOR_ONLY",
					monitorAndOutput: "OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT",
				}[command.settings.monitorType],
			});
			break;
		case "obsReplayBuffer":
			yield* request(
				{
					toggle: "ToggleReplayBuffer",
					save: "SaveReplayBuffer",
					start: "StartReplayBuffer",
					stop: "StopReplayBuffer",
				}[command.settings.action],
			);
			break;
		case "obsVirtualCam":
			yield* request("ToggleVirtualCam");
			break;
		case "obsMedia":
			yield* request("TriggerMediaInputAction", {
				...obsInputTarget(command.settings),
				mediaAction:
					command.settings.mediaAction === "play"
						? "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_PLAY"
						: command.settings.mediaAction,
			});
			break;
		case "obsFilter":
			yield* request("SetSourceFilterEnabled", c);
			break;
		case "obsProfile":
			yield* request(
				command.settings.kind === "profile"
					? "SetCurrentProfile"
					: "SetCurrentSceneCollection",
				command.settings.kind === "profile"
					? { profileName: command.settings.name }
					: { sceneCollectionName: command.settings.name },
			);
			break;
		case "obsRecordSplit":
			yield* request("SplitRecordFile");
			break;
		case "obsSceneTransitionOverride":
			yield* request("SetSceneSceneTransitionOverride", {
				sceneUuid: command.settings.sceneUuid,
				transitionName: command.settings.transitionName,
				transitionDuration: command.settings.durationMs,
			});
			break;
		case "obsStats":
		case "obsScreenshot":
			break;
	}
});
