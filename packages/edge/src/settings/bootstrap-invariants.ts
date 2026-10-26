import { Schema } from "effect";
import type { SettingsDocument } from "./settings-contracts.js";

const RecordValue = Schema.Record({
	key: Schema.String,
	value: Schema.Unknown,
});
const record = (value: unknown): Record<string, unknown> =>
	Schema.is(RecordValue)(value) ? { ...value } : {};
/** Additive v1 bootstrap. Durable extensions survive; only the recovered transient keys go. */
export function bootstrapSettings(
	document: SettingsDocument,
): SettingsDocument {
	if (document.bootstrapVersion === 1) return document;
	const next = { ...document };
	delete next.currentSelectedDevice;
	for (const [field, keys] of [
		["mainscreen", ["deviceName"]],
		[
			"serverPorts",
			["pluginWSServerPort", "viaPluginPort", "pluginWebPageServerPort"],
		],
		["system", ["upgradeInfo"]],
	] as const) {
		if (!Schema.is(RecordValue)(next[field])) continue;
		const value = record(next[field]);
		for (const key of keys) delete value[key];
		next[field] = value;
	}
	const system = record(next.system);
	const ai = record(next.aiConfig);
	const general = record(next.general);
	if (!("globalAIWakeKey" in ai))
		ai.globalAIWakeKey = "CommandOrControl+Shift+D";
	// Only an explicitly seeded legacy default is eligible. Unmarked choices are preserved.
	const location = record(system.deviceLocationInfo);
	const wizard = record(next.wizard);
	const country =
		wizard.region ?? location.country_code ?? location.countryCode;
	if (
		country === "CN" &&
		ai.aiEngineProvider === "QWen" &&
		ai.aiEngineProviderSeededFromGeo === true &&
		ai.aiEngineProviderUserChosen !== true
	) {
		ai.aiEngineProvider = "DeepSeek";
	}
	if (!("aiConfig" in next) || Schema.is(RecordValue)(next.aiConfig))
		next.aiConfig = ai;
	next.general = {
		version: 1,
		launchAtLogin: false,
		startHidden:
			typeof system.openAsHidden === "boolean" ? system.openAsHidden : false,
		...general,
	};
	next.bootstrapVersion = 1;
	return next;
}
