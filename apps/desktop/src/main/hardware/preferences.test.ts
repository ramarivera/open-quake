import { createHash } from "node:crypto";
import {
	link,
	mkdtemp,
	readdir,
	readFile,
	rm,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	defaultHardwarePreferences,
	HardwarePreferencesStore,
} from "@open-quake/device";
import { Effect, Either, ManagedRuntime, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import { hardwarePreferencesLive } from "./preferences";

const readFailures = vi.hoisted(() => new Map<string, Error>());

vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...fs,
		link: vi.fn(fs.link),
		readFile: (...args: Parameters<typeof fs.readFile>) => {
			const error = readFailures.get(String(args[0]));
			return error ? Promise.reject(error) : fs.readFile(...args);
		},
	};
});

const filename = (root: string, serial: string) =>
	join(root, `${createHash("sha256").update(serial).digest("hex")}.json`);
const legacy = {
	...defaultHardwarePreferences,
	buzzerEnabled: false,
	knobLedAlwaysOn: false,
	alertVolume: 32,
	mic: false,
	luminance: 77,
};

async function migrationFixture() {
	const root = await mkdtemp(join(tmpdir(), "open-quake-serial-migration-"));
	const runtime = ManagedRuntime.make(hardwarePreferencesLive(root));
	const store = await runtime.runPromise(HardwarePreferencesStore);
	await runtime.runPromise(store.write("AB:CD", legacy));
	return {
		root,
		runtime,
		store,
		close: async () => {
			await runtime.dispose();
			await rm(root, { recursive: true, force: true });
		},
	};
}

describe("serial preferences disk adapter", () => {
	it("round-trips every luminance observation below the outbound command minimum", async () => {
		const f = await migrationFixture();
		try {
			for (let luminance = 0; luminance < 25; luminance++) {
				const preferences = { ...legacy, luminance };
				await f.runtime.runPromise(f.store.write("LOW", preferences));
				expect(await f.runtime.runPromise(f.store.read("LOW"))).toEqual(
					Option.some(preferences),
				);
			}
		} finally {
			await f.close();
		}
	});
	it("migrates a fake store's colon-serial record atomically and keeps the legacy source recoverable", async () => {
		const f = await migrationFixture();
		try {
			expect(await f.runtime.runPromise(f.store.read("ABCD"))).toEqual(
				Option.some(legacy),
			);
			expect(
				JSON.parse(await readFile(filename(f.root, "ABCD"), "utf8")),
			).toEqual({ version: 1, serial: "ABCD", preferences: legacy });
			expect(
				JSON.parse(await readFile(filename(f.root, "AB:CD"), "utf8")),
			).toEqual({ version: 1, serial: "AB:CD", preferences: legacy });
			expect(await readdir(f.root)).toHaveLength(2);
			const saved = { ...legacy, alertVolume: 128 };
			await f.runtime.runPromise(f.store.write("ABCD", saved));
			expect(await f.runtime.runPromise(f.store.read("ABCD"))).toEqual(
				Option.some(saved),
			);
		} finally {
			await f.close();
		}
	});

	it("chooses the newest matching legacy file without loading another device's preferences", async () => {
		const f = await migrationFixture();
		try {
			await utimes(filename(f.root, "AB:CD"), 1, 1);
			const newest = { ...legacy, alertVolume: 128 };
			await f.runtime.runPromise(f.store.write("A:B:CD", newest));
			await f.runtime.runPromise(
				f.store.write("EF:01", defaultHardwarePreferences),
			);
			expect(await f.runtime.runPromise(f.store.read("ABCD"))).toEqual(
				Option.some(newest),
			);
			expect(await f.runtime.runPromise(f.store.read("unrelated"))).toEqual(
				Option.none(),
			);
		} finally {
			await f.close();
		}
	});

	it("ignores unreadable and corrupt unrelated records when migrating or starting a fresh serial", async () => {
		const f = await migrationFixture();
		try {
			await f.runtime.runPromise(
				f.store.write("EF:01", defaultHardwarePreferences),
			);
			readFailures.set(
				filename(f.root, "EF:01"),
				Object.assign(new Error("read denied"), { code: "EACCES" }),
			);
			await writeFile(filename(f.root, "OTHER"), "corrupt unrelated JSON");
			expect(await f.runtime.runPromise(f.store.read("NEW"))).toEqual(
				Option.none(),
			);
			expect(await f.runtime.runPromise(f.store.read("ABCD"))).toEqual(
				Option.some(legacy),
			);
			expect(await f.runtime.runPromise(f.store.read("AB:CD"))).toEqual(
				Option.some(legacy),
			);
			const ownFailure = await f.runtime.runPromise(
				f.store.read("EF:01").pipe(Effect.either),
			);
			expect(Either.isLeft(ownFailure)).toBe(true);
			if (Either.isLeft(ownFailure)) {
				expect(ownFailure.left.code).toBe("QUAKE.HARDWARE.PREFERENCES_FAILED");
				expect(ownFailure.left.originalCause).toMatchObject({ code: "EACCES" });
				expect(JSON.stringify(ownFailure.left)).not.toContain(f.root);
			}
		} finally {
			readFailures.clear();
			await f.close();
		}
	});

	it("never replaces a normalized save that arrives while migration is staged", async () => {
		const f = await migrationFixture();
		const fs =
			await vi.importActual<typeof import("node:fs/promises")>(
				"node:fs/promises",
			);
		const saved = { ...legacy, alertVolume: 128 };
		vi.mocked(link).mockImplementationOnce(async (source, target) => {
			await f.runtime.runPromise(f.store.write("ABCD", saved));
			await fs.link(source, target);
		});
		try {
			expect(await f.runtime.runPromise(f.store.read("ABCD"))).toEqual(
				Option.some(saved),
			);
			expect(
				JSON.parse(await readFile(filename(f.root, "ABCD"), "utf8")),
			).toMatchObject({ preferences: saved });
			expect(await readdir(f.root)).toHaveLength(2);
		} finally {
			await f.close();
		}
	});

	it("reports a corrupt canonical record without replacing it with legacy data", async () => {
		const f = await migrationFixture();
		try {
			await writeFile(filename(f.root, "ABCD"), "corrupt-canonical");
			const result = await f.runtime.runPromise(
				f.store.read("ABCD").pipe(Effect.either),
			);
			expect(Either.isLeft(result)).toBe(true);
			expect(await readFile(filename(f.root, "ABCD"), "utf8")).toBe(
				"corrupt-canonical",
			);
			expect(await f.runtime.runPromise(f.store.read("AB:CD"))).toEqual(
				Option.some(legacy),
			);
		} finally {
			await f.close();
		}
	});

	it("keeps legacy data and removes staging after a failed migration, then retries", async () => {
		const f = await migrationFixture();
		vi.mocked(link).mockRejectedValueOnce(
			Object.assign(new Error("publish denied"), { code: "EACCES" }),
		);
		try {
			const result = await f.runtime.runPromise(
				f.store.read("ABCD").pipe(Effect.either),
			);
			expect(Either.isLeft(result)).toBe(true);
			if (Either.isLeft(result)) {
				expect(result.left.code).toBe("QUAKE.HARDWARE.PREFERENCES_FAILED");
				expect(result.left.originalCause).toBeInstanceOf(Error);
			}
			expect(await readdir(f.root)).toEqual([
				filename(f.root, "AB:CD").split("/").at(-1),
			]);
			expect(await f.runtime.runPromise(f.store.read("ABCD"))).toEqual(
				Option.some(legacy),
			);
		} finally {
			await f.close();
		}
	});

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
