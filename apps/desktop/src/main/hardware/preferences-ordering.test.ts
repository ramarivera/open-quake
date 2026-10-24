import { mkdtemp, readdir, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import {
	defaultHardwarePreferences,
	HardwareControls,
	QuakeDevice,
} from "@open-quake/device";
import { makeFakeHardwareTransport } from "@open-quake/device/hardware/fake";
import { Effect, Fiber, Layer, Option, TestClock } from "effect";
import { vi } from "vitest";
import { hardwarePreferencesLive } from "./preferences";

vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return { ...fs, rename: vi.fn(fs.rename) };
});

for (const teardown of [false, true]) {
	it.scoped(`persists B after slow native rename A, teardown=${teardown}`, () =>
		Effect.gen(function* () {
			const root = yield* Effect.acquireRelease(
				Effect.promise(() => mkdtemp(join(tmpdir(), "hardware-ordering-"))),
				(root) =>
					Effect.promise(() => rm(root, { recursive: true, force: true })),
			);
			const fs = yield* Effect.promise(() =>
				vi.importActual<typeof import("node:fs/promises")>("node:fs/promises"),
			);
			let releaseRename = () => {};
			let notifyStarted = () => {};
			const blocked = new Promise<void>((resolve) => {
				releaseRename = resolve;
			});
			const started = new Promise<void>((resolve) => {
				notifyStarted = resolve;
			});
			let notifyLatest = () => {};
			const latestCommitted = new Promise<void>((resolve) => {
				notifyLatest = resolve;
			});
			vi.mocked(rename)
				.mockImplementation(async (source, target) => {
					await fs.rename(source, target);
					notifyLatest();
				})
				.mockImplementationOnce(async (source, target) => {
					notifyStarted();
					await blocked;
					await fs.rename(source, target);
				});
			yield* Effect.gen(function* () {
				const fake = yield* makeFakeHardwareTransport();
				const device = yield* QuakeDevice.pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(
							Layer.provide(fake.layer),
						),
					),
				);
				const connection = yield* device.connect();
				const controls = yield* HardwareControls.pipe(
					Effect.provide(
						HardwareControls.DefaultWithoutDependencies.pipe(
							Layer.provide(hardwarePreferencesLive(root)),
						),
					),
				);
				const session = yield* controls.create(connection, {
					serial: "A",
					session: "ordering",
				});
				const a = {
					...defaultHardwarePreferences,
					buzzerEnabled: false,
					alertVolume: 32,
				};
				const b = { ...a, alertVolume: 128 };
				yield* session.configure(a);
				yield* TestClock.adjust(500);
				yield* Effect.promise(() => started);
				const replacing = yield* session.configure(b).pipe(Effect.fork);
				yield* TestClock.adjust(500);
				if (Option.isSome(yield* Fiber.poll(replacing)))
					yield* Effect.promise(() => latestCommitted);
				releaseRename();
				yield* Fiber.join(replacing);
				if (!teardown) {
					yield* TestClock.adjust(500);
					yield* Effect.promise(() => latestCommitted);
				}
			}).pipe(Effect.scoped);
			const files = yield* Effect.promise(() => readdir(root));
			expect(files).toHaveLength(1);
			const text = yield* Effect.promise(() =>
				readFile(join(root, files[0] ?? ""), "utf8"),
			);
			const persisted: unknown = JSON.parse(text);
			expect(persisted).toEqual({
				version: 1,
				serial: "A",
				preferences: {
					...defaultHardwarePreferences,
					buzzerEnabled: false,
					alertVolume: 128,
				},
			});
		}).pipe(
			Effect.ensuring(Effect.sync(() => vi.mocked(rename).mockRestore())),
		),
	);
}
