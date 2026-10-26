import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { describe, expect, it } from "vitest";
import type { SettingsDocument } from "./settings-contracts.js";
import {
	SettingsInvalid,
	SettingsPersistFailed,
	SettingsReadFailed,
} from "./settings-errors.js";
import { SettingsStorage } from "./settings-repository.js";
import { SettingsService } from "./settings-service.js";

function fixture(initial?: unknown, osLocale = "de-DE") {
	let state = initial,
		fail = false,
		writes = 0;
	const cause = new Error("private config token=never-serialize");
	const runtime = ManagedRuntime.make(
		SettingsService.Default.pipe(
			Layer.provide(
				Layer.succeed(SettingsStorage, {
					osLocale,
					read: Effect.sync(() => Option.fromNullable(state)),
					write: (next: SettingsDocument) =>
						Effect.suspend(() =>
							fail
								? Effect.fail(new SettingsPersistFailed(cause))
								: Effect.sync(() => {
										state = next;
										writes++;
									}),
						),
				}),
			),
		),
	);
	return {
		runtime,
		cause,
		stored: () => state,
		writes: () => writes,
		fail: () => {
			fail = true;
		},
	};
}
describe("saved locale settings", () => {
	it.each([
		["de-DE", "de"],
		["de_CH", "de"],
		["fr-FR", "en"],
		["en-GB", "en"],
	])("seeds %s once as %s without a network lookup", async (os, locale) => {
		const f = fixture(undefined, os);
		try {
			expect(
				await f.runtime.runPromise(SettingsService.use((s) => s.locale())),
			).toEqual({ locale, revision: 0 });
			await f.runtime.runPromise(SettingsService.use((s) => s.locale()));
			expect(f.writes()).toBe(1);
		} finally {
			await f.runtime.dispose();
		}
	});
	it("keeps saved choice and unrelated future settings, serializes changes, and rejects unsupported locales before IO", async () => {
		const f = fixture({
			version: 1,
			locale: "en",
			revision: 4,
			provider: { choice: "keep" },
			future: [1, 2],
		});
		try {
			expect(
				await f.runtime.runPromise(SettingsService.use((s) => s.locale())),
			).toEqual({ locale: "en", revision: 4 });
			const invalid = await f.runtime.runPromise(
				SettingsService.use((s) => Effect.either(s.setLocale("fr"))),
			);
			expect(invalid).toMatchObject({
				_tag: "Left",
				left: { _tag: "SettingsInvalid", code: "QUAKE.SETTINGS.INVALID" },
			});
			expect(f.writes()).toBe(0);
			await Promise.all(
				["de", "en", "de"].map((locale) =>
					f.runtime.runPromise(SettingsService.use((s) => s.setLocale(locale))),
				),
			);
			expect(f.stored()).toEqual({
				version: 1,
				locale: "de",
				revision: 7,
				provider: { choice: "keep" },
				future: [1, 2],
			});
		} finally {
			await f.runtime.dispose();
		}
	});
	it("retains the original cause and committed locale after a failed save without leaking secrets", async () => {
		const f = fixture({ version: 1, locale: "en", revision: 2 });
		try {
			await f.runtime.runPromise(SettingsService.use((s) => s.locale()));
			f.fail();
			const result = await f.runtime.runPromise(
				SettingsService.use((s) => Effect.either(s.setLocale("de"))),
			);
			expect(result._tag).toBe("Left");
			if (result._tag === "Left") {
				expect(result.left).toBeInstanceOf(SettingsPersistFailed);
				expect(result.left.originalCause).toBe(f.cause);
				expect(JSON.stringify(result.left)).not.toContain("never-serialize");
			}
			expect(
				await f.runtime.runPromise(SettingsService.use((s) => s.locale())),
			).toEqual({ locale: "en", revision: 2 });
		} finally {
			await f.runtime.dispose();
		}
	});
	it("preserves unsupported stored versions instead of overwriting or reseeding them", async () => {
		const saved = { version: 2, locale: "de", future: "keep" };
		const f = fixture(saved);
		try {
			const exit = await f.runtime.runPromiseExit(
				SettingsService.use((s) => s.locale()),
			);
			expect(exit._tag).toBe("Failure");
			expect(f.stored()).toBe(saved);
			expect(f.writes()).toBe(0);
		} finally {
			await f.runtime.dispose();
		}
	});
	it("gives settings errors stable identity and scrubbed causes", () => {
		const cause = Object.assign(new Error("secret"), { code: "EACCES" });
		for (const error of [
			new SettingsInvalid(cause),
			new SettingsReadFailed(cause),
			new SettingsPersistFailed(cause),
		]) {
			expect(error.originalCause).toBe(cause);
			expect(JSON.stringify(error)).not.toContain("secret");
			expect(error.code).toMatch(/^QUAKE.SETTINGS\./);
		}
	});
});

it("acquires without reading settings and retries failures without overwriting saved data", async () => {
	let broken = true;
	let reads = 0;
	let writes = 0;
	const error = new SettingsReadFailed(new Error("private saved settings"));
	const runtime = ManagedRuntime.make(
		SettingsService.Default.pipe(
			Layer.provide(
				Layer.succeed(SettingsStorage, {
					osLocale: "en",
					read: Effect.suspend(() => {
						reads++;
						return broken
							? Effect.fail(error)
							: Effect.succeed(
									Option.some({ version: 1, locale: "de", revision: 7 }),
								);
					}),
					write: () =>
						Effect.sync(() => {
							writes++;
						}),
				}),
			),
		),
	);
	try {
		await runtime.runtime();
		expect(reads).toBe(0);
		const failed = await runtime.runPromise(
			SettingsService.use((s) => Effect.either(s.locale())),
		);
		expect(failed).toMatchObject({ _tag: "Left", left: error });
		expect(writes).toBe(0);
		broken = false;
		const results = await Promise.all(
			Array.from({ length: 8 }, () =>
				runtime.runPromise(SettingsService.use((s) => s.locale())),
			),
		);
		expect(results.every((r) => r.locale === "de" && r.revision === 7)).toBe(
			true,
		);
		expect(reads).toBe(2);
		expect(writes).toBe(0);
	} finally {
		await runtime.dispose();
	}
});
