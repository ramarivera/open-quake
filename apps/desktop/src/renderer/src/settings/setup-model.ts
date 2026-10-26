import type { WizardDisplay } from "../../../../../../packages/edge/src/settings/wizard-contracts";
import type { AppLocale } from "../../../shared/locale";
import type { WizardDraft, WizardSnapshot } from "./bridge";
import { isRegion } from "./regions";
import type {
	DisplayChoices,
	ProfileChoices,
	RuntimeChoice,
} from "./setup-owners";

export type SetupStep =
	| "welcome"
	| "locale-region"
	| "display"
	| "profiles"
	| "runtime"
	| "review";

/** The runtime step exists only while the root supports the optional runtime. */
export function setupSteps(runtime: RuntimeChoice): ReadonlyArray<SetupStep> {
	return runtime.state !== "unsupported"
		? ["welcome", "locale-region", "display", "profiles", "runtime", "review"]
		: ["welcome", "locale-region", "display", "profiles", "review"];
}

/** Where a saved record resumes. Completed records show the review summary. */
export function resumeStep(
	snapshot: WizardSnapshot,
	steps: ReadonlyArray<SetupStep>,
): SetupStep {
	if (snapshot.completed || snapshot.step === "complete") return "review";
	if (snapshot.step === "runtime")
		return steps.includes("runtime") && snapshot.runtime === "unselected"
			? "runtime"
			: "review";
	return snapshot.step;
}

/**
 * The language setup shows and saves. The app-wide locale is canonical and can
 * change in General while setup is open; the wizard record's copy is used only
 * until that locale has been read.
 */
export function liveLocale(
	app: {
		readonly locale: AppLocale;
		readonly loading: boolean;
		readonly error: string;
	},
	saved: AppLocale,
): AppLocale {
	return app.loading ||
		[
			"QUAKE.SETTINGS.READ_FAILED",
			"QUAKE.SETTINGS.INVALID",
			"QUAKE.SETTINGS.UNAVAILABLE",
		].includes(app.error)
		? saved
		: app.locale;
}

export type SetupChoices = {
	readonly region: string;
	readonly display: WizardDisplay | null;
	readonly profileIds: ReadonlyArray<string>;
	readonly runtime: "skipped" | "configured" | null;
};

/** Initial form state: saved choices win, then non-persisted suggestions. */
export function initialChoices(
	snapshot: WizardSnapshot,
	osRegion: string | null,
): SetupChoices {
	return {
		region: snapshot.region ?? osRegion ?? "",
		display: snapshot.display ?? null,
		profileIds: snapshot.profileIds,
		runtime: snapshot.runtime === "unselected" ? null : snapshot.runtime,
	};
}

/** Saved profile IDs that still exist, else the profile active for the display. */
export function profileDefaults(
	saved: ReadonlyArray<string>,
	choices: ProfileChoices,
	display: WizardDisplay | null,
): ReadonlyArray<string> {
	if (choices.state !== "ready") return saved;
	const known = new Set(choices.profiles.map((profile) => profile.id));
	const kept = saved.filter((id) => known.has(id));
	if (kept.length > 0) return kept;
	const key = display?._tag === "quake" ? display.deviceId : "desktop-preview";
	const active = choices.active[key] ?? choices.active["desktop-preview"];
	return active && known.has(active) ? [active] : [];
}

export function displayUsable(
	display: WizardDisplay | null,
	devices: DisplayChoices,
): boolean {
	if (!display) return false;
	if (display._tag === "desktop-preview") return true;
	return devices.state === "connected" && devices.serial === display.deviceId;
}

export function canContinue(
	step: SetupStep,
	choices: SetupChoices,
	devices: DisplayChoices,
	profiles: ProfileChoices,
	runtime: RuntimeChoice,
): boolean {
	switch (step) {
		case "welcome":
		case "review":
			return true;
		case "locale-region":
			return isRegion(choices.region);
		case "display":
			return displayUsable(choices.display, devices);
		case "profiles":
			return (
				profiles.state === "ready" &&
				choices.profileIds.length > 0 &&
				choices.profileIds.every((id) =>
					profiles.profiles.some((profile) => profile.id === id),
				)
			);
		case "runtime":
			return (
				choices.runtime === "skipped" ||
				(choices.runtime === "configured" && runtime.state === "configured")
			);
	}
}

/** The explicit write each Continue performs. Review completes instead. */
export function continueDraft(
	step: Exclude<SetupStep, "review">,
	choices: SetupChoices,
	locale: AppLocale,
): WizardDraft {
	switch (step) {
		case "welcome":
			return { step: "locale-region" };
		case "locale-region":
			return { step: "display", locale, region: choices.region };
		case "display":
			return choices.display
				? { step: "profiles", display: choices.display }
				: { step: "display" };
		case "profiles":
			return { step: "runtime", profileIds: [...choices.profileIds] };
		case "runtime":
			return choices.runtime
				? { step: "runtime", runtime: choices.runtime }
				: { step: "runtime" };
	}
}

export function nextStep(
	steps: ReadonlyArray<SetupStep>,
	step: SetupStep,
): SetupStep {
	return steps[Math.min(steps.indexOf(step) + 1, steps.length - 1)] ?? "review";
}

export function previousStep(
	steps: ReadonlyArray<SetupStep>,
	step: SetupStep,
): SetupStep {
	return steps[Math.max(steps.indexOf(step) - 1, 0)] ?? "welcome";
}
