import { Effect, Layer, Option } from "effect";
import {
	type ActionActivation,
	ActionHostAdapters,
	ActionProfileSource,
	ActionService,
	type CommittedActionSnapshot,
} from "../../src/actions/index.js";

export const press: ActionActivation = {
	deviceId: "fixture-device",
	sessionId: "fixture-session",
	profileId: "profile-a",
	pageId: "page-a",
	revision: 4,
	keyCode: "1,1",
	sequence: 1,
	origin: "logical",
	kind: "press",
};
export const config = (type: string, value: string, actionType = "key") => ({
	type,
	actions: [{ type: actionType, value }],
});
export function harness(
	id = "website",
	action: unknown = config("website", "https://example.org", "url"),
) {
	const calls: Array<readonly [string, string]> = [];
	const record = (operation: string) => (value: string) =>
		Effect.sync(() => {
			calls.push([operation, value]);
		});
	const adapters: ActionHostAdapters["Type"] = {
		website: Option.some({ openUrl: record("website") }),
		keyboard: Option.some({
			supportedTokens: new Set(["a", "b", "control", "right_shift", "enter"]),
			pressChord: record("key"),
		}),
		text: Option.some({ insertText: record("text") }),
		application: Option.some({ launchApplication: record("app") }),
		media: Option.some({
			supportedCommands: new Set([
				"audio_play",
				"audio_stop",
				"audio_prev",
				"audio_next",
				"audio_rewind",
				"audio_forward",
				"audio_repeat",
				"audio_random",
			]),
			sendMedia: record("media"),
		}),
	};
	const snapshot: CommittedActionSnapshot = {
		deviceId: press.deviceId,
		sessionId: press.sessionId,
		profileId: press.profileId,
		pageId: press.pageId,
		revision: press.revision,
		keys: [
			{
				keyCode: press.keyCode,
				childrenName: id,
				display: true,
				config: action,
			},
		],
	};
	return {
		calls,
		adapters,
		snapshot,
		layer: (
			host: ActionHostAdapters["Type"] = adapters,
			source: ActionProfileSource["Type"] = {
				readCommitted: () => Effect.succeed(Option.some(snapshot)),
			},
		) =>
			ActionService.DefaultWithoutDependencies.pipe(
				Layer.provide(
					Layer.mergeAll(
						Layer.succeed(ActionHostAdapters, host),
						Layer.succeed(ActionProfileSource, source),
					),
				),
			),
	};
}
