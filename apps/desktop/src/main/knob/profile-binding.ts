import { Cause, Effect, type ManagedRuntime, Option, Runtime } from "effect";
import { KnobDispatchFailed } from "../../../../../packages/device/src/knob/knob-errors.js";
import type { ProfileEnvelope } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service.js";
import type { DesktopKnobBindings } from "./desktop-adapters";

/** Promise boundaries may contain Effect's FiberFailure wrapper. Retain the domain leaf. */
export const knobBoundaryFailure = (cause: unknown): KnobDispatchFailed =>
	KnobDispatchFailed.fromCause(
		Runtime.isFiberFailure(cause)
			? Option.getOrElse(
					Cause.failureOption(cause[Runtime.FiberFailureCauseId]),
					() => cause,
				)
			: cause,
	);

/** One profile repository owns writes and publication for knob, panel and preview. */
export function knobProfileBinding(
	runtime: ManagedRuntime.ManagedRuntime<ProfileService, never>,
	select = (profileId: string): Promise<ProfileEnvelope> =>
		runtime.runPromise(
			ProfileService.selectProfile({ deviceId: deviceId(), profileId }),
		),
	deviceId: () => string = () => "desktop-preview",
): NonNullable<DesktopKnobBindings["profiles"]> {
	return {
		read: Effect.tryPromise({
			try: () =>
				runtime.runPromise(
					ProfileService.loadProfiles().pipe(
						Effect.map(({ envelope }) => envelope),
					),
				),
			catch: (cause) => knobBoundaryFailure(cause),
		}),
		select: (profileId) =>
			Effect.tryPromise({
				try: () => select(profileId),
				catch: (cause) => knobBoundaryFailure(cause),
			}),
	};
}
