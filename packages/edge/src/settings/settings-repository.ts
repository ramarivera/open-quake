import { Context, Effect, Option, Schema } from "effect";
import { GeneralPreferences } from "./general-contracts.js";
import { type AppLocale, SettingsDocument } from "./settings-contracts.js";
import {
	type SettingsBackendFailure,
	SettingsInvalid,
	type SettingsPersistFailed,
	type SettingsReadFailed,
} from "./settings-errors.js";
import { resolveAppLocale } from "./settings-invariants.js";
import { WizardProgress } from "./wizard-contracts.js";
import { wizardProgressConsistent } from "./wizard-invariants.js";
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

const BackendFields = Schema.Struct({
	general: Schema.optional(GeneralPreferences),
	wizard: Schema.optional(
		WizardProgress.pipe(Schema.filter(wizardProgressConsistent)),
	),
});
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
			yield* Schema.decodeUnknown(BackendFields)(state).pipe(
				Effect.mapError((cause) => new SettingsInvalid(cause)),
			);
			if (Option.isNone(raw))
				yield* Effect.uninterruptible(storage.write(state));
			const lock = yield* Effect.makeSemaphore(1);
			return {
				/** One lock and commit point shared by locale, general preferences and onboarding. */
				transact: Effect.fn("SettingsRepository.transact")(
					(
						f: (
							document: SettingsDocument,
						) => Effect.Effect<SettingsDocument, SettingsBackendFailure>,
					): Effect.Effect<SettingsDocument, SettingsBackendFailure> =>
						lock.withPermits(1)(
							Effect.uninterruptibleMask((restore) =>
								Effect.gen(function* () {
									const before = structuredClone(state);
									const next = yield* restore(f(before));
									if (next === before) return structuredClone(state);
									const committed = yield* Schema.decodeUnknown(
										SettingsDocument,
									)({ ...next, version: 1, revision: state.revision + 1 }).pipe(
										Effect.mapError((cause) => new SettingsInvalid(cause)),
									);
									yield* Schema.decodeUnknown(BackendFields)(committed).pipe(
										Effect.mapError((cause) => new SettingsInvalid(cause)),
									);
									yield* storage.write(committed);
									state = structuredClone(committed);
									return structuredClone(state);
								}),
							),
						),
				),
				read: Effect.fn("SettingsRepository.read")(
					(): Effect.Effect<SettingsDocument> =>
						lock.withPermits(1)(Effect.sync(() => structuredClone(state))),
				),
				setLocale: Effect.fn("SettingsRepository.setLocale")(
					(
						locale: AppLocale,
					): Effect.Effect<SettingsDocument, SettingsPersistFailed> =>
						lock.withPermits(1)(
							Effect.uninterruptible(
								Effect.gen(function* () {
									if (state.locale === locale) return structuredClone(state);
									const next = {
										...state,
										locale,
										revision: state.revision + 1,
									};
									yield* storage.write(next);
									state = next;
									return structuredClone(state);
								}),
							),
						),
				),
			};
		}),
	},
) {}
