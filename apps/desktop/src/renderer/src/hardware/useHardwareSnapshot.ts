import { Schema } from "effect";
import { useEffect, useState } from "react";
import {
	HardwareResponse,
	type HardwareSnapshot,
} from "../../../shared/hardware-contracts";

/** One serial-specific read stream per mounted strip. Late replies cannot cross a profile/device switch. */
export function useHardwareSnapshot(
	serial: string | undefined,
): HardwareSnapshot | undefined {
	const [state, setState] = useState<HardwareSnapshot>();
	useEffect(() => {
		let live = true;
		let pending = false;
		const read = async () => {
			if (pending) return;
			pending = true;
			try {
				const decoded = Schema.decodeUnknownEither(HardwareResponse)(
					await window.quakeHardware?.request({
						_tag: "read",
						...(serial ? { serial } : {}),
					}),
				);
				if (live)
					setState(
						decoded._tag === "Right" &&
							decoded.right._tag === "ready" &&
							(!serial || decoded.right.snapshot.serial === serial)
							? decoded.right.snapshot
							: undefined,
					);
			} catch {
				if (live) setState(undefined);
			} finally {
				pending = false;
			}
		};
		setState(undefined);
		void read();
		const timer = setInterval(() => void read(), 500);
		return () => {
			live = false;
			clearInterval(timer);
		};
	}, [serial]);
	return state && (!serial || state.serial === serial) ? state : undefined;
}
