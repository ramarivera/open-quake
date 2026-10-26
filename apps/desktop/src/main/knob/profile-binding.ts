import { Cause, Effect, Option, Runtime } from "effect";
import {
	KnobDispatchFailed,
	KnobSessionStale,
} from "../../../../../packages/device/src/knob/knob-errors.js";
import type { ProfileEnvelope } from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileService } from "../../../../../packages/device/src/profiles/profile-service.js";
import type { DesktopRuntime } from "../diagnostics/module";
import type { ProfileSelectionScope } from "../profiles/profile-controller";
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
	runtime: DesktopRuntime<ProfileService, never>,
	select = (
		profileId: string,
		scope?: ProfileSelectionScope,
	): Promise<ProfileEnvelope> =>
		runtime.runPromise(
			ProfileService.selectProfile(
				{ deviceId: scope?.deviceId ?? deviceId(), profileId },
				scope
					? () => {
							if (!scope.isCurrent()) throw KnobSessionStale.fromCause();
						}
					: undefined,
			),
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
		select: (profileId, scope) =>
			Effect.tryPromise({
				try: () => select(profileId, scope),
				catch: (cause) =>
					scope && !scope.isCurrent()
						? KnobSessionStale.fromCause()
						: knobBoundaryFailure(cause),
			}),
	};
}
