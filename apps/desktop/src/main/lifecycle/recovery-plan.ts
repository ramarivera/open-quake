import type { Display, Rectangle } from "electron";
import { isPanelCandidate } from "../display";

export interface StableBinding {
	readonly serial: string;
	readonly displayId?: number | undefined;
	readonly bounds?: Rectangle | undefined;
}
const equalBounds = (a: Rectangle | undefined, b: Rectangle) =>
	a !== undefined &&
	a.x === b.x &&
	a.y === b.y &&
	a.width === b.width &&
	a.height === b.height;
/** Reserve strong identities globally before applying the sole-remaining rule. */
export function planRecovery(
	bindings: readonly StableBinding[],
	displays: readonly Display[],
) {
	const available = new Map(
		displays.filter(isPanelCandidate).map((d) => [d.id, d]),
	);
	const assigned = new Map<string, Display>();
	for (const binding of bindings) {
		const display =
			binding.displayId === undefined
				? undefined
				: available.get(binding.displayId);
		// Two devices claiming the same ID is ambiguous, even if one happens to sort first.
		if (
			display &&
			bindings.filter((b) => b.displayId === display.id).length === 1
		) {
			assigned.set(binding.serial, display);
			available.delete(display.id);
		}
	}
	for (const binding of bindings.filter((b) => !assigned.has(b.serial))) {
		const matches = [...available.values()].filter((d) =>
			equalBounds(binding.bounds, d.bounds),
		);
		const display = matches.length === 1 ? matches[0] : undefined;
		if (
			display &&
			bindings.filter(
				(b) => !assigned.has(b.serial) && equalBounds(b.bounds, display.bounds),
			).length === 1
		) {
			assigned.set(binding.serial, display);
			available.delete(display.id);
		}
	}
	const unresolved = bindings.filter((b) => !assigned.has(b.serial));
	if (unresolved.length === 1 && available.size === 1) {
		const serial = unresolved[0]?.serial;
		const display = [...available.values()][0];
		if (serial && display) {
			assigned.set(serial, display);
			available.clear();
		}
	}
	return {
		assigned,
		unresolved: bindings
			.filter((b) => !assigned.has(b.serial))
			.map((b) => b.serial),
		candidates: [...available.keys()],
	};
}
