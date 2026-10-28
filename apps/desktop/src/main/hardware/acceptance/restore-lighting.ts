import assert from "node:assert/strict";
import { Effect, Fiber } from "effect";
import { canonicalHidSerial } from "../../../../../../packages/device/src/device-contracts.js";
import type {
	QuakeConnection,
	QuakeDevice,
} from "../../../../../../packages/device/src/device-service.js";
import { HardwareUnavailable } from "../../../../../../packages/device/src/hardware/hardware-errors.js";
import {
	type QmkOperation,
	qmkOperationBytes,
} from "../../../../../../packages/device/src/hardware/qmk-operations.js";

/** Restore outside poisoned controls, reopening the exact device if its raw exchange ended. */
export const restoreLightingValue = (
	device: QuakeDevice,
	connection: QuakeConnection,
	serial: string,
	prefix: readonly number[],
	values: readonly number[],
) => {
	const restore = (owner: QuakeConnection) =>
		Effect.gen(function* () {
			const exchange = owner.exchangeRaw;
			if (!exchange) return yield* new HardwareUnavailable();
			for (const operation of [
				{ _tag: "set", prefix, values },
				{ _tag: "get", prefix, length: values.length },
			] satisfies QmkOperation[]) {
				const command = qmkOperationBytes(operation);
				const reply: Uint8Array = yield* exchange(command.report, (report) => {
					const body =
						report.length === 33 && report[0] === 0 ? report.slice(1) : report;
					return (
						body.length >= command.prefix.length + command.length &&
						command.prefix.every((byte, index) => body[index] === byte)
					);
				});
				if (operation._tag === "get") {
					const body: Uint8Array =
						reply.length === 33 && reply[0] === 0 ? reply.slice(1) : reply;
					assert.deepEqual(
						Array.from(
							body.slice(
								command.prefix.length,
								command.prefix.length + command.length,
							),
						),
						values,
						"Lighting restoration mismatch",
					);
				}
			}
		});
	return restore(connection).pipe(
		Effect.catchAll(() =>
			Effect.scoped(
				Effect.gen(function* () {
					yield* connection.disconnect();
					const matches = (yield* device.discover()).filter(
						(info) => canonicalHidSerial(info.serialNumber ?? "") === serial,
					);
					const info = matches[0];
					if (matches.length !== 1 || !info)
						return yield* new HardwareUnavailable();
					const reopened = yield* device.connect({ path: info.path });
					yield* restore(reopened);
				}),
			).pipe(
				// Cleanup is uninterruptible, but connection lifetime fibers must remain stoppable.
				Effect.interruptible,
				Effect.forkDaemon,
				Effect.flatMap(Fiber.join),
			),
		),
	);
};
