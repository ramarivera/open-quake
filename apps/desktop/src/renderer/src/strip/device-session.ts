import { Either, Schema } from "effect";
import {
	type DeviceReadyBridge,
	DeviceReadyReply,
	type DeviceReadySnapshot,
} from "../../../shared/hardware-contracts";

/** One cancellable owner per mount; failed sends reuse the same bounded recovery. */
export function createStripDeviceSession(options: {
	readonly bridge: DeviceReadyBridge;
	readonly serial: string | undefined;
	readonly ready: (snapshot: DeviceReadySnapshot) => void;
	readonly schedule: (work: () => void, delay: number) => () => void;
}) {
	let live = true;
	let generation = 0;
	let attempt = 0;
	let pending: number | undefined;
	let cancel = () => {};
	const read = async () => {
		if (!live || pending !== undefined) return;
		const requested = generation;
		pending = requested;
		try {
			const decoded = Schema.decodeUnknownEither(DeviceReadyReply)(
				await options.bridge.read(options.serial),
			);
			if (!live || requested !== generation) return;
			if (
				Either.isRight(decoded) &&
				decoded.right._tag === "ready" &&
				(!options.serial ||
					decoded.right.snapshot.serialNumber === options.serial)
			) {
				attempt = 0;
				options.ready(decoded.right.snapshot);
			} else retry();
		} catch {
			if (live && requested === generation) retry();
		} finally {
			if (pending === requested) pending = undefined;
		}
	};
	const retry = () => {
		cancel();
		if (!live || attempt >= 10) return;
		attempt++;
		cancel = options.schedule(() => {
			void read();
		}, 3000 * attempt);
	};
	return {
		start: () => {
			void read();
		},
		lost: () => {
			generation++;
			pending = undefined;
			retry();
		},
		recover: () => {
			if (!live) return;
			cancel();
			generation++;
			pending = undefined;
			attempt = 0;
			void read();
		},
		close: () => {
			live = false;
			generation++;
			cancel();
		},
	};
}
