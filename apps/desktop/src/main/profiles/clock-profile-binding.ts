import { Effect, Array as EffectArray, Layer, Schema } from "effect";
import {
	ProfileAction,
	type ProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import { ProfileRepository } from "../../../../../packages/device/src/profiles/profile-repository.js";
import type { ClockTarget } from "../../shared/clock-contracts";
import { ClockPersistenceFailed } from "../../shared/clock-errors";
import { ClockProfiles } from "../clock/clock-profiles";
import type { ClockRecord } from "../clock/clock-store";
import type { DesktopRuntime } from "../diagnostics/module";

function resolve(envelope: ProfileEnvelope, target?: ClockTarget) {
	const selection = envelope.activeByDevice["desktop-preview"];
	const hasClock = (p: ProfileEnvelope["profiles"][number]) =>
		p.pages.some((page) =>
			page.keys.some((k) => k.config.type === "dkDesktopClock"),
		);
	const profile = target
		? envelope.profiles.find((p) => p.id === target.profileId)
		: (envelope.profiles.find(
				(p) => p.id === selection?.profileId && hasClock(p),
			) ?? envelope.profiles.find(hasClock));
	const page = target
		? profile?.pages.find((p) => p.id === target.pageId)
		: (profile?.pages.find(
				(p) =>
					p.id === selection?.pageId &&
					p.keys.some((k) => k.config.type === "dkDesktopClock"),
			) ??
			profile?.pages.find((p) =>
				p.keys.some((k) => k.config.type === "dkDesktopClock"),
			));
	const key = page?.keys.find(
		(k) =>
			k.config.type === "dkDesktopClock" &&
			(!target || k.keyCode === target.keyCode),
	);
	return profile && page && key
		? {
				profile,
				page,
				key,
				target: {
					profileId: profile.id,
					pageId: page.id,
					keyCode: key.keyCode,
				},
			}
		: undefined;
}

export const clockProfileLayer = (runtime: DesktopRuntime<ProfileRepository>) =>
	Layer.succeed(ClockProfiles, {
		read: Effect.fn("ClockProfiles.read")((target?: ClockTarget) =>
			Effect.tryPromise({
				try: () => runtime.runPromise(ProfileRepository.load()),
				catch: ClockPersistenceFailed.fromCause,
			}).pipe(
				Effect.flatMap(({ envelope }) => {
					const selected = resolve(envelope, target);
					if (!selected)
						return Effect.fail(ClockPersistenceFailed.fromCause(undefined));
					return Effect.succeed({
						version: 1,
						revision: selected.profile.revision,
						target: selected.target,
						keys: [
							{
								keyCode: selected.key.keyCode,
								config: {
									type: "dkDesktopClock",
									actions: selected.key.config.actions,
								},
							},
						],
					} satisfies ClockRecord);
				}),
			),
		),
		write: Effect.fn("ClockProfiles.write")((record: ClockRecord) =>
			Effect.tryPromise({
				try: () =>
					runtime.runPromise(
						Effect.flatMap(ProfileRepository, (repository) =>
							repository.transact((envelope) => {
								const selected = resolve(envelope, record.target);
								const next = record.keys.find(
									(k) => k.keyCode === selected?.key.keyCode,
								);
								if (
									!selected ||
									!next ||
									record.revision !== selected.profile.revision + 1
								)
									return Effect.fail(
										ClockPersistenceFailed.fromCause(undefined),
									);
								return Schema.decodeUnknown(Schema.Array(ProfileAction))(
									next.config.actions,
								).pipe(
									Effect.mapError(ClockPersistenceFailed.fromCause),
									Effect.map((actions) => ({
										...envelope,
										profiles: EffectArray.map(envelope.profiles, (p) =>
											p.id !== selected.profile.id
												? p
												: {
														...p,
														revision: p.revision + 1,
														pages: EffectArray.map(p.pages, (page) =>
															page.id !== selected.page.id
																? page
																: {
																		...page,
																		keys: page.keys.map((key) =>
																			key.keyCode !== selected.key.keyCode
																				? key
																				: {
																						...key,
																						config: { ...key.config, actions },
																					},
																		),
																	},
														),
													},
										),
									})),
								);
							}),
						),
					),
				catch: ClockPersistenceFailed.fromCause,
			}).pipe(Effect.asVoid),
		),
	});

/** Resolve only the authenticated panel's active selection. No global clock fallback. */
export function activeClockTarget(
	envelope: ProfileEnvelope,
	deviceId: string,
	keyCode: string,
): ClockTarget | undefined {
	const selection = envelope.activeByDevice[deviceId];
	if (!selection) return undefined;
	return resolve(envelope, { ...selection, keyCode })?.target;
}
