import type { PanelRotation } from "./display";

/** Diagnostic overlays are available only on explicitly opted-in development panels. */
export function surfaceQuery(
	surface: "management" | "panel",
	rotation: PanelRotation,
	serial: string | undefined,
	development: boolean,
	inputDiagnostics: string | undefined,
): Record<string, string> {
	return {
		surface,
		rotation: String(rotation),
		...(serial ? { serial } : {}),
		...(development && surface === "panel" && inputDiagnostics === "1"
			? { inputDiagnostics: "1" }
			: {}),
	};
}
