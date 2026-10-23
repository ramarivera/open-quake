import type { Display } from "electron";

export function makeDisplay(overrides: Partial<Display> = {}): Display {
	const size = overrides.size ?? { width: 2560, height: 1440 };
	const bounds = { x: 0, y: 0, ...size };
	return {
		accelerometerSupport: "unknown",
		bounds,
		colorDepth: 24,
		colorSpace: "srgb",
		depthPerComponent: 8,
		detected: true,
		displayFrequency: 60,
		id: 1,
		internal: false,
		label: "Desktop",
		maximumCursorSize: { width: 64, height: 64 },
		monochrome: false,
		nativeOrigin: { x: 0, y: 0 },
		rotation: 0,
		scaleFactor: 1,
		size,
		touchSupport: "unknown",
		workArea: bounds,
		workAreaSize: size,
		...overrides,
	};
}
