import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "@effect/vitest";
import {
	HardwareControls,
	HardwarePreferencesStore,
	QuakeDevice,
} from "@open-quake/device";
import {
	fakeHardwareReply,
	makeFakeHardwareTransport,
} from "@open-quake/device/hardware/fake";
import { encodeHardwareCommand } from "@open-quake/protocol";
import { Effect, Layer, Option, Schema } from "effect";
import { HardwareResponse } from "../../shared/hardware-contracts";
import { hardwarePreferencesLive } from "./preferences";

for (const luminance of [0, 12, 24]) {
	it.scoped(
		`luminance ${luminance} survives snapshot decode and dirty-owner reconnect through real disk storage`,
		() =>
			Effect.gen(function* () {
				const root = yield* Effect.acquireRelease(
					Effect.promise(() => mkdtemp(join(tmpdir(), "luminance-readback-"))),
					(root) =>
						Effect.promise(() => rm(root, { recursive: true, force: true })),
				);
				const storeLayer = hardwarePreferencesLive(root);
				const store = yield* HardwarePreferencesStore.pipe(
					Effect.provide(storeLayer),
				);
				const controls = yield* HardwareControls.pipe(
					Effect.provide(
						HardwareControls.DefaultWithoutDependencies.pipe(
							Layer.provide(storeLayer),
						),
					),
				);
				const fake = yield* makeFakeHardwareTransport({
					serial: "LOW",
					onCommand: (c) =>
						c.opCode === 2
							? [
									fakeHardwareReply(
										c.cmdId,
										c.cmdId === 46
											? [1, 1, 0, 21]
											: [c.cmdId === 5 ? luminance : 1],
									),
								]
							: [fakeHardwareReply(0, [0x90])],
				});
				const device = yield* QuakeDevice.pipe(
					Effect.provide(
						QuakeDevice.DefaultWithoutDependencies.pipe(
							Layer.provide(fake.layer),
						),
					),
				);
				const connection = yield* device.connect();
				const old = yield* controls.create(connection, {
					serial: "LOW",
					session: "old",
				});
				yield* old.refresh();
				const snapshot = yield* old.snapshot();
				expect(
					Schema.decodeUnknownSync(HardwareResponse)({
						_tag: "ready",
						snapshot,
						mock: true,
					}),
				).toMatchObject({
					snapshot: { luminance, preferences: { luminance } },
				});
				expect(yield* store.read("LOW")).toEqual(Option.none());
				// Replacement occurs before debounce and must flush the dirty previous owner.
				const replacement = yield* controls.create(connection, {
					serial: "LOW",
					session: "new",
				});
				expect(yield* replacement.snapshot()).toMatchObject({
					available: true,
					recovered: { luminance },
					preferences: { luminance },
					stateSyncSuccess: false,
				});
				expect(yield* store.read("LOW")).toMatchObject({
					value: { luminance },
				});
				expect((yield* old.snapshot()).available).toBe(false);
				yield* replacement.refresh();
				expect((yield* replacement.snapshot()).luminance).toBe(luminance);
				expect(
					(yield* encodeHardwareCommand({
						_tag: "Luminance",
						value: luminance,
					}).pipe(Effect.either))._tag,
				).toBe("Left");
				yield* replacement.stepBrightness(-1);
				expect((yield* replacement.snapshot()).luminance).toBe(25);
				expect(
					(yield* fake.writes).some(
						(report) => report[3] === 1 && report[4] === 5 && report[5] === 25,
					),
				).toBe(true);
			}),
	);
}
