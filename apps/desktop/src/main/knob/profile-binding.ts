import { Effect, type ManagedRuntime } from "effect";
import { KnobDispatchFailed } from "../../../../../packages/device/src/knob/knob-errors.js";
import type { ProfileEnvelope } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service.js";
import type { DesktopKnobBindings } from "./desktop-adapters";

/** One profile repository owns writes and publication for knob, panel and preview. */
export function knobProfileBinding(
	runtime: ManagedRuntime.ManagedRuntime<ProfileService, never>,
	select = (profileId: string): Promise<ProfileEnvelope> =>
		runtime.runPromise(
			ProfileService.selectProfile({ deviceId: "desktop-preview", profileId }),
		),
): NonNullable<DesktopKnobBindings["profiles"]> {
	return {
		read: Effect.tryPromise({
			try: () =>
				runtime.runPromise(
					ProfileService.loadProfiles().pipe(
						Effect.map(({ envelope }) => envelope),
					),
				),
			catch: (cause) => KnobDispatchFailed.fromCause(cause),
		}),
		select: (profileId) =>
			Effect.tryPromise({
				try: () => select(profileId),
				catch: (cause) => KnobDispatchFailed.fromCause(cause),
			}),
	};
}
