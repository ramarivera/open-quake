import { Context, Effect, Option, Schema } from "effect";
import { GeneralPreferences } from "./general-contracts.js";
import { type AppLocale, SettingsDocument } from "./settings-contracts.js";
import {
	type SettingsBackendFailure,
	type SettingsFailure,
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
			const lock = yield* Effect.makeSemaphore(1);
			let state: SettingsDocument | undefined;
			const initialize = Effect.gen(function* () {
				if (state) return state;
				const raw = yield* storage.read;
				const loaded = yield* Schema.decodeUnknown(SettingsDocument)(
					Option.isSome(raw)
						? raw.value
						: {
								version: 1,
								locale: resolveAppLocale(storage.osLocale),
								revision: 0,
							},
				).pipe(Effect.mapError((cause) => new SettingsInvalid(cause)));
				yield* Schema.decodeUnknown(BackendFields)(loaded).pipe(
					Effect.mapError((cause) => new SettingsInvalid(cause)),
				);
				if (Option.isNone(raw))
					yield* Effect.uninterruptible(storage.write(loaded));
				state = loaded;
				return loaded;
			});
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
									const current = yield* initialize;
									const before = structuredClone(current);
									const next = yield* restore(f(before));
									if (next === before) return structuredClone(current);
									const committed = yield* Schema.decodeUnknown(
										SettingsDocument,
									)({
										...next,
										version: 1,
										revision: current.revision + 1,
									}).pipe(
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
					(): Effect.Effect<SettingsDocument, SettingsFailure> =>
						lock.withPermits(1)(
							initialize.pipe(
								Effect.map((current) => structuredClone(current)),
							),
						),
				),
				setLocale: Effect.fn("SettingsRepository.setLocale")(
					(
						locale: AppLocale,
					): Effect.Effect<SettingsDocument, SettingsFailure> =>
						lock.withPermits(1)(
							Effect.uninterruptible(
								Effect.gen(function* () {
									const current = yield* initialize;
									if (current.locale === locale)
										return structuredClone(current);
									const next = {
										...current,
										locale,
										revision: current.revision + 1,
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
