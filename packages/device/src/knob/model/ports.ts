import { Context, Effect, Layer } from "effect";
import { KnobCapabilityUnavailable, type KnobError } from "../knob-errors.js";
import type {
	FocusKey,
	KnobModelContext,
	KnobVoiceInput,
	MenuProfile,
	VolumeReading,
} from "./contracts.js";

/** All inputs refer to committed profiles. Adapters recheck session ownership before IO. */
export interface KnobModelPort {
	/** Best-effort feedback; only the catalog identity reaches this boundary. */
	readonly alert?: (code: KnobError["code"]) => Effect.Effect<void, KnobError>;
	readonly selectProfile: (
		profileId: string,
	) => Effect.Effect<KnobModelContext, KnobError>;
	readonly focusedTurn: (
		key: FocusKey,
		delta: -1 | 1,
		context: KnobModelContext,
	) => Effect.Effect<void, KnobError>;
	readonly focusedPress?: (
		key: FocusKey,
		context: KnobModelContext,
	) => Effect.Effect<void, KnobError>;
	readonly assignedPress?: (context: KnobModelContext) => Effect.Effect<boolean, KnobError>;
	readonly voice: (input: KnobVoiceInput) => Effect.Effect<void, KnobError>;
	readonly readVolume: Effect.Effect<VolumeReading, KnobError>;
	readonly writeVolume: (
		reading: VolumeReading,
	) => Effect.Effect<void, KnobError>;
	readonly warmThumbnails: (
		profiles: readonly MenuProfile[],
	) => Effect.Effect<readonly MenuProfile[], KnobError>;
}
export class KnobModelPorts extends Context.Tag(
	"@open-quake/device/KnobModelPorts",
)<KnobModelPorts, KnobModelPort>() {}
const unavailable = Effect.fail(KnobCapabilityUnavailable.fromCause());
export const NoKnobModelPorts = Layer.succeed(KnobModelPorts, {
	selectProfile: () => unavailable,
	focusedTurn: () => unavailable,
	voice: () => unavailable,
	readVolume: unavailable,
	writeVolume: () => unavailable,
	warmThumbnails: (profiles) => Effect.succeed(profiles),
});
