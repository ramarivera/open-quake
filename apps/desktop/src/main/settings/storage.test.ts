import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime } from "effect";
import { describe, expect, it } from "vitest";
import { GeneralSettingsService } from "../../../../../packages/edge/src/settings/general-service";
import {
	SettingsOsPort,
	WizardOwners,
} from "../../../../../packages/edge/src/settings/settings-ports";
import { WizardService } from "../../../../../packages/edge/src/settings/wizard-service";
import { createSettingsOsAdapter } from "./os-adapter";
import { desktopSettingsStorage } from "./storage";

const owners = Layer.succeed(WizardOwners, {
	displayAvailable: () => Effect.succeed(false),
	usableProfiles: (ids) =>
		Effect.succeed(ids.length === 1 && ids[0] === "local"),
	runtimeSupported: Effect.succeed(false),
	runtimeConfigured: Effect.succeed(false),
	regionSuggestions: () => Effect.succeed({}),
});
const os = Layer.succeed(
	SettingsOsPort,
	createSettingsOsAdapter({
		loginSupported: false,
		getLoginItemSettings: async () => ({ openAtLogin: false }),
		setLoginItemSettings: async () => {},
		workAreas: async () => [],
		managementReachable: async () => false,
	}),
);
const create = (directory: string) =>
	ManagedRuntime.make(
		Layer.mergeAll(WizardService.Default, GeneralSettingsService.Default).pipe(
			Layer.provide(
				Layer.mergeAll(owners, os, desktopSettingsStorage(directory, "de-DE")),
			),
		),
	);
describe("canonical private settings file consumed by onboarding", () => {
	it("commits one document, restarts complete, and retains unknown fields across an additive v1 migration", async () => {
		const directory = await mkdtemp(join(tmpdir(), "settings-restart-"));
		const path = join(directory, "settings-v1.json");
		await writeFile(
			path,
			JSON.stringify({
				version: 1,
				locale: "de",
				revision: 0,
				future: { preserved: true },
			}),
		);
		let runtime = create(directory);
		try {
			await runtime.runPromise(
				GeneralSettingsService.save({ startHidden: true }),
			);
			await runtime.runPromise(
				WizardService.save({
					step: "profiles",
					locale: "de",
					region: "DE",
					display: { _tag: "desktop-preview" },
					profileIds: ["local"],
				}),
			);
			await runtime.runPromise(WizardService.complete());
			await runtime.dispose();
			runtime = create(directory);
			expect(await runtime.runPromise(WizardService.snapshot())).toMatchObject({
				locale: "de",
				completed: true,
				hardwareVerified: false,
			});
			expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
				future: { preserved: true },
				general: { startHidden: true },
				wizard: { completed: true, step: "complete" },
			});
			expect(await readdir(directory)).toEqual(["settings-v1.json"]);
		} finally {
			await runtime.dispose();
			await rm(directory, { recursive: true, force: true });
		}
	});
	it.each([
		"{truncated-json",
		JSON.stringify({ version: 99, locale: "de", revision: 0 }),
		JSON.stringify({
			version: 1,
			locale: "de",
			revision: 0,
			general: { version: 1, startHidden: "corrupt" },
		}),
	])(
		"leaves corrupt or unknown-version bytes intact and surfaces a catalog failure",
		async (bytes) => {
			const directory = await mkdtemp(join(tmpdir(), "settings-corrupt-"));
			const path = join(directory, "settings-v1.json");
			await writeFile(path, bytes);
			const runtime = create(directory);
			try {
				const exit = await runtime.runPromiseExit(WizardService.snapshot());
				expect(exit._tag).toBe("Failure");
				expect(await readFile(path, "utf8")).toBe(bytes);
				expect(await readdir(directory)).toEqual(["settings-v1.json"]);
			} finally {
				await runtime.dispose();
				await rm(directory, { recursive: true, force: true });
			}
		},
	);
});
