import { constants } from "node:fs";
import { open, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import {
	KnobCapabilityUnavailable,
	KnobDispatchFailed,
	type KnobError,
} from "../../../../../../packages/device/src/knob/knob-errors.js";
import type { BrightnessAdapter, BrightnessReading } from "./controller";

const numberFile = async (
	file: string,
): Promise<{ value: number; inode: string }> => {
	const handle = await open(
		file,
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
	);
	try {
		const stat = await handle.stat();
		if (!stat.isFile()) throw new RangeError("Invalid backlight attribute");
		const buffer = Buffer.alloc(129);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		const text = buffer.subarray(0, bytesRead).toString("utf8").trim();
		if (bytesRead > 128 || !/^\d+$/.test(text))
			throw new RangeError("Invalid backlight reading");
		const value = Number(text);
		if (!Number.isSafeInteger(value))
			throw new RangeError("Invalid backlight reading");
		return { value, inode: `${stat.dev}:${stat.ino}` };
	} finally {
		await handle.close();
	}
};
interface LinuxReading extends BrightnessReading {
	readonly path: string;
	readonly maximum: number;
	readonly inode: string;
}
export function linuxBrightness(
	root = "/sys/class/backlight",
): BrightnessAdapter {
	const read = Effect.fn("DesktopBrightness.linuxRead")(
		(): Effect.Effect<LinuxReading, KnobError> =>
			Effect.gen(function* () {
				const names = yield* Effect.tryPromise({
					try: () => readdir(root),
					catch: (cause) => KnobDispatchFailed.fromCause(cause),
				}).pipe(
					Effect.catchTag("KnobDispatchFailed", (error) =>
						typeof error.originalCause === "object" &&
						error.originalCause !== null &&
						Reflect.get(error.originalCause, "code") === "ENOENT"
							? Effect.succeed([] as string[])
							: Effect.fail(error),
					),
				);
				const name = names[0];
				if (
					names.length !== 1 ||
					name === undefined ||
					!/^[a-zA-Z0-9_.-]+$/.test(name) ||
					name === "." ||
					name === ".."
				)
					return yield* KnobCapabilityUnavailable.fromCause();
				return yield* Effect.tryPromise({
					try: async () => {
						const path = await realpath(join(root, name));
						const maximum = (await numberFile(join(path, "max_brightness")))
							.value;
						const { value, inode } = await numberFile(join(path, "brightness"));
						if (maximum < 1 || value > maximum)
							throw new RangeError("Invalid backlight range");
						return {
							path,
							maximum,
							inode,
							target: `${path}:${inode}:${maximum}`,
							percent: (value * 100) / maximum,
							quantum: 100 / maximum,
						};
					},
					catch: KnobDispatchFailed.fromCause,
				});
			}),
	);
	const deadline = Effect.timeoutFail({
		duration: "5 seconds",
		onTimeout: () =>
			KnobDispatchFailed.fromCause(
				Object.assign(new Error("Backlight IO deadline exceeded"), {
					code: "ETIMEDOUT",
				}),
			),
	});
	const boundedRead = read().pipe(deadline);
	return {
		read: boundedRead,
		write: Effect.fn("DesktopBrightness.linuxWrite")(
			(before, percent): Effect.Effect<void, KnobError> =>
				Effect.gen(function* () {
					const current = yield* boundedRead;
					if (
						current.target !== before.target ||
						!Number.isFinite(percent) ||
						percent < 0 ||
						percent > 100
					)
						return yield* KnobDispatchFailed.fromCause(
							new RangeError("Brightness target changed or value invalid"),
						);
					yield* Effect.tryPromise({
						try: async (signal) => {
							const handle = await open(
								join(current.path, "brightness"),
								constants.O_WRONLY |
									constants.O_NOFOLLOW |
									constants.O_NONBLOCK,
							);
							try {
								const stat = await handle.stat();
								if (
									!stat.isFile() ||
									`${stat.dev}:${stat.ino}` !== current.inode
								)
									throw new RangeError("Brightness target changed");
								signal.throwIfAborted();
								await handle.writeFile(
									`${Math.round((percent * current.maximum) / 100)}\n`,
									"utf8",
								);
							} finally {
								await handle.close();
							}
						},
						catch: KnobDispatchFailed.fromCause,
					}).pipe(deadline);
				}),
		),
	};
}
