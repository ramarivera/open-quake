import { Effect, Schema } from "effect";
import { AppLocale, type LocaleSnapshot } from "./settings-contracts.js";
import {
	SettingsInvalid,
	type SettingsPersistFailed,
} from "./settings-errors.js";
import { SettingsRepository } from "./settings-repository.js";
export class SettingsService extends Effect.Service<SettingsService>()(
	"SettingsService",
	{
		dependencies: [SettingsRepository.Default],
		effect: Effect.gen(function* () {
			const repo = yield* SettingsRepository;
			return {
				locale: Effect.fn("SettingsService.locale")(
					(): Effect.Effect<LocaleSnapshot> =>
						repo
							.read()
							.pipe(
								Effect.map(({ locale, revision }) => ({ locale, revision })),
							),
				),
				setLocale: Effect.fn("SettingsService.setLocale")(
					(
						input: unknown,
					): Effect.Effect<
						LocaleSnapshot,
						SettingsInvalid | SettingsPersistFailed
					> =>
						Effect.gen(function* () {
							const locale = yield* Schema.decodeUnknown(AppLocale)(input).pipe(
								Effect.mapError((cause) => new SettingsInvalid(cause)),
							);
							const saved = yield* repo.setLocale(locale);
							return { locale: saved.locale, revision: saved.revision };
						}),
				),
			};
		}),
	},
) {}
