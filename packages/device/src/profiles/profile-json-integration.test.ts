import { deepStrictEqual } from "node:assert";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Either, Layer, Option, Schema, Stream } from "effect";
import { createDesktopProfileStorage } from "../../../../apps/desktop/src/main/profiles/local-profile-storage.js";
import { Profile } from "./profile-contracts.js";
import { ProfileValidationFailed } from "./profile-errors.js";
import {
	completeEncodedEnvelope,
	completeEncodedKey,
} from "./profile-fixtures.js";
import { profileStorageLayer } from "./profile-repository.js";
import { ProfileService } from "./profile-service.js";

// Vitest's object comparison reads own constructor values as type information.
// Compare parsed JSON with Node's prototype-aware assertion instead.
const expectJson = (actual: unknown, expected: unknown): void =>
	deepStrictEqual(
		JSON.parse(JSON.stringify(actual)),
		JSON.parse(JSON.stringify(expected)),
	);

describe("reserved JSON keys through profile persistence", () => {
	it("preserves inert payloads through snapshots, unrelated saves, disk and restart", async () => {
		const directory = await fs.mkdtemp(join(tmpdir(), "quake-profile-json-"));
		const path = join(directory, "profiles.json");
		const layer = () =>
			ProfileService.Default.pipe(
				Layer.provide(profileStorageLayer(createDesktopProfileStorage(path))),
			);
		try {
			const payload = {
				["__proto__"]: { originalId: "legacy" },
				constructor: { prototype: { originalId: "inert" } },
				prototype: [{ ["__proto__"]: "nested" }],
			};
			const fixture = completeEncodedEnvelope();
			const key = completeEncodedKey();
			const profile = {
				...fixture.profiles[0],
				compatibility: payload,
				knob: { keyCode: "0,1" as const, config: payload },
				pages: [
					{
						id: "page-a",
						compatibility: payload,
						keys: [
							{
								...key,
								compatibility: { unsupported: true, ...payload },
								config: {
									...key.config,
									type: "cameraView",
									compatibility: payload,
									actions: [{ type: "future", value: payload }],
									subActions: [payload],
								},
							},
						],
					},
				],
			} satisfies typeof Profile.Encoded;
			await createDesktopProfileStorage(path).write({
				...fixture,
				profiles: [profile],
			});
			await Effect.runPromise(
				Effect.gen(function* () {
					const service = yield* ProfileService;
					const loaded = yield* service.getProfile("profile-a");
					expectJson(Schema.encodeSync(Profile)(loaded), profile);
					const { revision, ...draft } = profile;
					const saved = yield* service.saveProfile({
						expectedRevision: revision,
						profile: { ...draft, name: "Unrelated title edit" },
					});
					const snapshots = yield* service.subscribeCommittedProfiles();
					const committed = yield* Stream.runHead(snapshots);
					expect(committed).toEqual(Option.some(saved));
					const compatibility = saved.profiles[0].compatibility;
					expect(
						Option.isSome(compatibility) &&
							Object.values(compatibility.value).every(Object.isFrozen),
					).toBe(true);
					expect(Object.values(payload).some(Object.isFrozen)).toBe(false);
					const dispatch = yield* service.subscribeDispatchProfiles();
					const active = yield* Stream.runHead(dispatch);
					expect(
						Option.isSome(active) && active.value.profiles[0].pages[0].keys,
					).toEqual([]);
				}).pipe(Effect.provide(layer())),
			);
			const reloaded = await Effect.runPromise(
				ProfileService.getProfile("profile-a").pipe(Effect.provide(layer())),
			);
			const expected = {
				...profile,
				name: "Unrelated title edit",
				revision: 5,
			};
			expectJson(Schema.encodeSync(Profile)(reloaded), expected);
			const disk: unknown = JSON.parse(await fs.readFile(path, "utf8"));
			expectJson(disk, { ...fixture, profiles: [expected] });
		} finally {
			await fs.rm(directory, { recursive: true, force: true });
		}
	});

	it.effect(
		"returns the catalog validation error for a non-JSON reserved-key value before writing",
		() => {
			let writes = 0;
			const fixture = completeEncodedEnvelope();
			const { revision, ...profile } = fixture.profiles[0];
			return Effect.gen(function* () {
				const result = yield* ProfileService.saveProfile({
					expectedRevision: revision,
					profile: { ...profile, compatibility: { ["__proto__"]: undefined } },
				}).pipe(Effect.either);
				expect(Either.isLeft(result)).toBe(true);
				if (Either.isLeft(result)) {
					expect(result.left).toBeInstanceOf(ProfileValidationFailed);
					expect(result.left.code).toBe("QUAKE.PROFILE.VALIDATION_FAILED");
					expect(result.left.originalCause).toBeDefined();
				}
				expect(writes).toBe(0);
			}).pipe(
				Effect.provide(
					ProfileService.Default.pipe(
						Layer.provide(
							profileStorageLayer({
								read: async () => fixture,
								write: async () => {
									writes++;
								},
							}),
						),
					),
				),
			);
		},
	);
});
