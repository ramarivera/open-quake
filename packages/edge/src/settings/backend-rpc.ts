import { Rpc, RpcGroup } from "@effect/rpc";
import { Schema } from "effect";
import { GeneralPatch, GeneralSnapshot } from "./general-contracts.js";
import { SettingsBackendFailure } from "./settings-errors.js";
import { Region, WizardDraft, WizardSnapshot } from "./wizard-contracts.js";
/** Composed by the host alongside the existing locale group. No transport or native side effects. */
export const SettingsBackendRpcs = RpcGroup.make(
	Rpc.make("settings.general", {
		success: GeneralSnapshot,
		error: SettingsBackendFailure,
	}),
	Rpc.make("settings.saveGeneral", {
		payload: { preferences: GeneralPatch },
		success: GeneralSnapshot,
		error: SettingsBackendFailure,
	}),
	Rpc.make("settings.loginStatus", {
		success: Schema.Boolean,
		error: SettingsBackendFailure,
	}),
	Rpc.make("wizard.snapshot", {
		success: WizardSnapshot,
		error: SettingsBackendFailure,
	}),
	Rpc.make("wizard.save", {
		payload: { draft: WizardDraft },
		success: WizardSnapshot,
		error: SettingsBackendFailure,
	}),
	Rpc.make("wizard.seedRegion", {
		payload: { region: Region },
		success: WizardSnapshot,
		error: SettingsBackendFailure,
	}),
	Rpc.make("wizard.replay", {
		success: WizardSnapshot,
		error: SettingsBackendFailure,
	}),
	Rpc.make("wizard.complete", {
		success: WizardSnapshot,
		error: SettingsBackendFailure,
	}),
);
