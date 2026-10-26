import { expect, it } from "@effect/vitest";
import {
	Context,
	Deferred,
	Effect,
	Fiber,
	Layer,
	Redacted,
	Schema,
} from "effect";
import { emptyObsSaved, type ObsDetection, ObsSaved } from "./obs-contracts.js";
import { ObsRepository, ObsStorage } from "./obs-repository.js";

const fixture = (
	options: {
		readonly failWrite?: boolean;
		readonly failVault?: boolean;
		readonly detect?: () => Promise<ObsDetection | undefined>;
	} = {},
) =>
	Effect.gen(function* () {
		let saved: ObsSaved = emptyObsSaved;
		const secrets = new Map<string, string>();
		let sequence = 0;
		const ports: ObsStorage["Type"] = {
			store: {
				read: async () => saved,
				write: async (value) => {
					if (options.failWrite) throw new Error("private-storage-detail");
					saved = Schema.decodeUnknownSync(ObsSaved)(value);
				},
			},
			vault: {
				put: async (value) => {
					if (options.failVault) throw new Error("private-vault-detail");
					const ref = `ref-${++sequence}`;
					secrets.set(ref, value);
					return ref;
				},
				get: async (ref) => secrets.get(ref) ?? "",
				remove: async (ref) => {
					secrets.delete(ref);
				},
			},
			detect:
				options.detect ??
				(async () => ({
					port: 4456,
					password: "detected-secret",
					source: "fixture.ini",
				})),
		};
		const repo = Context.get(
			yield* Layer.build(
				ObsRepository.Default.pipe(
					Layer.provide(Layer.succeed(ObsStorage, ports)),
				),
			),
			ObsRepository,
		);
		return { repo, secrets, saved: () => saved };
	});

it.scoped(
	"local detection stores its password in the vault and never overwrites manual settings",
	() =>
		Effect.gen(function* () {
			const f = yield* fixture();
			expect(yield* f.repo.detect()).toEqual({
				found: true,
				source: "fixture.ini",
			});
			expect(f.saved()).toMatchObject({
				host: "127.0.0.1",
				port: 4456,
				manualOverride: false,
			});
			expect(JSON.stringify(f.saved())).not.toContain("detected-secret");
			expect(Redacted.value(yield* f.repo.password(f.saved()))).toBe(
				"detected-secret",
			);
			yield* f.repo.save(
				{ host: "obs.example", port: 4457, autoConnect: false },
				undefined,
			);
			expect(yield* f.repo.detect()).toEqual({ found: false, source: "" });
			expect(f.saved().host).toBe("obs.example");
		}),
);

for (const failure of ["failWrite", "failVault"] as const)
	it.scoped(
		`${failure} preserves committed settings and cleans newly created credentials`,
		() =>
			Effect.gen(function* () {
				const f = yield* fixture({ [failure]: true });
				const result = yield* Effect.either(
					f.repo.save(
						{ host: "localhost", port: 4456, autoConnect: true },
						Redacted.make("new-secret"),
					),
				);
				expect(result._tag === "Left" && result.left.code).toBe(
					"OBS.STORAGE.FAILED",
				);
				expect(JSON.stringify(result)).not.toContain("private-");
				expect(f.saved()).toEqual(emptyObsSaved);
				expect(f.secrets.size).toBe(0);
			}),
	);

it.scoped(
	"manual save racing local detection wins without losing its protected password",
	() =>
		Effect.gen(function* () {
			const entered = yield* Deferred.make<void>();
			const complete = yield* Deferred.make<void>();
			const f = yield* fixture({
				detect: () =>
					Effect.runPromise(
						Deferred.succeed(entered, undefined).pipe(
							Effect.zipRight(Deferred.await(complete)),
							Effect.as({
								port: 4456,
								password: "detected",
								source: "fixture.ini",
							}),
						),
					),
			});
			const detection = yield* Effect.fork(f.repo.detect());
			yield* Deferred.await(entered);
			const manual = yield* Effect.fork(
				f.repo.save(
					{ host: "obs.example", port: 4460, autoConnect: false },
					Redacted.make("manual"),
				),
			);
			yield* Deferred.succeed(complete, undefined);
			yield* Fiber.join(detection);
			yield* Fiber.join(manual);
			expect(f.saved()).toMatchObject({
				host: "obs.example",
				port: 4460,
				manualOverride: true,
			});
			expect([...f.secrets.values()]).toEqual(["manual"]);
		}),
);
