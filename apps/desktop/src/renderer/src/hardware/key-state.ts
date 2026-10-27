import type { HardwareSnapshot } from "../../../shared/hardware-contracts";
import { luminancePercent } from "../../../shared/hardware-contracts";

/** Recovered settings never stand in for live mic/luminance confirmation. */
export function hardwareKeyState(
	type: string,
	snapshot: HardwareSnapshot | undefined,
): { alternate?: 0 | 1; progress?: number; known: boolean } | undefined {
	if (!["buzzer", "mic", "luminance", "gameMode"].includes(type)) return;
	if (!snapshot?.available) return { known: false };
	if (type === "buzzer")
		return {
			known: true,
			alternate: snapshot.preferences.buzzerEnabled ? 0 : 1,
		};
	if (type === "mic")
		return snapshot.mic === undefined
			? { known: false }
			: { known: true, alternate: snapshot.mic ? 0 : 1 };
	if (type === "luminance")
		return snapshot.luminance === undefined
			? { known: false }
			: { known: true, progress: luminancePercent(snapshot.luminance) };
	return { known: true, alternate: snapshot.inputMode === "device" ? 0 : 1 };
}
