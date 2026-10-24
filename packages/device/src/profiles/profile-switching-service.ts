import { Context, Effect, Option } from "effect";
import type { Profile } from "./profile-contracts.js";
import {
	type ProfileDeliveryFailed,
	type ProfileForegroundFailed,
	ProfileNotFound,
	type ProfileSwitchingError,
} from "./profile-errors.js";
import type { ProfilePlatform } from "./profile-manager-contracts.js";
import { managerState, visibleProfiles } from "./profile-manager-invariants.js";
import { ProfileRepository } from "./profile-repository.js";
import {
	type ForegroundApp,
	foregroundChanged,
	matchAppProfiles,
} from "./profile-switching-invariants.js";

/** Lifecycle lane supplies real serials; this lane never opens an HID collection. */
export class ProfileSwitchingPort extends Context.Tag(
	"@open-quake/device/ProfileSwitchingPort",
)<
	ProfileSwitchingPort,
	{
		readonly platform: ProfilePlatform;
		readonly foreground: () => Effect.Effect<
			Option.Option<ForegroundApp>,
			ProfileForegroundFailed
		>;
		readonly push: (
			serial: string,
			profile: Profile,
		) => Effect.Effect<void, ProfileDeliveryFailed>;
	}
>() {}
export class ProfileSwitching extends Effect.Service<ProfileSwitching>()(
	"@open-quake/device/ProfileSwitching",
	{
		dependencies: [ProfileRepository.Default],
		effect: Effect.gen(function* () {
			const repository = yield* ProfileRepository;
			const port = yield* ProfileSwitchingPort;
			const sessions = new Set<string>();
			const generations = new Map<string, number>();
			let previous: Option.Option<ForegroundApp> = Option.none();
			let lastRevision = -1;
			const selectNow = Effect.fn("ProfileSwitching.selectNow")(function* (
				serial: string,
				id: string,
				expectedGeneration?: number,
			): Effect.fn.Return<void, ProfileSwitchingError> {
				const generation =
					expectedGeneration ?? (generations.get(serial) ?? 0) + 1;
				if (expectedGeneration === undefined)
					generations.set(serial, generation);
				if (generations.get(serial) !== generation) return;
				yield* repository.transact((current) =>
					Effect.gen(function* () {
						if (generations.get(serial) !== generation) return current;
						const profile = visibleProfiles(current).find((p) => p.id === id);
						if (!profile || serial === "__proto__" || !serial)
							return yield* ProfileNotFound.fromCause(undefined);
						// Delivery failure must leave both durable state and subscribers unchanged.
						yield* port.push(serial, profile);
						if (generations.get(serial) !== generation) return current;
						return {
							...current,
							activeByDevice: {
								...current.activeByDevice,
								[serial]: { profileId: id, pageId: profile.pages[0].id },
							},
						};
					}),
				);
			});
			const request = Effect.fn("ProfileSwitching.request")(function* (
				serial: string,
				id: string,
			): Effect.fn.Return<void, ProfileSwitchingError> {
				const generation = (generations.get(serial) ?? 0) + 1;
				generations.set(serial, generation);
				yield* Effect.sleep(300);
				if (sessions.has(serial) && generations.get(serial) === generation)
					yield* selectNow(serial, id, generation);
			});
			const connect = Effect.fn("ProfileSwitching.connect")(function* (
				serial: string,
				reported?: string,
			): Effect.fn.Return<void, ProfileSwitchingError> {
				if (sessions.has(serial)) return;
				// Reserve before storage yields. A disconnect also invalidates this initialization.
				sessions.add(serial);
				const generation = (generations.get(serial) ?? 0) + 1;
				generations.set(serial, generation);
				yield* Effect.gen(function* () {
					const { envelope } = yield* repository.load();
					if (!sessions.has(serial) || generations.get(serial) !== generation)
						return;
					const state = managerState(envelope);
					const visible = visibleProfiles(envelope);
					const id =
						visible.find((p) => Option.contains(state.startup, p.id))?.id ??
						visible.find((p) => p.id === reported)?.id ??
						visible.find(
							(p) => p.id === envelope.activeByDevice[serial]?.profileId,
						)?.id ??
						visible.at(-1)?.id;
					if (!id) {
						sessions.delete(serial);
						return;
					}
					previous = Option.none();
					yield* selectNow(serial, id, generation);
				}).pipe(
					Effect.onError(() =>
						Effect.sync(() => {
							if (generations.get(serial) === generation)
								sessions.delete(serial);
						}),
					),
				);
			});
			const disconnect = Effect.fn("ProfileSwitching.disconnect")(
				(serial: string): Effect.Effect<void> =>
					Effect.sync(() => {
						sessions.delete(serial);
						generations.set(serial, (generations.get(serial) ?? 0) + 1);
					}),
			);
			const probe = Effect.fn("ProfileSwitching.probe")(
				function* (): Effect.fn.Return<void, ProfileSwitchingError> {
					if (sessions.size === 0) return;
					const next = yield* port.foreground();
					const { envelope } = yield* repository.load();
					const revision = managerState(envelope).revision;
					if (!foregroundChanged(previous, next) && revision === lastRevision)
						return;
					previous = next;
					lastRevision = revision;
					if (Option.isNone(next) || sessions.size === 0) return;
					const links = managerState(envelope).links.filter((link) =>
						visibleProfiles(envelope).some((p) => p.id === link.profileId),
					);
					const targets = new Map<string, string>();
					for (const serial of sessions)
						for (const link of matchAppProfiles(
							next.value.path,
							links.filter(
								(link) =>
									Option.isNone(link.device) || link.device.value === serial,
							),
						))
							targets.set(serial, link.profileId);
					yield* Effect.forEach(
						targets,
						([serial, id]) => request(serial, id),
						{ concurrency: "unbounded", discard: true },
					);
				},
			);
			const report = (error: ProfileSwitchingError): Effect.Effect<void> =>
				Effect.sync(() => {
					previous = Option.none();
				}).pipe(
					Effect.zipRight(
						Effect.logWarning("Foreground profile probe failed", {
							code: error.code,
						}),
					),
				);
			const checkedProbe = probe().pipe(
				Effect.catchTags({
					ProfileReadFailed: report,
					ProfileWriteFailed: report,
					ProfileValidationFailed: report,
					ProfileNotFound: report,
					ProfileRevisionConflict: report,
					ProfileForegroundFailed: report,
					ProfileDeliveryFailed: report,
				}),
			);
			const poll = Effect.scoped(
				Effect.forever(
					checkedProbe.pipe(
						Effect.forkScoped,
						Effect.zipRight(
							Effect.sleep(port.platform === "darwin" ? 3000 : 2000),
						),
					),
				),
			);

			/** Refresh committed content under the selection lock without changing any selection. */
			const redeliverSelected = Effect.fn("ProfileSwitching.redeliverSelected")(
				function* (
					id: string,
				): Effect.fn.Return<boolean, ProfileSwitchingError> {
					let applied = false;
					yield* repository.transact((current) =>
						Effect.gen(function* () {
							const profile = current.profiles.find((p) => p.id === id);
							if (!profile) return yield* ProfileNotFound.fromCause(undefined);
							for (const serial of sessions) {
								if (current.activeByDevice[serial]?.profileId !== id) continue;
								generations.set(serial, (generations.get(serial) ?? 0) + 1);
								yield* port.push(serial, profile);
								applied = true;
							}
							return current;
						}),
					);
					return applied;
				},
			);

			return {
				/** Called under the manager transaction; never reacquires its repository lock. */
				deliver: Effect.fn("ProfileSwitching.deliver")(
					(
						serial: string,
						profile: Profile,
					): Effect.Effect<void, ProfileDeliveryFailed> =>
						Effect.sync(() => {
							generations.set(serial, (generations.get(serial) ?? 0) + 1);
						}).pipe(Effect.zipRight(port.push(serial, profile))),
				),
				connect,
				disconnect,
				request,
				selectNow,
				probe,
				poll,
				redeliverSelected,
				connectedSerials: Effect.fn("ProfileSwitching.connectedSerials")(
					(): Effect.Effect<readonly string[]> =>
						Effect.sync(() => [...sessions]),
				),
			};
		}),
	},
) {}
