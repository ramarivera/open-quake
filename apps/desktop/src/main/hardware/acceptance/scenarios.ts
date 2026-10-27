/** Scope is the control/session acceptance inventory, not all application parity. */
export const automatedScenarios = [
	["identity", "Discover exactly the selected canonical control identity"],
	["connect", "Open the production device session"],
	["firmware", "Read firmware identity through the production decoder"],
	["microphone", "Read the actual microphone state"],
	["luminance", "Read the actual panel luminance"],
	["qmk", "Read the QMK protocol version"],
	[
		"keepalive",
		"Observe production keepalive writes and subsequent live readback",
	],
	["mic-roundtrip", "Toggle microphone, query readback and restore"],
	["brightness-roundtrip", "Change luminance, query readback and restore"],
	["led-roundtrip", "Change knob LED, query readback and restore"],
	["disconnect", "Close the session and observe its terminal event"],
	["stale-owner", "Reject a write through the closed connection"],
	["reconnect", "Reopen the same selected device and query its state"],
] as const;

export const supervisedScenarios = [
	["touch", "Physical touch down, motion and lift coordinates"],
	["knob", "Physical knob detents, press, hold and release"],
	["hotplug", "Physical USB unplug, reconnect and reader isolation"],
	["display", "Physical panel placement, readability and visual output"],
	["keyboard", "Device keyboard output into an approved target window"],
	["audio", "Audible output and live microphone/provider loop"],
	["lighting", "Visually qualify lighting fields and persistent save/reload"],
] as const;

export type ScenarioId =
	| (typeof automatedScenarios)[number][0]
	| (typeof supervisedScenarios)[number][0];
export interface ScenarioResult {
	readonly id: ScenarioId;
	readonly name: string;
	status: "passed" | "failed" | "skipped" | "manual-or-supervised";
	reason?: string;
	cause?: object;
}
export function summarize(
	mode: "fake" | "native",
	scenarios: readonly ScenarioResult[],
) {
	const passed = scenarios.filter((item) => item.status === "passed").length;
	return {
		mode,
		total: scenarios.length,
		passed,
		failed: scenarios.filter((item) => item.status === "failed").length,
		skipped: scenarios.filter((item) => item.status === "skipped").length,
		manualOrSupervised: scenarios.filter(
			(item) => item.status === "manual-or-supervised",
		).length,
		nativePassed: mode === "native" ? passed : 0,
		nativePercent: mode === "native" ? (100 * passed) / scenarios.length : 0,
	};
}
