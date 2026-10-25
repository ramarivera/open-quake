import { vi } from "vitest";
import type {
	GeneralSnapshot,
	SettingsUiBridge,
	WizardSnapshot,
} from "./bridge";

/** Shared fakes for settings UI tests. */
export const wizard = (
	patch: Partial<WizardSnapshot> = {},
): WizardSnapshot => ({
	version: 1,
	revision: 1,
	locale: "en",
	step: "welcome",
	localeConfirmed: false,
	region: undefined,
	display: undefined,
	profileIds: [],
	runtime: "unselected",
	completed: false,
	suggestions: undefined,
	hardwareVerified: false,
	...patch,
});
export const general = (
	patch: Partial<GeneralSnapshot> = {},
): GeneralSnapshot => ({
	revision: 1,
	launchAtLogin: false,
	startHidden: false,
	...patch,
});

export function fakeBridge(
	overrides: Partial<SettingsUiBridge> = {},
): SettingsUiBridge {
	return {
		general: vi.fn(async () => general()),
		saveGeneral: vi.fn(async () => general({ revision: 2 })),
		loginStatus: vi.fn(async () => false),
		wizard: vi.fn(async () => wizard()),
		saveWizard: vi.fn(async () => wizard({ revision: 2 })),
		seedRegion: vi.fn(async () => wizard()),
		replayWizard: vi.fn(async () => wizard({ revision: 3 })),
		completeWizard: vi.fn(async () =>
			wizard({ completed: true, step: "complete" }),
		),
		...overrides,
	};
}
