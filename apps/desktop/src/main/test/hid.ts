import {
	FAKE_QUAKE_DEVICE,
	makeFakeHidTransport,
} from "@open-quake/device/fake";
import { checksum } from "@open-quake/protocol";
import { Effect, Layer } from "effect";
import { HidTransport } from "../../../../../packages/device/src/hid-transport";

/** Independent incoming control report fixture, including the hardware padding. */
export function report(
	opcode: number,
	command: number,
	data: number[] = [],
): Uint8Array {
	const bytes = new Uint8Array(32);
	bytes.set([
		0xa3,
		data.length + 2,
		opcode,
		command,
		...data,
		checksum([opcode, command, ...data]),
	]);
	return bytes;
}

/** Two independent fake HID handles with mutable USB presence for main/bus tests. */
export const makeTwoStrips = Effect.gen(function* () {
	const a = { ...FAKE_QUAKE_DEVICE, path: "fake:A", serialNumber: "A" };
	const b = { ...FAKE_QUAKE_DEVICE, path: "fake:B", serialNumber: "B" };
	const first = yield* makeFakeHidTransport([a]);
	const second = yield* makeFakeHidTransport([b]);
	const devices = [a];
	const transport = HidTransport.of({
		discover: () => Effect.succeed(devices),
		open: (info) =>
			(info.path === a.path ? first : second).transport.open(info),
	});
	return {
		a,
		b,
		first,
		second,
		devices,
		layer: Layer.succeed(HidTransport, transport),
	};
});
