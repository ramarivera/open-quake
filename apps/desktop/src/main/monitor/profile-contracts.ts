import { Schema } from "effect";
import type { ProfileFunctionContract } from "../../../../../packages/device/src/profiles/profile-function-contracts";
import { MonitorSettings, StyleId } from "../../shared/monitor-contracts";

const presentation = Schema.Struct({
	styleId: StyleId,
	background: Schema.Struct({
		mode: Schema.Literal("style", "none", "custom"),
		themes: MonitorSettings.fields.media,
	}),
});
/** Display-only keys still pass the same validation gate as executable actions. */
export const monitorProfileContracts: ReadonlyMap<
	string,
	ProfileFunctionContract
> = new Map(
	[
		"systemMonitorPanel",
		"cpuInfo",
		"gpuInfo",
		"memInfo",
		"diskInfo",
		"processInfo",
		"networkInfo",
		"powerInfo",
		"bluetoothInfo",
	].map((id) => [
		id,
		{
			childrenName: id,
			supportsKnob: false,
			supportsAlternateVisuals: false,
			validateConfig: (config) => {
				if (id !== "systemMonitorPanel")
					return config.actions.length ? [["actions"]] : [];
				const action = config.actions[0];
				return config.actions.length === 1 &&
					action?.type === "monitorStyle" &&
					Schema.is(presentation)(action.value)
					? []
					: [["actions"]];
			},
		},
	]),
);
