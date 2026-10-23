import { Either, Layer, Schema } from "effect";
import {
	emptyKnobResource,
	emptyKnobSlot,
	InvalidKnobConfig,
	KNOB_OWNED_CAPABILITIES,
	type KnobCapability,
	type KnobDispatchCommand,
	KnobDispatchPorts,
	type KnobFunction,
	type KnobPorts,
	type KnobResource,
	KnobService,
	type KnobSession,
	type KnobSlots,
	replaceKnobSlot,
} from "../../src/knob/index.js";

export const session: KnobSession = {
	deviceId: "device-a",
	sessionId: "connection-1-selection-1",
	profileId: "profile-a",
	revision: 4,
};
export const nextPage: KnobFunction = {
	childrenName: "nextPage",
	config: { type: "nextPage", actions: [] },
};
export const previousPage: KnobFunction = {
	childrenName: "previousPage",
	config: { type: "previousPage", actions: [] },
};
export const brightness: KnobFunction = {
	childrenName: "panelBrightness",
	config: {
		type: "panelBrightness",
		actions: [{ type: "stepPercent", value: 5 }],
	},
};
export const key = (value: string): KnobFunction => ({
	childrenName: "hotkey",
	config: { type: "hotkey", actions: [{ type: "key", value }] },
});
export const voice = (model = "model-a"): KnobFunction => ({
	childrenName: "assistant",
	config: {
		type: "assistant",
		actions: [
			{ type: "voiceRoute", value: "direct" },
			{ type: "directProvider", value: "provider-a" },
			{ type: "directModel", value: model },
		],
	},
});
export const knob = (
	slots: KnobSlots = [emptyKnobSlot(), emptyKnobSlot(), nextPage],
): KnobResource => ({
	...emptyKnobResource(),
	config: { ...emptyKnobResource().config, subActions: slots },
});
const chord = Schema.Struct({
	type: Schema.Literal("key"),
	value: Schema.Literal("ctrl+a", "ctrl+b", "ctrl+c"),
});
export const hostCapability: KnobCapability = {
	id: "hotkey",
	rotation: true,
	press: true,
	hold: false,
	validate: (assignment) =>
		Schema.is(Schema.Tuple(chord))(assignment.config.actions)
			? Either.right(undefined)
			: Either.left(InvalidKnobConfig.fromCause("unsupported-chord")),
};
export const registry = [...KNOB_OWNED_CAPABILITIES, hostCapability];
export const snapshot = (resource: KnobResource = knob()) => ({
	session,
	knob: resource,
});
export function harness(
	initial: unknown = snapshot(),
	overrides: Partial<KnobPorts> = {},
) {
	let current = initial;
	const commands: KnobDispatchCommand[] = [];
	let reads = 0;
	const layer = KnobService.DefaultWithoutDependencies.pipe(
		Layer.provide(
			Layer.succeed(KnobDispatchPorts, {
				registry,
				readSnapshot: () => {
					reads++;
					return Promise.resolve(current);
				},
				dispatch: (command) => {
					commands.push(command);
					return Promise.resolve();
				},
				...overrides,
			}),
		),
	);
	return {
		layer,
		commands,
		readCount: () => reads,
		publish: (value: unknown) => {
			current = value;
		},
	};
}
export const rotate = (
	detents = 1,
	direction: "clockwise" | "counterclockwise" = "clockwise",
) => ({ _tag: "Rotate" as const, session, direction, detents });
export const press = { _tag: "Press", session, pressId: "press-1" } as const;
export const release = {
	_tag: "Release",
	session,
	pressId: "press-1",
	classification: "short",
} as const;
export { replaceKnobSlot };
