import { Effect } from "effect";
import { WizardIncomplete } from "../../../../../packages/edge/src/settings/settings-errors";
import type { WizardOwners } from "../../../../../packages/edge/src/settings/settings-ports";

/** These probes read canonical owners. They never install, connect or create. */
export function createWizardOwners(options: {
	readonly deviceId: () => string | undefined;
	readonly profiles: () => Promise<readonly { readonly id: string }[]>;
	readonly runtimeSupported: () => boolean;
	readonly runtimeConfigured: () => Promise<boolean>;
}): typeof WizardOwners.Service {
	const read = <A>(f: () => Promise<A>) =>
		Effect.tryPromise({
			try: f,
			catch: (cause) => new WizardIncomplete(cause),
		});
	return {
		displayAvailable: Effect.fn("DesktopWizard.displayAvailable")((display) =>
			Effect.sync(
				() =>
					display._tag === "desktop-preview" ||
					display.deviceId === options.deviceId(),
			),
		),
		usableProfiles: Effect.fn("DesktopWizard.usableProfiles")((ids) =>
			read(options.profiles).pipe(
				Effect.map(
					(profiles) =>
						ids.length > 0 &&
						ids.every((id) => profiles.some((profile) => profile.id === id)),
				),
			),
		),
		runtimeSupported: Effect.sync(options.runtimeSupported),
		runtimeConfigured: read(options.runtimeConfigured),
		// Region remains advisory. No automatic provider or credential selection.
		regionSuggestions: () => Effect.succeed({}),
	};
}
