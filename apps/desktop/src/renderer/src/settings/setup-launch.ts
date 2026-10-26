import type { WizardSnapshot } from "./bridge";

export const SETUP_SHOWN = "open-quake.setup.shown";
export const SETUP_DEBUG = "open-quake.setup.debug";
export const PERMISSION_GUIDE_SHOWN = "open-quake.permissions.guide-shown";

/** Renderer-origin storage tracks presentation, never completion or permission grants. */
export function createSetupLaunch(
	storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
	development: boolean,
	environmentDebug = false,
) {
	let consumed = false;
	return {
		development,
		debug: () =>
			development && (environmentDebug || storage.getItem(SETUP_DEBUG) === "1"),
		setDebug: (enabled: boolean) => {
			if (development) storage.setItem(SETUP_DEBUG, enabled ? "1" : "0");
		},
		reset: () => {
			if (development) storage.removeItem(SETUP_SHOWN);
		},
		admit: (snapshot: WizardSnapshot, navigated: boolean): boolean => {
			if (consumed || navigated) return false;
			const debug =
				development &&
				(environmentDebug || storage.getItem(SETUP_DEBUG) === "1");
			if (
				!debug &&
				(snapshot.completed || storage.getItem(SETUP_SHOWN) === "1")
			)
				return false;
			// A failed write keeps setup recoverable instead of pretending the flag persisted.
			if (!debug) storage.setItem(SETUP_SHOWN, "1");
			consumed = true;
			return true;
		},
	};
}
