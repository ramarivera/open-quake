import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	defaultHardwarePreferences,
	HardwarePreferencesStore,
} from "@open-quake/device";
import { Effect, Either, ManagedRuntime, Option } from "effect";
import { describe, expect, it } from "vitest";
import { hardwarePreferencesLive } from "./preferences";

describe("serial preferences disk adapter", () => {
	it("isolates serials, stores validated atomic snapshots and reports corruption with private causes", async () => {
		const root = await mkdtemp(join(tmpdir(), "open-quake-hardware-test-"));
		const runtime = ManagedRuntime.make(hardwarePreferencesLive(root));
		try {
			const store = await runtime.runPromise(HardwarePreferencesStore);
			expect(await runtime.runPromise(store.read("A"))).toEqual(Option.none());
			await runtime.runPromise(
				store.write("A", {
					...defaultHardwarePreferences,
					alertVolume: 32,
					knobLedAlwaysOn: false,
				}),
			);
			await runtime.runPromise(store.write("B", defaultHardwarePreferences));
			expect(await runtime.runPromise(store.read("A"))).toEqual(
				Option.some({
					...defaultHardwarePreferences,
					alertVolume: 32,
					knobLedAlwaysOn: false,
				}),
			);
			expect(await runtime.runPromise(store.read("B"))).toEqual(
				Option.some(defaultHardwarePreferences),
			);
			const files = await readdir(root);
			expect(files).toHaveLength(2);
			for (const name of files) {
				const text = await readFile(join(root, name), "utf8");
				if (text.includes('"serial":"A"'))
					await writeFile(join(root, name), "sk-private-corrupt");
			}
			const result = await runtime.runPromise(
				store.read("A").pipe(Effect.either),
			);
			expect(Either.isLeft(result)).toBe(true);
			if (Either.isLeft(result)) {
				expect(result.left.code).toBe("QUAKE.HARDWARE.PREFERENCES_FAILED");
				expect(result.left.originalCause).toBeInstanceOf(Error);
				expect(JSON.stringify(result.left)).not.toContain("sk-private-corrupt");
				expect(JSON.stringify(result.left)).not.toContain(root);
			}
		} finally {
			await runtime.dispose();
			await rm(root, { recursive: true, force: true });
		}
	});
});
