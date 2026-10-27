import {
	checksum,
	decodeHidReport,
	unwrapShortCommand,
} from "@open-quake/protocol";
import { Effect, Layer } from "effect";
import { makeFakeHidTransport } from "../hid-fake.js";
import { HidTransport } from "../hid-transport.js";

export const fakeHardwareReply = (
	cmdId: number,
	data: readonly number[],
): Uint8Array => {
	const report = new Uint8Array(32);
	report.set([
		0xa3,
		data.length + 2,
		0x55,
		cmdId,
		...data,
		checksum([0x55, cmdId, ...data]),
	]);
	return report;
};

/** Fully synthetic. The real node-hid module is never imported by this transport. */
export const makeFakeHardwareTransport = (
	options: {
		readonly serial?: string;
		readonly onCommand?: (command: {
			readonly opCode: number;
			readonly cmdId: number;
			readonly subData: readonly number[];
		}) => readonly Uint8Array[];
	} = {},
) =>
	Effect.gen(function* () {
		const fake = yield* makeFakeHidTransport([
			{
				path: "fake:hardware",
				vendorId: 0x4158,
				productId: 0x514b,
				usagePage: 0xff60,
				usage: 0x61,
				serialNumber: options.serial ?? "mock-quake",
			},
		]);
		let mic = 1;
		let knobLed = 1;
		let luminance = 255;
        const lighting = new Map<number, readonly number[]>([[9, [128]], [11, [100]], [12, [0, 255]]]);
		const transport: HidTransport["Type"] = {
			discover: fake.transport.discover,
			open: (info) =>
				Effect.gen(function* () {
					const handle = yield* fake.transport.open(info);
					return {
						...handle,
						write: (report) =>
							Effect.gen(function* () {
								yield* handle.write(report);
								if ([1, 7, 8, 9].includes(report[1] ?? -1)) {
                                    const body = new Uint8Array(32);
                                    body.set(report.slice(1));
                                    if (report[1] === 1) {body[1] = 0; body[2] = 10;}
                                    if (report[1] === 7) lighting.set(report[2] ?? 0, Array.from(report.slice(3, report[2] === 12 ? 5 : 4)));
                                    if (report[1] === 8) body.set(lighting.get(report[2] ?? 0) ?? [0], 2);
                                    yield* fake.emit(body);
                                    return;
                                }
                                const command = yield* decodeHidReport(report).pipe(
									Effect.orDie,
									Effect.flatMap((bytes) =>
										unwrapShortCommand(bytes).pipe(Effect.orDie),
									),
								);
								if (options.onCommand) {
									for (const reply of options.onCommand(command))
										yield* fake.emit(reply);
									return;
								}
								if (command.opCode === 2) {
									if (command.cmdId === 3)
										yield* fake.emit(fakeHardwareReply(3, [mic]));
									if (command.cmdId === 5)
										yield* fake.emit(fakeHardwareReply(5, [luminance]));
									if (command.cmdId === 6)
										yield* fake.emit(fakeHardwareReply(6, [knobLed]));
									if (command.cmdId === 46)
										yield* fake.emit(fakeHardwareReply(46, [1, 1, 0, 21]));
								} else if (command.opCode === 1) {
									if (command.cmdId === 6)
										knobLed = command.subData[0] ?? knobLed;
									if (command.cmdId === 3) mic = command.subData[0] ?? mic;
									if (command.cmdId === 5)
										luminance = command.subData[0] ?? luminance;
									yield* fake.emit(fakeHardwareReply(0, [0x90]));
								}
							}),
					};
				}),
		};
		return {
			...fake,
			transport,
			layer: Layer.succeed(HidTransport, transport),
		};
	});
