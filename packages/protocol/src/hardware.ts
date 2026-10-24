import { Either, Option, Schema } from "effect";
import { type ShortCommand, validate } from "./contracts.js";
import type { ProtocolError } from "./errors.js";
import { ProtocolInputInvalid } from "./errors.js";
import { decodeHidReport, encodeHidReport } from "./framing.js";
import { unwrapShortCommand, wrapShortCommand } from "./short-command.js";

export const AlertVolume = Schema.Union(
	Schema.Literal(0),
	Schema.Int.pipe(Schema.between(32, 128)),
);
export const PanelLuminance = Schema.Int.pipe(Schema.between(25, 255));
export const HardwareCommand = Schema.Union(
	Schema.TaggedStruct("Buzzer", { level: AlertVolume }),
	Schema.TaggedStruct("Mic", { on: Schema.Boolean }),
	Schema.TaggedStruct("ScreenPower", { on: Schema.Boolean }),
	Schema.TaggedStruct("Luminance", { value: PanelLuminance }),
	Schema.TaggedStruct("KnobLed", { on: Schema.Boolean }),
	Schema.TaggedStruct("Keyboard", {
		action: Schema.Literal(0, 1, 2),
		modifiers: Schema.Uint8,
		usage: Schema.Uint8,
	}),
	Schema.TaggedStruct("Query", {
		feature: Schema.Literal("mic", "luminance", "version"),
	}),
);
export type HardwareCommand = typeof HardwareCommand.Type;
export const FirmwareIdentity = Schema.Struct({
	deviceName: Schema.Uint8,
	major: Schema.Uint8,
	minor: Schema.Uint8,
	patch: Schema.Uint8,
});
export const HardwareReply = Schema.Union(
	Schema.TaggedStruct("Ack", { status: Schema.Uint8 }),
	Schema.TaggedStruct("MicState", { on: Schema.Boolean }),
	Schema.TaggedStruct("LuminanceState", { value: Schema.Uint8 }),
	Schema.TaggedStruct("FirmwareVersion", FirmwareIdentity.fields),
);
export type HardwareReply = typeof HardwareReply.Type;
export const queryId = { mic: 3, luminance: 5, version: 0x2e } as const;

/** MAIN-018..026: flag/set and query semantics recovered from background.js. */
export function hardwareShortCommand(command: HardwareCommand): ShortCommand {
	switch (command._tag) {
		case "Query":
			return { opCode: 2, cmdId: queryId[command.feature], subData: [] };
		case "Buzzer":
			return { opCode: 1, cmdId: 2, subData: [command.level] };
		case "Mic":
			return { opCode: 1, cmdId: 3, subData: [Number(command.on)] };
		case "ScreenPower":
			return { opCode: 1, cmdId: 4, subData: [Number(command.on)] };
		case "Luminance":
			return { opCode: 1, cmdId: 5, subData: [command.value] };
		case "KnobLed":
			return { opCode: 1, cmdId: 6, subData: [Number(command.on)] };
		case "Keyboard":
			return {
				opCode: 1,
				cmdId: 0x10,
				subData: [command.action, command.modifiers, command.usage],
			};
	}
}
export const encodeHardwareCommand = (
	input: HardwareCommand,
): Either.Either<Uint8Array, ProtocolError> =>
	validate(HardwareCommand, input).pipe(
		Either.map(hardwareShortCommand),
		Either.flatMap(wrapShortCommand),
		Either.flatMap(encodeHidReport),
	);

/** Strict semantic decoder over a decoded short command. Unknown commands stay inert. */
export function decodeHardwareReply(
	command: ShortCommand,
): Either.Either<Option.Option<HardwareReply>, ProtocolError> {
	if (command.opCode !== 0x55) return Either.right(Option.none());
	const { cmdId, subData } = command;
	const first = subData[0];
	if (![0, 3, 5, 0x2e].includes(cmdId)) return Either.right(Option.none());
	if (subData.length !== (cmdId === 0x2e ? 4 : 1))
		return Either.left(new ProtocolInputInvalid("hardware-reply-length"));
	let input: unknown;
	switch (cmdId) {
		case 0:
			input = { _tag: "Ack", status: first };
			break;
		case 3:
			if (first !== 0 && first !== 1)
				return Either.left(new ProtocolInputInvalid("mic-state-bit"));
			input = { _tag: "MicState", on: first === 1 };
			break;
		case 5:
			input = { _tag: "LuminanceState", value: first };
			break;
		default:
			input = {
				_tag: "FirmwareVersion",
				deviceName: first,
				major: subData[1],
				minor: subData[2],
				patch: subData[3],
			};
	}
	return validate(HardwareReply, input).pipe(Either.map(Option.some));
}
export const decodeHardwareFrame = (
	input: unknown,
): Either.Either<Option.Option<HardwareReply>, ProtocolError> =>
	unwrapShortCommand(input).pipe(Either.flatMap(decodeHardwareReply));

/** Semantic outgoing-command decoder, including report ID and strict padding validation. */
export function decodeHardwareCommand(
	input: unknown,
): Either.Either<HardwareCommand, ProtocolError> {
	return decodeHidReport(input).pipe(
		Either.flatMap(unwrapShortCommand),
		Either.flatMap((command) => {
			const { opCode, cmdId, subData } = command;
			if (opCode === 2 && subData.length === 0) {
				const feature =
					cmdId === 3
						? "mic"
						: cmdId === 5
							? "luminance"
							: cmdId === 46
								? "version"
								: undefined;
				return validate(HardwareCommand, { _tag: "Query", feature });
			}
			if (opCode !== 1 || subData.length !== (cmdId === 16 ? 3 : 1))
				return Either.left(new ProtocolInputInvalid("hardware-command-shape"));
			const value = subData[0];
			if (cmdId === 16)
				return validate(HardwareCommand, {
					_tag: "Keyboard",
					action: value,
					modifiers: subData[1],
					usage: subData[2],
				});
			if (cmdId === 2)
				return validate(HardwareCommand, { _tag: "Buzzer", level: value });
			if (cmdId === 5)
				return validate(HardwareCommand, { _tag: "Luminance", value });
			if (value !== 0 && value !== 1)
				return Either.left(new ProtocolInputInvalid("hardware-command-bit"));
			const tag =
				cmdId === 3
					? "Mic"
					: cmdId === 4
						? "ScreenPower"
						: cmdId === 6
							? "KnobLed"
							: undefined;
			return validate(HardwareCommand, { _tag: tag, on: value === 1 });
		}),
	);
}
