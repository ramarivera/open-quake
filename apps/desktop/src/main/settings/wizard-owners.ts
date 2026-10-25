import { Effect } from "effect";
import type { ProfileEnvelope } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { visibleProfiles } from "../../../../../packages/device/src/profiles/profile-manager-invariants.js";
import { WizardIncomplete } from "../../../../../packages/edge/src/settings/settings-errors";
import type { WizardOwners } from "../../../../../packages/edge/src/settings/settings-ports";

/** These probes read canonical owners. They never install, connect or create. */
export function createWizardOwners(options: {
	readonly deviceId: () => string | undefined | Promise<string | undefined>;
	readonly profiles: () => Promise<ProfileEnvelope>;
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
			display._tag === "desktop-preview"
				? Effect.succeed(true)
				: read(async () => options.deviceId()).pipe(
						Effect.map((deviceId) => display.deviceId === deviceId),
					),
		),
		usableProfiles: Effect.fn("DesktopWizard.usableProfiles")((ids) =>
			read(options.profiles).pipe(
				Effect.map(
					(profiles) =>
						ids.length > 0 &&
						ids.every((id) =>
							visibleProfiles(profiles).some((profile) => profile.id === id),
						),
				),
			),
		),
		runtimeSupported: Effect.sync(options.runtimeSupported),
		runtimeConfigured: read(options.runtimeConfigured),
		// Region remains advisory. No automatic provider or credential selection.
		regionSuggestions: () => Effect.succeed({}),
	};
}
