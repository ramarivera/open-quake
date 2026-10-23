import type {
	ClockSnapshot,
	FillMode,
	HourFormat,
	ResourceRequest,
	ResourceTarget,
	VerifiedResourceCapability,
} from "./display-contracts.js";
import { PANEL_CANVAS } from "./display-contracts.js";

/** Total on untrusted numeric input. Invalid sizes have zero visible area. */
export function fillGeometry(
	mode: FillMode,
	width: number,
	height: number,
): { x: number; y: number; width: number; height: number } {
	if (![width, height].every((n) => Number.isFinite(n) && n > 0))
		return { x: 0, y: 0, width: 0, height: 0 };
	const scale =
		mode === "center"
			? 1
			: (mode === "contain" ? Math.min : Math.max)(
					PANEL_CANVAS.width / width,
					PANEL_CANVAS.height / height,
				);
	return {
		x: (PANEL_CANVAS.width - width * scale) / 2,
		y: (PANEL_CANVAS.height - height * scale) / 2,
		width: width * scale,
		height: height * scale,
	};
}
export function intervalMillis(value: number, unit: 0 | 1): number {
	const valid =
		Number.isInteger(value) &&
		(unit === 0 ? value >= 3 && value <= 86400 : value >= 1 && value <= 1440);
	return valid ? value * (unit === 0 ? 1000 : 60000) : 0;
}
const sameTarget = (a: ResourceTarget, b: ResourceTarget): boolean =>
	a._tag === "key" && b._tag === "key"
		? a.key.row === b.key.row && a.key.column === b.key.column
		: a._tag === "full-panel" &&
			b._tag === "full-panel" &&
			a.capabilityId === b.capabilityId;
export function hasVerifiedResourceTarget(
	request: ResourceRequest,
	capabilities: readonly VerifiedResourceCapability[],
): boolean {
	return capabilities.some(
		(c) =>
			c.deviceId === request.deviceId &&
			c.targets.some((target) => sameTarget(request.target, target)),
	);
}
export function clockSnapshot(epochMillis: number): ClockSnapshot {
	const date = new Date(epochMillis);
	return {
		epochMillis,
		hour: date.getHours(),
		minute: date.getMinutes(),
		second: date.getSeconds(),
	};
}
export function formatClock(
	snapshot: ClockSnapshot,
	format: HourFormat,
): string {
	const pad = (n: number): string => String(n).padStart(2, "0");
	const hour = format === "12h" ? snapshot.hour % 12 || 12 : snapshot.hour;
	return `${pad(hour)}:${pad(snapshot.minute)}:${pad(snapshot.second)}${format === "12h" ? (snapshot.hour < 12 ? " AM" : " PM") : ""}`;
}
