import { describe, expect, it } from "@effect/vitest";
import {
	Effect,
	Array as EffectArray,
	Fiber,
	Layer,
	Option,
	TestClock,
} from "effect";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
} from "../../../../../packages/device/src/profiles/profile-contracts.js";
import {
	installProfileCatalog,
	managerState,
} from "../../../../../packages/device/src/profiles/profile-manager-invariants.js";
import { ProfileManager } from "../../../../../packages/device/src/profiles/profile-manager-service.js";
import {
	ProfileRepository,
	profileStorageLayer,
} from "../../../../../packages/device/src/profiles/profile-repository.js";
import {
	ProfileSwitching,
	ProfileSwitchingPort,
} from "../../../../../packages/device/src/profiles/profile-switching-service.js";
import { makeForegroundProbe } from "./foreground-app";
import {
	makeProfileController,
	type ProfileDesktopPort,
} from "./profile-controller";

const layer = () => {
	let saved: unknown = encodeProfileEnvelope(
		installProfileCatalog(createInitialProfileEnvelope(), "darwin"),
	);
	return Layer.mergeAll(
		ProfileManager.DefaultWithoutDependencies,
		ProfileSwitching.DefaultWithoutDependencies,
	).pipe(
		Layer.provideMerge(
			ProfileRepository.Default.pipe(
				Layer.provide(
					profileStorageLayer({
						read: async () => saved,
						write: async (e) => {
							saved = e;
						},
					}),
				),
			),
		),
		Layer.provide(
			Layer.succeed(ProfileSwitchingPort, {
				platform: "darwin",
				foreground: () => Effect.succeed(Option.none()),
				push: () => Effect.void,
			}),
		),
	);
};
const port = (): ProfileDesktopPort => ({
	confirm: async () => true,
	execute: async () => {},
	chooseApp: async () => Option.none(),
	capture: async () => "data:image/png;base64,capture",
	cachedThumbnail: async () => Option.none(),
	publish: () => {},
	progress: () => {},
});
describe("real profile desktop controller", () => {
	it.effect(
		"does not reuse thumbnails across locales or content changes at the same revision",
		() =>
			Effect.gen(function* () {
				const controller = yield* makeProfileController(port());
				yield* controller.request({
					type: "thumbnail",
					id: "1-2",
					locale: "en",
				});
				const english = yield* controller.request({
					type: "read",
					locale: "en",
				});
				expect(
					english._tag === "success" && english.view.thumbnails["1-2"],
				).toContain("capture");
				const german = yield* controller.request({
					type: "read",
					locale: "de",
					preview: true,
				});
				expect(german._tag === "success" && german.view.thumbnails["1-2"]).toBe(
					"",
				);
				const repo = yield* ProfileRepository;
				yield* repo.transact((e) =>
					Effect.succeed({
						...e,
						profiles: EffectArray.map(e.profiles, (p) =>
							p.id === "1-2"
								? {
										...p,
										name: "Updated catalog",
										compatibility: Option.none(),
									}
								: p,
						),
					}),
				);
				const updated = yield* controller.request({
					type: "read",
					locale: "en",
				});
				expect(
					updated._tag === "success" && updated.view.thumbnails["1-2"],
				).toBe("");
			}).pipe(Effect.provide(layer())),
	);
	it.effect(
		"preview reads preserve the management locale and independent serial selections survive deletion",
		() =>
			Effect.gen(function* () {
				const controller = yield* makeProfileController(port());
				yield* controller.request({ type: "read", locale: "de" });
				yield* controller.request({
					type: "read",
					locale: "en",
					preview: true,
				});
				const switching = yield* ProfileSwitching;
				yield* switching.connect("a", "1-1");
				yield* switching.connect("b", "1-2");
				const result = yield* controller.request({
					type: "manage",
					command: { type: "delete", id: "local-profile", confirmed: true },
				});
				expect(result._tag).toBe("success");
				if (result._tag === "success") {
					expect(result.view.envelope.activeByDevice.a?.profileId).toBe("1-1");
					expect(result.view.envelope.activeByDevice.b?.profileId).toBe("1-2");
					expect(
						result.view.envelope.profiles.find((p) => p.id === "1-1")?.name,
					).not.toBe("MeetAI");
				}
			}).pipe(Effect.provide(layer())),
	);
	it.effect(
		"shell cancellation executes nothing and approval is retained for exact content only",
		() => {
			let approve = false,
				prompts = 0;
			const executed: string[] = [];
			const native = {
				...port(),
				confirm: async (_message: string, detail: string) => {
					prompts++;
					expect(detail).toContain("Launchpad");
					return approve;
				},
				execute: async (command: string) => {
					executed.push(command);
				},
			};
			return Effect.gen(function* () {
				const controller = yield* makeProfileController(native);
				const manager = yield* ProfileManager;
				const request = {
					type: "run-command",
					id: "1-2",
					keyCode: "1,7",
				} as const;
				expect(yield* controller.request(request)).toEqual({
					_tag: "rejected",
					reason: "cancelled",
				});
				expect(executed).toEqual([]);
				expect(
					managerState(yield* manager.read()).approvedCommands,
				).toHaveLength(0);
				approve = true;
				yield* controller.request(request);
				yield* controller.request(request);
				expect(prompts).toBe(2);
				expect(executed).toHaveLength(2);
				expect(
					managerState(yield* manager.read()).approvedCommands,
				).toHaveLength(1);
				const repository = yield* ProfileRepository;
				yield* repository.transact((envelope) =>
					Effect.succeed({
						...envelope,
						profiles: EffectArray.map(envelope.profiles, (profile) => ({
							...profile,
							pages: EffectArray.map(profile.pages, (page) => ({
								...page,
								keys: page.keys.map((key) =>
									profile.id === "1-2" && key.keyCode === "1,7"
										? {
												...key,
												config: {
													...key.config,
													actions: [
														{ type: "text", value: "echo Launchpad changed" },
													],
												},
											}
										: key,
								),
							})),
						})),
					}),
				);
				yield* controller.request(request);
				expect(prompts).toBe(3);
				expect(executed.at(-1)).toBe("echo Launchpad changed");
			}).pipe(Effect.provide(layer()));
		},
	);
	it.effect(
		"reads translated names, creates a thumbnail and publishes only saved manager changes",
		() => {
			const publications: unknown[] = [];
			return Effect.gen(function* () {
				const controller = yield* makeProfileController({
					...port(),
					publish: (v) => {
						publications.push(v);
					},
				});
				const read = yield* controller.request({ type: "read", locale: "de" });
				expect(read._tag).toBe("success");
				if (read._tag === "success")
					expect(
						read.view.envelope.profiles.find((p) => p.id === "1-1")?.name,
					).not.toBe("MeetAI");
				const created = yield* controller.request({
					type: "manage",
					command: { type: "create" },
				});
				expect(created._tag).toBe("success");
				if (created._tag === "success") {
					expect(created.view.thumbnails["custom-1"]).toContain("capture");
					expect(
						created.view.envelope.profiles.find((p) => p.id === "custom-1")
							?.name,
					).toBe("Custom1");
				}
				const count = publications.length;
				yield* controller.request({
					type: "manage",
					command: { type: "delete", id: "1-2", confirmed: true },
				});
				expect(publications).toHaveLength(count);
			}).pipe(Effect.provide(layer()));
		},
	);
	it.effect("cancels a thumbnail batch after its in-flight capture", () => {
		let release: (value: string) => void = () => {};
		let started: () => void = () => {};
		const active = new Promise<void>((resolve) => {
			started = resolve;
		});
		let captures = 0;
		return Effect.gen(function* () {
			const controller = yield* makeProfileController({
				...port(),
				capture: () => {
					captures++;
					started();
					return new Promise<string>((resolve) => {
						release = resolve;
					});
				},
			});
			const batch = yield* controller
				.request({ type: "thumbnails" })
				.pipe(Effect.fork);
			yield* Effect.promise(() => active);
			yield* controller.request({ type: "cancel-thumbnails" });
			release("data:image/png;base64,done");
			yield* Fiber.join(batch);
			expect(captures).toBe(1);
			expect(controller.progress()).toMatchObject({ running: false, done: 1 });
		}).pipe(Effect.provide(layer()));
	});
	it.effect("reports capture failure instead of inventing a thumbnail", () =>
		Effect.gen(function* () {
			const controller = yield* makeProfileController({
				...port(),
				capture: async () => {
					throw new Error("unsupported");
				},
			});
			const result = yield* controller
				.request({ type: "thumbnail", id: "1-2", locale: "en" })
				.pipe(Effect.either);
			expect(result._tag).toBe("Left");
			if (result._tag === "Left")
				expect(result.left.code).toBe("QUAKE.PROFILE.THUMBNAIL_FAILED");
		}).pipe(Effect.provide(layer())),
	);
	it.effect("caches native foreground probes for 500 ms", () =>
		Effect.gen(function* () {
			let calls = 0;
			const probe = makeForegroundProbe("darwin", async () => {
				calls++;
				return Option.some({ id: String(calls), path: "/app" });
			});
			yield* probe();
			yield* probe();
			expect(calls).toBe(1);
			yield* TestClock.adjust(500);
			yield* probe();
			expect(calls).toBe(1);
			yield* TestClock.adjust(1);
			yield* probe();
			expect(calls).toBe(2);
		}),
	);
});

describe("profile native failure catalog", () => {
	it("preserves causes privately and scrubs serialized command/foreground/thumbnail diagnostics", () => {
		const cause = new Error("token=secret /private/path");
		for (const leaf of [
			ProfileCommandFailed,
			ProfileForegroundFailed,
			ProfileThumbnailFailed,
			ProfileThumbnailUnsupported,
			ProfileDeliveryFailed,
		]) {
			const error = leaf.fromCause(cause);
			expect(error.originalCause).toBe(cause);
			expect(error.code).toMatch(/^QUAKE.PROFILE\./);
			expect(JSON.stringify(error)).not.toContain("secret");
			expect(Object.keys(error)).not.toContain("originalCause");
		}
	});
});

import {
	ProfileCommandFailed,
	ProfileDeliveryFailed,
	ProfileForegroundFailed,
	ProfileThumbnailFailed,
	ProfileThumbnailUnsupported,
} from "../../../../../packages/device/src/profiles/profile-errors.js";
