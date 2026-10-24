import { Schema } from "effect";
import {
	HardwarePreferences,
	HardwareSnapshot,
	InputMode,
} from "../../../../packages/device/src/hardware/hardware-contracts";

export { HardwareSnapshot } from "../../../../packages/device/src/hardware/hardware-contracts";
export {
	luminancePercent,
	sliderToVolume,
	volumeToSlider,
} from "../../../../packages/device/src/hardware/hardware-invariants";
export const HARDWARE_REQUEST = "hardware:request";
const identity = { session: Schema.NonEmptyString };
export const HardwareRequest = Schema.Union(
	Schema.TaggedStruct("read", {}),
	Schema.TaggedStruct("configure", {
		...identity,
		preferences: HardwarePreferences,
	}),
	Schema.TaggedStruct("inputMode", { ...identity, mode: InputMode }),
	Schema.TaggedStruct("refresh", identity),
	Schema.TaggedStruct("toggleMic", identity),
	Schema.TaggedStruct("stepBrightness", {
		...identity,
		direction: Schema.Literal(-1, 1),
	}),
);
export type HardwareRequest = typeof HardwareRequest.Type;
export const HardwareResponse = Schema.Union(
	Schema.TaggedStruct("ready", {
		snapshot: HardwareSnapshot,
		mock: Schema.Boolean,
	}),
	Schema.TaggedStruct("offline", {}),
	Schema.TaggedStruct("failure", { code: Schema.String }),
);
export type HardwareResponse = typeof HardwareResponse.Type;
export interface HardwareBridge {
	readonly request: (input: HardwareRequest) => Promise<unknown>;
}
declare global {
	interface Window {
		readonly quakeHardware?: HardwareBridge;
	}
}
