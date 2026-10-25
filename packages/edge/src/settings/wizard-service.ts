import { Effect, Schema } from "effect";
import type { SettingsDocument } from "./settings-contracts.js";
import {
	type SettingsBackendFailure,
	SettingsInvalid,
	WizardIncomplete,
} from "./settings-errors.js";
import { WizardOwners } from "./settings-ports.js";
import { SettingsRepository } from "./settings-repository.js";
import {
	INITIAL_WIZARD,
	Region,
	WizardDraft,
	WizardProgress,
	WizardSnapshot,
} from "./wizard-contracts.js";
import { uniqueProfileIds, wizardHasChoices } from "./wizard-invariants.js";

const progress = (document: SettingsDocument) =>
	Schema.decodeUnknown(WizardProgress, { onExcessProperty: "preserve" })(
		document.wizard ?? INITIAL_WIZARD,
	).pipe(Effect.mapError((cause) => new SettingsInvalid(cause)));
const view = (
	document: SettingsDocument,
): Effect.Effect<WizardSnapshot, SettingsInvalid> =>
	progress(document).pipe(
		Effect.flatMap((wizard) =>
			Schema.decodeUnknown(WizardSnapshot)({
				...wizard,
				revision: document.revision,
				locale: document.locale,
				hardwareVerified: false,
			}).pipe(Effect.mapError((cause) => new SettingsInvalid(cause))),
		),
	);
export class WizardService extends Effect.Service<WizardService>()(
	"WizardService",
	{
		accessors: true,
		dependencies: [SettingsRepository.Default],
		effect: Effect.gen(function* () {
			const repository = yield* SettingsRepository;
			const owners = yield* WizardOwners;
			const bounded = <A>(effect: Effect.Effect<A, WizardIncomplete>) =>
				effect.pipe(
					Effect.timeoutFail({
						duration: "2 seconds",
						onTimeout: () => new WizardIncomplete(),
					}),
				);
			return {
				snapshot: Effect.fn("WizardService.snapshot")(
					(): Effect.Effect<WizardSnapshot, SettingsInvalid> =>
						repository.read().pipe(Effect.flatMap(view)),
				),
				save: Effect.fn("WizardService.save")(
					(
						input: unknown,
					): Effect.Effect<WizardSnapshot, SettingsBackendFailure> =>
						Effect.gen(function* () {
							const draft = yield* Schema.decodeUnknown(WizardDraft, {
								onExcessProperty: "error",
							})(input).pipe(
								Effect.mapError((cause) => new SettingsInvalid(cause)),
							);
							const saved = yield* repository.transact((document) =>
								Effect.gen(function* () {
									const before = yield* progress(document);
									// Completed records can only be changed through explicit replay.
									if (before.completed) return yield* new WizardIncomplete();
									const { locale, ...choices } = draft;
									const suggestions =
										draft.region !== undefined && before.region === undefined
											? yield* bounded(owners.regionSuggestions(draft.region))
											: before.suggestions;
									const next: WizardProgress = {
										...before,
										...choices,
										...(suggestions ? { suggestions } : {}),
										runtime: draft.runtime ?? before.runtime,
										localeConfirmed:
											locale !== undefined || before.localeConfirmed,
										profileIds: uniqueProfileIds(
											draft.profileIds ?? before.profileIds,
										),
									};
									if (
										draft.runtime !== undefined &&
										!(yield* bounded(owners.runtimeSupported))
									)
										return yield* new WizardIncomplete();
									return {
										...document,
										...(locale ? { locale } : {}),
										wizard: next,
									};
								}),
							);
							return yield* view(saved);
						}),
				),
				seedRegion: Effect.fn("WizardService.seedRegion")(
					(
						input: unknown,
					): Effect.Effect<WizardSnapshot, SettingsBackendFailure> =>
						Effect.gen(function* () {
							const region = yield* Schema.decodeUnknown(Region)(input).pipe(
								Effect.mapError((cause) => new SettingsInvalid(cause)),
							);
							const saved = yield* repository.transact((document) =>
								Effect.gen(function* () {
									const before = yield* progress(document);
									// Suggestions are initialized once. Explicit locale/provider/speech configuration is untouched.
									if (before.region !== undefined || before.completed)
										return document;
									const suggestions = yield* bounded(
										owners.regionSuggestions(region),
									);
									return {
										...document,
										wizard: { ...before, region, suggestions },
									};
								}),
							);
							return yield* view(saved);
						}),
				),
				replay: Effect.fn("WizardService.replay")(
					(): Effect.Effect<WizardSnapshot, SettingsBackendFailure> =>
						repository
							.transact((document) =>
								progress(document).pipe(
									Effect.map((before) => ({
										...document,
										wizard: { ...before, completed: false, step: "welcome" },
									})),
								),
							)
							.pipe(Effect.flatMap(view)),
				),
				complete: Effect.fn("WizardService.complete")(
					(): Effect.Effect<WizardSnapshot, SettingsBackendFailure> =>
						repository
							.transact((document) =>
								Effect.gen(function* () {
									const before = yield* progress(document);
									if (before.completed) return document;
									if (!wizardHasChoices(before) || !before.display)
										return yield* new WizardIncomplete();
									if (
										before.display._tag !== "desktop-preview" &&
										!(yield* bounded(owners.displayAvailable(before.display)))
									)
										return yield* new WizardIncomplete();
									if (
										!(yield* bounded(owners.usableProfiles(before.profileIds)))
									)
										return yield* new WizardIncomplete();
									if (yield* bounded(owners.runtimeSupported)) {
										if (before.runtime === "unselected")
											return yield* new WizardIncomplete();
										if (
											before.runtime === "configured" &&
											!(yield* bounded(owners.runtimeConfigured))
										)
											return yield* new WizardIncomplete();
									}
									return {
										...document,
										wizard: { ...before, completed: true, step: "complete" },
									};
								}),
							)
							.pipe(Effect.flatMap(view)),
				),
			};
		}),
	},
) {}
