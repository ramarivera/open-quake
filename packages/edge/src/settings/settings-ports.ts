import { Context, type Effect } from "effect";
import type { WindowRectangle } from "./general-contracts.js";
import type {
	SettingsOsApplyFailed,
	WizardIncomplete,
} from "./settings-errors.js";
import type { WizardDisplay } from "./wizard-contracts.js";

/** Host effects must be interruptible and bounded. No native operations run on layer construction. */
export class SettingsOsPort extends Context.Tag("SettingsOsPort")<
	SettingsOsPort,
	{
		readonly login: () => Effect.Effect<boolean, SettingsOsApplyFailed>;
		readonly setLogin: (
			enabled: boolean,
		) => Effect.Effect<void, SettingsOsApplyFailed>;
		readonly workAreas: () => Effect.Effect<
			readonly WindowRectangle[],
			SettingsOsApplyFailed
		>;
		readonly managementReachable: () => Effect.Effect<
			boolean,
			SettingsOsApplyFailed
		>;
	}
>() {}
/** Read/validate only. Profile creation and runtime installation stay with their canonical owners. */
export class WizardOwners extends Context.Tag("WizardOwners")<
	WizardOwners,
	{
		readonly displayAvailable: (
			display: WizardDisplay,
		) => Effect.Effect<boolean, WizardIncomplete>;
		readonly usableProfiles: (
			ids: readonly string[],
		) => Effect.Effect<boolean, WizardIncomplete>;
		readonly runtimeSupported: Effect.Effect<boolean, WizardIncomplete>;
		readonly runtimeConfigured: Effect.Effect<boolean, WizardIncomplete>;
		readonly regionSuggestions: (
			region: string,
		) => Effect.Effect<
			{ readonly provider?: string; readonly speech?: string },
			WizardIncomplete
		>;
	}
>() {}
