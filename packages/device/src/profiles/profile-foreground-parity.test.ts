import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Logger, Option, TestClock } from "effect";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
} from "./profile-contracts.js";
import { ProfileForegroundFailed } from "./profile-errors.js";
import { ProfileManager } from "./profile-manager-service.js";
import {
	ProfileRepository,
	profileStorageLayer,
} from "./profile-repository.js";
import {
	ProfileSwitching,
	ProfileSwitchingPort,
} from "./profile-switching-service.js";

const fixture = (foreground: ProfileSwitchingPort["Type"]["foreground"]) => {
	const base = createInitialProfileEnvelope();
	let saved: unknown = encodeProfileEnvelope({
		...base,
		profiles: [
			base.profiles[0],
			{ ...base.profiles[0], id: "linked", name: "Linked" },
			{ ...base.profiles[0], id: "edited", name: "Edited" },
		],
	});
	const pushes: string[] = [];
	const layer = Layer.mergeAll(
		ProfileManager.DefaultWithoutDependencies,
		ProfileSwitching.DefaultWithoutDependencies,
	).pipe(
		Layer.provideMerge(
			ProfileRepository.Default.pipe(
				Layer.provide(
					profileStorageLayer({
						read: async () => saved,
						write: async (value) => {
							saved = value;
						},
					}),
				),
			),
		),
		Layer.provide(
			Layer.succeed(ProfileSwitchingPort, {
				platform: "linux",
				foreground,
				push: (serial, profile) =>
					Effect.sync(() => {
						pushes.push(`${serial}:${profile.id}`);
					}),
			}),
		),
	);
	return { layer, pushes };
};
it.effect(
	"MAIN-084/085 reloads unchanged-app rules, normalizes native/ws_ targets and connects each logical device once",
	() => {
		const { layer, pushes } = fixture(() =>
			Effect.succeed(Option.some({ id: "window", path: "/apps/editor" })),
		);
		return Effect.gen(function* () {
			const switching = yield* ProfileSwitching,
				manager = yield* ProfileManager;
			yield* switching.connect("serial");
			yield* switching.connect("ws_serial");
			yield* switching.disconnect("ws_serial");
			expect(yield* switching.connectedSerials()).toEqual(["serial"]);
			yield* manager.command({
				type: "link",
				id: "linked",
				link: {
					profileId: "linked",
					appPath: "/apps/editor",
					appIdentifier: "editor",
					device: "ws_serial",
				},
			});
			pushes.length = 0;
			const first = yield* switching.probe().pipe(Effect.fork);
			yield* TestClock.adjust(300);
			yield* Fiber.join(first);
			expect(pushes).toEqual(["serial:linked"]);
			yield* manager.command({ type: "link", id: "linked", link: null });
			yield* manager.command({
				type: "link",
				id: "edited",
				link: {
					profileId: "edited",
					appPath: "/apps/editor",
					appIdentifier: "editor",
					device: "All Device",
				},
			});
			const second = yield* switching.probe().pipe(Effect.fork);
			yield* TestClock.adjust(300);
			yield* Fiber.join(second);
			expect(pushes).toEqual(["serial:linked", "serial:edited"]);
		}).pipe(Effect.provide(layer));
	},
);
it.scoped(
	"SETTINGS-109 throttles sustained errors for thirty seconds and resumes switching",
	() => {
		let failing = true;
		const logs: unknown[] = [];
		const logger = Logger.make(({ message }) => {
			logs.push(message);
		});
		const { layer, pushes } = fixture(() =>
			failing
				? Effect.fail(ProfileForegroundFailed.fromCause(new Error("synthetic")))
				: Effect.succeed(Option.some({ id: "window", path: "/apps/editor" })),
		);
		return Effect.gen(function* () {
			const switching = yield* ProfileSwitching,
				manager = yield* ProfileManager;
			yield* switching.connect("serial");
			yield* manager.command({
				type: "link",
				id: "linked",
				link: {
					profileId: "linked",
					appPath: "/apps/editor",
					appIdentifier: "editor",
				},
			});
			pushes.length = 0;
			yield* switching.poll.pipe(Effect.forkScoped);
			yield* TestClock.adjust(29_999);
			expect(logs).toHaveLength(1);
			yield* TestClock.adjust(1);
			expect(logs).toHaveLength(2);
			failing = false;
			yield* TestClock.adjust(2_300);
			expect(pushes).toEqual(["serial:linked"]);
		}).pipe(
			Effect.provide(layer),
			Effect.provide(Logger.replace(Logger.defaultLogger, logger)),
		);
	},
);
