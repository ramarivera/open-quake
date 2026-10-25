import { Context, Effect, Option, Schema } from "effect";
import { type AppLocale, SettingsDocument } from "./settings-contracts.js";
import {
	SettingsInvalid,
	type SettingsPersistFailed,
	type SettingsReadFailed,
} from "./settings-errors.js";
import { resolveAppLocale } from "./settings-invariants.js";
export class SettingsStorage extends Context.Tag("SettingsStorage")<
	SettingsStorage,
	{
		readonly read: Effect.Effect<Option.Option<unknown>, SettingsReadFailed>;
		readonly write: (
			document: SettingsDocument,
		) => Effect.Effect<void, SettingsPersistFailed>;
		readonly osLocale: string;
	}
>() {}

export class SettingsRepository extends Effect.Service<SettingsRepository>()(
	"SettingsRepository",
	{
		effect: Effect.gen(function* () {
			const storage = yield* SettingsStorage;
			const raw = yield* storage.read;
			let state = yield* Schema.decodeUnknown(SettingsDocument)(
				Option.isSome(raw)
					? raw.value
					: {
							version: 1,
							locale: resolveAppLocale(storage.osLocale),
							revision: 0,
						},
			).pipe(Effect.mapError((cause) => new SettingsInvalid(cause)));
			if (Option.isNone(raw)) yield* storage.write(state);
			const lock = yield* Effect.makeSemaphore(1);
			return {
				read: Effect.fn("SettingsRepository.read")(
					(): Effect.Effect<SettingsDocument> =>
						lock.withPermits(1)(Effect.sync(() => ({ ...state }))),
				),
				setLocale: Effect.fn("SettingsRepository.setLocale")(
					(
						locale: AppLocale,
					): Effect.Effect<SettingsDocument, SettingsPersistFailed> =>
						lock.withPermits(1)(
							Effect.gen(function* () {
								if (state.locale === locale) return { ...state };
								const next = { ...state, locale, revision: state.revision + 1 };
								yield* storage.write(next);
								state = next;
								return { ...state };
							}),
						),
				),
			};
		}),
	},
) {}
