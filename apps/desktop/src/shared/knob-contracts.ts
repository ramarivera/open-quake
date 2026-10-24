import { Schema } from "effect";
import { KnobModelSnapshot } from "../../../../packages/device/src/knob/model/contracts.js";

export type {
	FocusKey,
	KnobModelContext,
	MenuProfile,
} from "../../../../packages/device/src/knob/model/contracts.js";
export { KnobModelSnapshot };
export const KNOB_REQUEST = "knob:request";
export const KNOB_SNAPSHOT = "knob:snapshot";
const session = { sessionId: Schema.NonEmptyTrimmedString };
export const KnobRequest = Schema.Union(
	Schema.TaggedStruct("Read", {}),
	Schema.TaggedStruct("TapTile", {
		...session,
		keyCode: Schema.NonEmptyTrimmedString,
	}),
	Schema.TaggedStruct("ToggleVolume", session),
	Schema.TaggedStruct("Page", { ...session, delta: Schema.Literal(-1, 1) }),
	Schema.TaggedStruct("Select", {
		...session,
		profileId: Schema.NonEmptyTrimmedString,
	}),
	Schema.TaggedStruct("Dismiss", session),
);
export type KnobRequest = typeof KnobRequest.Type;
export const KnobReply = Schema.Union(
	Schema.TaggedStruct("success", { snapshot: KnobModelSnapshot }),
	Schema.TaggedStruct("failure", { code: Schema.String }),
);
export type KnobReply = typeof KnobReply.Type;
export interface KnobBridge {
	request(command: KnobRequest): Promise<unknown>;
	onSnapshot(callback: (snapshot: unknown) => void): () => void;
}
declare global {
	interface Window {
		quakeKnob?: KnobBridge;
	}
}

export { selectorProfiles } from "../../../../packages/device/src/knob/model/invariants.js";
