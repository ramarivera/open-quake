import { Context, Effect, Layer, Option } from "effect";
import type { HardwarePreferences } from "./hardware-contracts.js";
import type { HardwarePreferencesFailed } from "./hardware-errors.js";

/** Serial-scoped storage port. Desktop owns disk IO, never a HID path key. */
export class HardwarePreferencesStore extends Context.Tag(
	"@open-quake/device/HardwarePreferencesStore",
)<
	HardwarePreferencesStore,
	{
		readonly read: (
			serial: string,
		) => Effect.Effect<
			Option.Option<HardwarePreferences>,
			HardwarePreferencesFailed
		>;
		readonly write: (
			serial: string,
			preferences: HardwarePreferences,
		) => Effect.Effect<void, HardwarePreferencesFailed>;
	}
>() {}
export const MemoryHardwarePreferences = Layer.sync(
	HardwarePreferencesStore,
	() => {
		const values = new Map<string, HardwarePreferences>();
		return {
			read: (serial) =>
				Effect.sync(() => Option.fromNullable(values.get(serial))),
			write: (serial, preferences) =>
				Effect.sync(() => {
					values.set(serial, preferences);
				}),
		};
	},
);
