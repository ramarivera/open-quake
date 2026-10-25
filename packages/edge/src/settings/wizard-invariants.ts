import type { WizardProgress } from "./wizard-contracts.js";
/** Local prerequisites only. Device/profile/runtime validity comes from their owners. */
export const wizardHasChoices = (progress: WizardProgress): boolean =>
	progress.localeConfirmed &&
	progress.region !== undefined &&
	progress.display !== undefined &&
	progress.profileIds.length > 0;
export const uniqueProfileIds = (ids: readonly string[]): readonly string[] => [
	...new Set(ids),
];

/** A completion marker cannot be imported without its required local choices. */
export const wizardProgressConsistent = (progress: WizardProgress): boolean =>
	progress.completed
		? progress.step === "complete" && wizardHasChoices(progress)
		: progress.step !== "complete";
