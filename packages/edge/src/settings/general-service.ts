import { Effect, Schema } from "effect";
import {
	DEFAULT_GENERAL,
	GeneralPatch,
	GeneralPreferences,
	GeneralSnapshot,
	type StartupPlan,
} from "./general-contracts.js";
import { reachableWindow } from "./general-invariants.js";
import type { SettingsDocument } from "./settings-contracts.js";
import {
	type SettingsBackendFailure,
	SettingsInvalid,
	SettingsOsApplyFailed,
} from "./settings-errors.js";
import { SettingsOsPort } from "./settings-ports.js";
import { SettingsRepository } from "./settings-repository.js";

const preferences = (document: SettingsDocument) =>
	Schema.decodeUnknown(GeneralPreferences, { onExcessProperty: "preserve" })(
		document.general ?? DEFAULT_GENERAL,
	).pipe(Effect.mapError((cause) => new SettingsInvalid(cause)));
const view = (
	document: SettingsDocument,
): Effect.Effect<GeneralSnapshot, SettingsInvalid> =>
	preferences(document).pipe(
		Effect.flatMap((general) =>
			Schema.decodeUnknown(GeneralSnapshot)({
				revision: document.revision,
				launchAtLogin: general.launchAtLogin,
				startHidden: general.startHidden,
				...(general.window ? { window: general.window } : {}),
			}).pipe(Effect.mapError((cause) => new SettingsInvalid(cause))),
		),
	);
/** Saved launch preference expresses intent. Only loginStatus confirms actual OS state. */
export class GeneralSettingsService extends Effect.Service<GeneralSettingsService>()(
	"GeneralSettingsService",
	{
		accessors: true,
		dependencies: [SettingsRepository.Default],
		effect: Effect.gen(function* () {
			const repository = yield* SettingsRepository;
			const os = yield* SettingsOsPort;
			const lock = yield* Effect.makeSemaphore(1);
			const bounded = <A>(effect: Effect.Effect<A, SettingsOsApplyFailed>) =>
				effect.pipe(
					Effect.timeoutFail({
						duration: "2 seconds",
						onTimeout: () => new SettingsOsApplyFailed(undefined, "timeout"),
					}),
				);
			return {
				snapshot: Effect.fn("GeneralSettingsService.snapshot")(
					(): Effect.Effect<GeneralSnapshot, SettingsInvalid> =>
						repository.read().pipe(Effect.flatMap(view)),
				),
				loginStatus: Effect.fn("GeneralSettingsService.loginStatus")(
					(): Effect.Effect<boolean, SettingsOsApplyFailed> =>
						bounded(os.login()),
				),
				save: Effect.fn("GeneralSettingsService.save")(
					(
						input: unknown,
					): Effect.Effect<GeneralSnapshot, SettingsBackendFailure> =>
						lock.withPermits(1)(
							Effect.gen(function* () {
								const patch = yield* Schema.decodeUnknown(GeneralPatch, {
									onExcessProperty: "error",
								})(input).pipe(
									Effect.mapError((cause) => new SettingsInvalid(cause)),
								);
								const saved = yield* repository.transact((document) =>
									preferences(document).pipe(
										Effect.map((before) => ({
											...document,
											general: {
												...before,
												...patch,
												...(patch.window
													? { window: { ...before.window, ...patch.window } }
													: {}),
											},
										})),
									),
								);
								// Persist before native application. Failure leaves durable intent, never a confirmed OS claim.
								if (patch.launchAtLogin !== undefined) {
									yield* bounded(os.setLogin(patch.launchAtLogin));
									if ((yield* bounded(os.login())) !== patch.launchAtLogin)
										return yield* new SettingsOsApplyFailed(
											undefined,
											"unverified",
										);
								}
								return yield* view(saved);
							}),
						),
				),
				startup: Effect.fn("GeneralSettingsService.startup")(
					(): Effect.Effect<StartupPlan, SettingsBackendFailure> =>
						Effect.gen(function* () {
							const general = yield* preferences(yield* repository.read());
							// A failed reachability probe safely starts visible. No login-item mutation on launch.
							const reachable = general.startHidden
								? yield* bounded(os.managementReachable()).pipe(
										Effect.catchTag("SettingsOsApplyFailed", () =>
											Effect.succeed(false),
										),
									)
								: false;
							const window = general.window
								? reachableWindow(
										general.window,
										yield* bounded(os.workAreas()),
									)
								: undefined;
							return {
								hidden: general.startHidden && reachable,
								...(window ? { window } : {}),
							};
						}),
				),
			};
		}),
	},
) {}
