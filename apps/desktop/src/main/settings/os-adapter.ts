import { Effect, Schema } from "effect";
import { WindowRectangle } from "../../../../../packages/edge/src/settings/general-contracts";
import { SettingsOsApplyFailed } from "../../../../../packages/edge/src/settings/settings-errors";
import type { SettingsOsPort } from "../../../../../packages/edge/src/settings/settings-ports";

/** Electron app/screen and the root-owned management action are injected, never imported or activated. */
export interface SettingsNativeApi {
	readonly loginSupported: boolean;
	readonly getLoginItemSettings: (
		signal: AbortSignal,
	) => Promise<{ readonly openAtLogin: boolean }>;
	readonly setLoginItemSettings: (
		settings: { readonly openAtLogin: boolean },
		signal: AbortSignal,
	) => Promise<void>;
	readonly workAreas: (signal: AbortSignal) => Promise<unknown>;
	/** True only while a tray/menu/application action can reopen management. */
	readonly managementReachable: (signal: AbortSignal) => Promise<boolean>;
}
export function createSettingsOsAdapter(
	api: SettingsNativeApi,
): typeof SettingsOsPort.Service {
	const call = <A>(
		operation: (signal: AbortSignal) => Promise<A>,
	): Effect.Effect<A, SettingsOsApplyFailed> =>
		Effect.tryPromise({
			try: operation,
			catch: (cause) =>
				new SettingsOsApplyFailed(
					cause,
					typeof cause === "object" &&
						cause !== null &&
						"code" in cause &&
						(cause.code === "EACCES" || cause.code === "EPERM")
						? "denied"
						: "unavailable",
				),
		}).pipe(
			Effect.timeoutFail({
				duration: "2 seconds",
				onTimeout: () => new SettingsOsApplyFailed(undefined, "timeout"),
			}),
		);
	return {
		login: Effect.fn("DesktopSettings.login")(() =>
			api.loginSupported
				? call((signal) => api.getLoginItemSettings(signal)).pipe(
						Effect.flatMap((result) =>
							Schema.decodeUnknown(Schema.Boolean)(result.openAtLogin).pipe(
								Effect.mapError((cause) => new SettingsOsApplyFailed(cause)),
							),
						),
					)
				: Effect.fail(new SettingsOsApplyFailed(undefined, "unsupported")),
		),
		setLogin: Effect.fn("DesktopSettings.setLogin")((enabled: boolean) =>
			api.loginSupported
				? call((signal) =>
						api.setLoginItemSettings({ openAtLogin: enabled }, signal),
					)
				: Effect.fail(new SettingsOsApplyFailed(undefined, "unsupported")),
		),
		workAreas: Effect.fn("DesktopSettings.workAreas")(() =>
			call(api.workAreas).pipe(
				Effect.flatMap((areas) =>
					Schema.decodeUnknown(
						Schema.Array(WindowRectangle).pipe(Schema.maxItems(64)),
					)(areas).pipe(
						Effect.mapError((cause) => new SettingsOsApplyFailed(cause)),
					),
				),
			),
		),
		managementReachable: Effect.fn("DesktopSettings.managementReachable")(() =>
			call(api.managementReachable).pipe(
				Effect.flatMap((result) =>
					Schema.decodeUnknown(Schema.Boolean)(result).pipe(
						Effect.mapError((cause) => new SettingsOsApplyFailed(cause)),
					),
				),
			),
		),
	};
}
