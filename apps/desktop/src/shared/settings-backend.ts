import type {
	GeneralPatch,
	GeneralSnapshot,
} from "../../../../packages/edge/src/settings/general-contracts";
import type {
	WizardDraft,
	WizardSnapshot,
} from "../../../../packages/edge/src/settings/wizard-contracts";

export const SETTINGS_BACKEND_REQUEST = "settings:backend:rpc";
export interface SettingsBackendBridge {
	readonly general: () => Promise<GeneralSnapshot>;
	readonly saveGeneral: (preferences: GeneralPatch) => Promise<GeneralSnapshot>;
	readonly loginStatus: () => Promise<boolean>;
	readonly wizard: () => Promise<WizardSnapshot>;
	readonly saveWizard: (draft: WizardDraft) => Promise<WizardSnapshot>;
	readonly seedRegion: (region: string) => Promise<WizardSnapshot>;
	readonly replayWizard: () => Promise<WizardSnapshot>;
	readonly completeWizard: () => Promise<WizardSnapshot>;
	readonly dispose: () => Promise<void>;
}
declare global {
	interface Window {
		readonly quakeSettings?: SettingsBackendBridge;
	}
}
