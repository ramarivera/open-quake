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
import { ProfileEnvelope } from "./profile-contracts.js";
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

const serviceLayer = (storage: ProfileStoragePort) =>
	ProfileService.DefaultWithoutDependencies.pipe(
		Layer.provide(
			ProfileRepository.DefaultWithoutDependencies.pipe(
				Layer.provide(
					Layer.merge(
						profileStorageLayer(storage),
						profileFunctionContractsLayer(testFunctionContracts),
					),
				),
			),
		),
	);
const validDraft = () => {
	const { revision, ...profile } = completeEncodedEnvelope().profiles[0];
	return { expectedRevision: revision, profile: { ...profile, name: "Saved" } };
};
const invalidDrafts = () => {
	const input = validDraft();
	const key = completeEncodedKey();
	return [
		{ ...input, profile: { ...input.profile, pages: [] } },
		{
			...input,
			profile: {
				...input.profile,
				pages: [
					{
						id: "page-a",
						keys: [
							{
								...key,
								config: {
									...key.config,
									actions: [{ type: "hotkey", value: 42 }],
								},
							},
						],
					},
				],
			},
		},
	];
};

describe("profile review regressions", () => {
	for (const invalidFirst of [true, false]) {
		it.effect(
			`gives conflicts priority over draft validation, invalid save ${invalidFirst ? "first" : "last"}`,
			() => {
				let writes = 0;
				return Effect.gen(function* () {
					const service = yield* ProfileService;
					if (invalidFirst) {
						for (const input of invalidDrafts()) {
							const invalid = yield* service
								.saveProfile(input)
								.pipe(Effect.either);
							expect(Either.isLeft(invalid) && invalid.left._tag).toBe(
								"ProfileValidationFailed",
							);
						}
						expect(writes).toBe(0);
					}
					yield* service.saveProfile(validDraft());
					for (const input of invalidDrafts()) {
						const stale = yield* service.saveProfile(input).pipe(Effect.either);
						expect(Either.isLeft(stale) && stale.left).toMatchObject({
							_tag: "ProfileRevisionConflict",
							expectedRevision: 4,
							actualRevision: 5,
						});
						const current = yield* service
							.saveProfile({ ...input, expectedRevision: 5 })
							.pipe(Effect.either);
						expect(Either.isLeft(current) && current.left._tag).toBe(
							"ProfileValidationFailed",
						);
					}
					expect(writes).toBe(1);
					expect((yield* service.getProfile("profile-a")).revision).toBe(5);
				}).pipe(
					Effect.provide(
						serviceLayer({
							read: async () => completeEncodedEnvelope(),
							write: async () => {
								writes++;
							},
						}),
					),
				);
			},
		);
	}

	it.effect(
		"checks a queued invalid draft against the revision after the pending write",
		() =>
			Effect.gen(function* () {
				const writing = yield* Deferred.make<void>();
				const finish = yield* Deferred.make<void>();
				const submitted = yield* Deferred.make<void>();
				let writes = 0;
				yield* Effect.gen(function* () {
					const service = yield* ProfileService;
					const writer = yield* service
						.saveProfile(validDraft())
						.pipe(Effect.forkScoped);
					yield* Deferred.await(writing);
					const contender = yield* Deferred.succeed(submitted, undefined).pipe(
						Effect.zipRight(service.saveProfile(invalidDrafts()[1])),
						Effect.either,
						Effect.forkScoped,
					);
					yield* Deferred.await(submitted);
					yield* Deferred.succeed(finish, undefined);
					yield* Fiber.join(writer);
					const result = yield* Fiber.join(contender);
					expect(Either.isLeft(result) && result.left).toMatchObject({
						_tag: "ProfileRevisionConflict",
						expectedRevision: 4,
						actualRevision: 5,
					});
					expect(writes).toBe(1);
				}).pipe(
					Effect.provide(
						serviceLayer({
							read: async () => completeEncodedEnvelope(),
							write: () =>
								Effect.runPromise(
									Effect.gen(function* () {
										writes++;
										yield* Deferred.succeed(writing, undefined);
										yield* Deferred.await(finish);
									}),
								),
						}),
					),
				);
			}).pipe(Effect.scoped),
	);

	it.effect(
		"retains stored records for editing but excludes unvalidated keys from dispatch snapshots",
		() => {
			const fixture = completeEncodedEnvelope();
			const unknown = completeEncodedKey("1,3");
			const invalid = completeEncodedKey("1,5");
			const unsupported = completeEncodedKey("1,7");
			const hidden = completeEncodedKey("2,1");
			const keys = [
				completeEncodedKey(),
				{ ...unknown, config: { ...unknown.config, type: "removedFunction" } },
				{
					...invalid,
					config: {
						...invalid.config,
						actions: [{ type: "hotkey", value: 42 }],
					},
				},
				{ ...unsupported, compatibility: { unsupported: true } },
				{ ...hidden, config: { ...hidden.config, display: false } },
			];
			const stored = {
				...fixture,
				profiles: [{ ...fixture.profiles[0], pages: [{ id: "page-a", keys }] }],
			};
			let writes = 0;
			return Effect.gen(function* () {
				const service = yield* ProfileService;
				const loaded = yield* service.loadProfiles();
				expect(loaded.envelope.profiles[0].pages[0].keys).toHaveLength(5);
				const committed = yield* service.subscribeCommittedProfiles();
				const editable = yield* Stream.runHead(committed);
				expect(
					Option.isSome(editable) &&
						editable.value.profiles[0].pages[0].keys.length,
				).toBe(5);
				const dispatch = yield* service.subscribeDispatchProfiles();
				const snapshot = yield* Stream.runHead(dispatch);
				expect(Option.isSome(snapshot)).toBe(true);
				if (Option.isSome(snapshot)) {
					expect(
						snapshot.value.profiles[0].pages[0].keys.map((key) => key.keyCode),
					).toEqual(["1,1"]);
					expect(snapshot.value.profiles[0].revision).toBe(4);
					expect(
						Object.isFrozen(snapshot.value.profiles[0].pages[0].keys),
					).toBe(true);
				}
				expect(
					(yield* service.getProfile("profile-a")).pages[0].keys,
				).toHaveLength(5);
				expect(writes).toBe(0);
			}).pipe(
				Effect.provide(
					serviceLayer({
						read: async () => stored,
						write: async () => {
							writes++;
						},
					}),
				),
			);
		},
	);

	it.effect(
		"rejects a request whose save identity changes during the initial read",
		() =>
			Effect.gen(function* () {
				for (const field of ["id", "expectedRevision"]) {
					const reading = yield* Deferred.make<void>();
					const finish = yield* Deferred.make<void>();
					const fixture = completeEncodedEnvelope();
					const stored = {
						...fixture,
						profiles: [
							...fixture.profiles,
							{ ...fixture.profiles[0], id: "profile-b" },
						],
					};
					let writes = 0;
					yield* Effect.gen(function* () {
						const service = yield* ProfileService;
						const input = validDraft();
						const writer = yield* service
							.saveProfile(input)
							.pipe(Effect.either, Effect.forkScoped);
						yield* Deferred.await(reading);
						if (field === "id") input.profile.id = "profile-b";
						else input.expectedRevision = 5;
						yield* Deferred.succeed(finish, undefined);
						const result = yield* Fiber.join(writer);
						expect(Either.isLeft(result) && result.left._tag).toBe(
							"ProfileValidationFailed",
						);
						expect(writes).toBe(0);
						expect((yield* service.getProfile("profile-b")).revision).toBe(4);
					}).pipe(
						Effect.provide(
							serviceLayer({
								read: () =>
									Effect.runPromise(
										Effect.gen(function* () {
											yield* Deferred.succeed(reading, undefined);
											yield* Deferred.await(finish);
											return stored;
										}),
									),
								write: async () => {
									writes++;
								},
							}),
						),
					);
				}
			}).pipe(Effect.scoped),
	);

	it.effect(
		"fails closed when a stored key's registered validator throws",
		() => {
			const contract = testFunctionContracts.get("hotkey");
			if (!contract) return Effect.die("Missing test contract");
			return Effect.gen(function* () {
				const envelope = Schema.decodeUnknownSync(ProfileEnvelope)(
					completeEncodedEnvelope(),
				);
				const projection =
					yield* ProfileFunctionContracts.dispatchSnapshot(envelope);
				expect(projection.profiles[0].pages[0].keys).toEqual([]);
				expect(envelope.profiles[0].pages[0].keys).toHaveLength(1);
			}).pipe(
				Effect.provide(
					profileFunctionContractsLayer(
						new Map([
							[
								"hotkey",
								{
									...contract,
									validateConfig: () => {
										throw new Error("broken validator");
									},
								},
							],
						]),
					),
				),
			);
		},
	);
});
