import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import {
	Deferred,
	Effect,
	Either,
	Fiber,
	Layer,
	Option,
	Schema,
	Stream,
} from "effect";
import { createDesktopProfileStorage } from "../../../../apps/desktop/src/main/profiles/local-profile-storage.js";
import { Profile, type ProfileEnvelope } from "./profile-contracts.js";
import {
	ProfileReadFailed,
	ProfileRevisionConflict,
	ProfileValidationFailed,
	ProfileWriteFailed,
} from "./profile-errors.js";
import {
	completeEncodedEnvelope,
	completeEncodedKey,
	testFunctionContracts,
} from "./profile-fixtures.js";
import {
	ProfileFunctionContracts,
	profileFunctionContractsLayer,
} from "./profile-function-contracts.js";
import {
	ProfileRepository,
	type ProfileStoragePort,
	profileStorageLayer,
} from "./profile-repository.js";
import { ProfileService } from "./profile-service.js";

const request = (revision = 4, name = "Edited") => {
	const profile = completeEncodedEnvelope(revision).profiles[0];
	return {
		expectedRevision: revision,
		profile: { ...profile, revision: undefined, name },
	};
};
const validRequest = (revision = 4, name = "Edited") => {
	const { revision: _revision, ...profile } =
		completeEncodedEnvelope(revision).profiles[0] ?? {};
	return { expectedRevision: revision, profile: { ...profile, name } };
};
const serviceLayer = (storage: ProfileStoragePort) =>
	ProfileService.DefaultWithoutDependencies.pipe(
		Layer.provide(
			Layer.merge(
				ProfileRepository.Default.pipe(
					Layer.provide(profileStorageLayer(storage)),
				),
				profileFunctionContractsLayer(testFunctionContracts),
			),
		),
	);
const memoryStorage = () => {
	let current: unknown = completeEncodedEnvelope();
	let writes = 0;
	return {
		read: async () => current,
		write: async (envelope: unknown) => {
			writes++;
			current = envelope;
		},
		get writes() {
			return writes;
		},
	};
};

describe("profile conductor", () => {
	it.effect(
		"holds publication until persistence finishes and protects committed trees from draft mutation",
		() =>
			Effect.gen(function* () {
				const started = yield* Deferred.make<void>();
				const finish = yield* Deferred.make<void>();
				const storage = memoryStorage();
				const delayedStorage = {
					...storage,
					write: (value: unknown) =>
						Effect.runPromise(
							Effect.gen(function* () {
								yield* Deferred.succeed(started, undefined);
								yield* Deferred.await(finish);
								yield* Effect.promise(() => storage.write(value));
							}),
						),
				};
				yield* Effect.gen(function* () {
					const service = yield* ProfileService;
					yield* service.loadProfiles();
					const snapshots = yield* service.subscribeCommittedProfiles();
					const writer = yield* service
						.saveProfile(validRequest())
						.pipe(Effect.forkScoped);
					yield* Deferred.await(started);
					const pendingSnapshot = yield* Stream.runHead(snapshots);
					expect(
						Option.isSome(pendingSnapshot) &&
							pendingSnapshot.value.profiles[0].revision,
					).toBe(4);
					yield* Deferred.succeed(finish, undefined);
					const saved = yield* Fiber.join(writer);
					expect(saved.profiles[0].revision).toBe(5);
					expect(
						Object.isFrozen(saved.profiles[0].pages[0].keys[0]?.config.actions),
					).toBe(true);
					const profile = yield* service.getProfile("profile-a");
					expect(() =>
						Object.assign(profile, { name: "unsaved draft" }),
					).toThrow();
					expect((yield* service.getProfile("profile-a")).name).toBe("Edited");
				}).pipe(Effect.provide(serviceLayer(delayedStorage)));
			}).pipe(Effect.scoped),
	);

	it.effect("scrubs and retains a broken registered validator's cause", () => {
		const cause = new Error("secret from a broken validator");
		const contract = testFunctionContracts.get("hotkey");
		if (!contract) return Effect.die("Missing test contract");
		return Effect.gen(function* () {
			const result = yield* ProfileFunctionContracts.validateProfile(
				Schema.decodeUnknownSync(Profile)(
					completeEncodedEnvelope().profiles[0],
				),
			).pipe(Effect.either);
			expect(Either.isLeft(result)).toBe(true);
			if (Either.isLeft(result)) {
				expect(result.left.originalCause).toBe(cause);
				expect(JSON.stringify(result.left)).not.toContain("secret");
			}
		}).pipe(
			Effect.provide(
				profileFunctionContractsLayer(
					new Map([
						[
							"hotkey",
							{
								...contract,
								validateConfig: () => {
									throw cause;
								},
							},
						],
					]),
				),
			),
		);
	});
	it.effect(
		"serializes revision-4 saves into exactly one revision 5 and one catalog conflict",
		() => {
			const storage = memoryStorage();
			return Effect.gen(function* () {
				const service = yield* ProfileService;
				const results = yield* Effect.all(
					[
						service.saveProfile(validRequest(4, "First")),
						service.saveProfile(validRequest(4, "Second")),
					].map(Effect.either),
					{ concurrency: "unbounded" },
				);
				expect(results.filter(Either.isRight)).toHaveLength(1);
				const failures = results.filter(Either.isLeft);
				expect(failures).toHaveLength(1);
				const conflict = failures[0]?.left;
				expect(conflict).toBeInstanceOf(ProfileRevisionConflict);
				expect(conflict).toMatchObject({
					_tag: "ProfileRevisionConflict",
					code: "QUAKE.PROFILE.REVISION_CONFLICT",
					expectedRevision: 4,
					actualRevision: 5,
				});
				expect(storage.writes).toBe(1);
				expect((yield* service.getProfile("profile-a")).revision).toBe(5);
			}).pipe(Effect.provide(serviceLayer(storage)));
		},
	);
	it.effect(
		"publishes only complete committed envelopes and never failed/draft snapshots",
		() => {
			const storage = memoryStorage();
			const cause = Object.assign(
				new Error("token=super-secret /private/file"),
				{ code: "EIO", cause: new Error("secret nested") },
			);
			let failWrite = true;
			const failingStorage = {
				...storage,
				write: async (value: unknown) => {
					if (failWrite) throw cause;
					await storage.write(value);
				},
			};
			return Effect.gen(function* () {
				const service = yield* ProfileService;
				yield* service.loadProfiles();
				const snapshots = yield* service.subscribeCommittedProfiles();
				const ready = yield* Deferred.make<void>();
				const received: ProfileEnvelope[] = [];
				const observer = yield* snapshots.pipe(
					Stream.tap((snapshot) =>
						Effect.sync(() => {
							received.push(snapshot);
						}),
					),
					Stream.tap(() => Deferred.succeed(ready, undefined)),
					Stream.runDrain,
					Effect.forkScoped,
				);
				yield* Deferred.await(ready);
				const failure = yield* Effect.either(
					service.saveProfile(validRequest()),
				);
				expect(Either.isLeft(failure)).toBe(true);
				if (Either.isLeft(failure)) {
					expect(failure.left).toBeInstanceOf(ProfileWriteFailed);
					expect(failure.left.originalCause).toBe(cause);
					expect(JSON.stringify(failure.left)).not.toContain("secret");
					expect(failure.left.diagnosticCause).toMatchObject({
						sourceCode: "EIO",
						cause: { name: "Error" },
					});
				}
				expect(received.map((entry) => entry.profiles[0].revision)).toEqual([
					4,
				]);
				expect((yield* service.getProfile("profile-a")).revision).toBe(4);
				failWrite = false;
				yield* service.saveProfile(validRequest());
				const latest = yield* Stream.runHead(snapshots);
				expect(Option.isSome(latest) && latest.value.profiles[0].revision).toBe(
					5,
				);
				expect(Option.isSome(latest) && latest.value.profiles[0].knob).toEqual(
					(yield* service.getProfile("profile-a")).knob,
				);
				yield* Fiber.interrupt(observer);
			}).pipe(Effect.scoped, Effect.provide(serviceLayer(failingStorage)));
		},
	);
	it.effect(
		"rejects malformed drafts and function values with field paths without writes",
		() => {
			const storage = memoryStorage();
			return Effect.gen(function* () {
				const service = yield* ProfileService;
				const input = validRequest();
				const badKey = completeEncodedKey();
				const invalidValue = {
					...input,
					profile: {
						...input.profile,
						pages: [
							{
								id: "page-a",
								keys: [
									{
										...badKey,
										config: {
											...badKey.config,
											actions: [{ type: "hotkey", value: 42 }],
										},
									},
								],
							},
						],
					},
				};
				for (const value of [
					request(),
					{ ...input, expectedRevision: -1 },
					{ ...input, profile: { ...input.profile, pages: [] } },
					invalidValue,
				]) {
					const result = yield* Effect.either(service.saveProfile(value));
					expect(Either.isLeft(result)).toBe(true);
					if (Either.isLeft(result)) {
						expect(result.left).toBeInstanceOf(ProfileValidationFailed);
						if (result.left instanceof ProfileValidationFailed)
							expect(result.left.paths.length).toBeGreaterThan(0);
					}
				}
				expect(storage.writes).toBe(0);
			}).pipe(Effect.provide(serviceLayer(storage)));
		},
	);
	it.effect(
		"repairs invalid loaded device selections explicitly and persists the complete repair",
		() => {
			const fixture = completeEncodedEnvelope();
			const invalid = {
				...fixture,
				activeByDevice: { serial: { profileId: "missing", pageId: "missing" } },
			};
			let persisted: unknown;
			return Effect.gen(function* () {
				const service = yield* ProfileService;
				const result = yield* service.loadProfiles();
				expect(result.repairedSelections).toEqual(["serial"]);
				expect(result.envelope.activeByDevice.serial).toEqual({
					profileId: "profile-a",
					pageId: "page-a",
				});
				expect(persisted).toMatchObject({
					profiles: fixture.profiles,
					activeByDevice: {
						serial: { profileId: "profile-a", pageId: "page-a" },
					},
				});
			}).pipe(
				Effect.provide(
					serviceLayer({
						read: async () => invalid,
						write: async (envelope) => {
							persisted = envelope;
						},
					}),
				),
			);
		},
	);
	it.effect(
		"keeps read, missing-profile, and validation failures distinct",
		() => {
			const cause = Object.assign(new Error("private"), { code: "EACCES" });
			const unavailable = Effect.gen(function* () {
				const service = yield* ProfileService;
				const failure = yield* Effect.either(service.loadProfiles());
				expect(Either.isLeft(failure) && failure.left).toBeInstanceOf(
					ProfileReadFailed,
				);
				if (Either.isLeft(failure))
					expect(failure.left.originalCause).toBe(cause);
			}).pipe(
				Effect.provide(
					serviceLayer({
						read: async () => {
							throw cause;
						},
						write: async () => {},
					}),
				),
			);
			const missing = Effect.gen(function* () {
				const service = yield* ProfileService;
				const result = yield* Effect.either(service.getProfile("missing"));
				expect(Either.isLeft(result) && result.left.code).toBe(
					"QUAKE.PROFILE.NOT_FOUND",
				);
			}).pipe(Effect.provide(serviceLayer(memoryStorage())));
			return Effect.zipRight(unavailable, missing);
		},
	);
	it.effect(
		"preserves unsupported compatibility data while the default registry rejects authored unknown functions",
		() => {
			const fixture = completeEncodedEnvelope();
			const unknown = {
				...completeEncodedKey(),
				config: { ...completeEncodedKey().config, type: "cameraView" },
				compatibility: {
					unsupported: true,
					original: { resourceId: "old-camera", rtspUrl: "rtsp://local" },
				},
			};
			const input = {
				...validRequest(),
				profile: {
					...validRequest().profile,
					pages: [{ id: "page-a", keys: [unknown] }],
				},
			};
			return Effect.gen(function* () {
				const service = yield* ProfileService;
				const saved = yield* service.saveProfile(input);
				expect(
					Schema.encodeSync(Profile)(saved.profiles[0]).pages[0]?.keys[0]
						?.compatibility,
				).toEqual(unknown.compatibility);
				const result = yield* Effect.either(
					ProfileFunctionContracts.validateProfile(
						Schema.decodeUnknownSync(Profile)(fixture.profiles[0]),
					).pipe(Effect.provide(ProfileFunctionContracts.Default)),
				);
				expect(Either.isLeft(result)).toBe(true);
			}).pipe(
				Effect.provide(
					ProfileService.Default.pipe(
						Layer.provide(profileStorageLayer(memoryStorage())),
					),
				),
			);
		},
	);

	it("runs save through the real desktop adapter and reloads nested values in a fresh service", async () => {
		const directory = await fs.mkdtemp(join(tmpdir(), "quake-conductor-"));
		const path = join(directory, "profiles.json");
		try {
			await createDesktopProfileStorage(path).write(completeEncodedEnvelope());
			await Effect.runPromise(
				Effect.gen(function* () {
					const service = yield* ProfileService;
					yield* service.saveProfile(validRequest());
				}).pipe(
					Effect.provide(serviceLayer(createDesktopProfileStorage(path))),
				),
			);
			const reloaded = await Effect.runPromise(
				ProfileService.getProfile("profile-a").pipe(
					Effect.provide(serviceLayer(createDesktopProfileStorage(path))),
				),
			);
			expect(reloaded.revision).toBe(5);
			expect(reloaded.name).toBe("Edited");
			expect(Schema.encodeSync(Profile)(reloaded).pages).toEqual(
				completeEncodedEnvelope().profiles[0]?.pages,
			);
			expect(Schema.encodeSync(Profile)(reloaded).knob).toEqual(
				completeEncodedEnvelope().profiles[0]?.knob,
			);
		} finally {
			await fs.rm(directory, { recursive: true, force: true });
		}
	});

	it("pins catalog identity through Schema serialization", () => {
		const conflict = ProfileRevisionConflict.forRevisions(4, 5);
		const json: unknown = JSON.parse(JSON.stringify(conflict));
		expect(
			Either.isRight(Schema.decodeUnknownEither(ProfileRevisionConflict)(json)),
		).toBe(true);
		expect(
			Either.isLeft(
				Schema.decodeUnknownEither(ProfileRevisionConflict)({
					...conflict,
					code: "QUAKE.PROFILE.WRITE_FAILED",
				}),
			),
		).toBe(true);
		expect(Object.keys(conflict)).not.toContain("originalCause");
		const cause = new Error("private-token");
		const invalid = ProfileValidationFailed.fromCause(cause, [
			["profile", "compatibility", "private-token", "value"],
		]);
		expect(invalid.originalCause).toBe(cause);
		expect(invalid.paths).toEqual([["profile", "compatibility", "*", "value"]]);
		expect(JSON.stringify(invalid)).not.toContain("private-token");
		expect(
			Schema.decodeUnknownSync(ProfileValidationFailed)(
				JSON.parse(JSON.stringify(invalid)),
			).paths,
		).toEqual(invalid.paths);
	});
});
