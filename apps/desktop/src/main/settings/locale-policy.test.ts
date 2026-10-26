import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, ManagedRuntime } from "effect";
import { expect, it, vi } from "vitest";
import { createInitialProfileEnvelope } from "../../../../../packages/device/src/profiles/profile-contracts";
import { regionModels } from "../../../../../packages/edge/src/settings/region-invariants";
import { AppLocale } from "../../../../../packages/edge/src/settings/settings-contracts";
import { resolveAppLocale } from "../../../../../packages/edge/src/settings/settings-invariants";
import { WizardOwners } from "../../../../../packages/edge/src/settings/settings-ports";
import { SettingsRepository } from "../../../../../packages/edge/src/settings/settings-repository";
import { SettingsService } from "../../../../../packages/edge/src/settings/settings-service";
import { WizardService } from "../../../../../packages/edge/src/settings/wizard-service";
import { desktopSettingsStorage } from "./storage";
import { createWizardOwners } from "./wizard-owners";

const owners = createWizardOwners({
	deviceId: () => undefined,
	profiles: async () => createInitialProfileEnvelope(),
	runtimeSupported: () => false,
	runtimeConfigured: async () => false,
});
function runtime(directory: string, osLocale = "en-US") {
	return ManagedRuntime.make(
		Layer.mergeAll(
			WizardService.DefaultWithoutDependencies,
			SettingsService.DefaultWithoutDependencies,
		).pipe(
			Layer.provide(SettingsRepository.Default),
			Layer.provide(
				Layer.mergeAll(
					desktopSettingsStorage(directory, osLocale),
					Layer.succeed(WizardOwners, owners),
				),
			),
		),
	);
}
it.each(AppLocale.literals)(
	"SETTINGS-063/065: %s primary subtags seed only once and every saved locale survives a different OS locale",
	async (locale) => {
		const directory = await mkdtemp(join(tmpdir(), "locale-policy-"));
		let app = runtime(directory, ` ${locale.toUpperCase()}_XX `);
		try {
			expect(
				(
					await app.runPromise(
						SettingsService.use((service) => service.locale()),
					)
				).locale,
			).toBe(locale);
			await app.runPromise(
				SettingsService.use((service) => service.setLocale(locale)),
			);
			await app.dispose();
			app = runtime(directory, "pt-BR");
			expect(
				(
					await app.runPromise(
						SettingsService.use((service) => service.locale()),
					)
				).locale,
			).toBe(locale);
		} finally {
			await app.dispose();
			await rm(directory, { recursive: true, force: true });
		}
	},
);
it("SETTINGS-063: unsupported, blank and misleading prefixes fall back to English", () => {
	for (const value of ["", "pt-BR", "unknown", "deutsch", "japanese", " "])
		expect(resolveAppLocale(value)).toBe("en");
	for (const { locale, tag } of [
		{ locale: "zh", tag: "ZH-Hant-TW" },
		{ locale: "fr", tag: " fr_CA " },
		{ locale: "ja", tag: "ja-JP" },
	] as const)
		expect(resolveAppLocale(tag)).toBe(locale);
});
it("AI-015 SETTINGS-065/098/099: real wizard owner offers local independent recommendations and preserves choices across region changes/restart", async () => {
	const directory = await mkdtemp(join(tmpdir(), "region-policy-"));
	const path = join(directory, "settings-v1.json");
	const aiConfig = {
		aiEngineProvider: "QWen",
		aiEngineProviderUserChosen: true,
		speechEngineType: "Azure",
		speechTtsModel: "my-voice",
		liveTranslateModel: "my-live",
		globalAIWakeKey: "Alt+Y",
	};
	await writeFile(
		path,
		JSON.stringify({ version: 1, locale: "ja", revision: 2, aiConfig }),
	);
	const fetch = vi.fn(() => Promise.reject(new Error("No network")));
	vi.stubGlobal("fetch", fetch);
	let app = runtime(directory, "de-DE");
	try {
		for (const region of ["CN", "DE", "CN"]) {
			const view = await app.runPromise(
				WizardService.save({ step: "locale-region", region }),
			);
			expect(view.suggestions).toEqual(
				region === "CN"
					? { provider: "DeepSeek", speech: "QWen" }
					: { provider: "OpenAI", speech: "OpenAI" },
			);
			expect(view.locale).toBe("ja");
			expect(JSON.parse(await readFile(path, "utf8")).aiConfig).toEqual(
				aiConfig,
			);
		}
		expect(regionModels("CN")).toEqual({
			chat: "deepseek-v4-flash",
			stt: "qwen-audio-3.1-asr-flash-streaming",
			tts: "qwen-audio-3.1-tts-flash",
			liveTranslation: "qwen3.5-livetranslate-flash-realtime",
		});
		expect(regionModels("DE")).toEqual({
			chat: "gpt-5.1",
			stt: "gpt-4o-transcribe",
			tts: "gpt-4o-mini-tts",
			liveTranslation: "gpt-4o-transcribe",
		});
		expect(await Effect.runPromise(owners.regionSuggestions(""))).toEqual({});
		expect(regionModels("unknown")).toBeUndefined();
		await app.dispose();
		app = runtime(directory);
		expect(
			(await app.runPromise(WizardService.snapshot())).suggestions,
		).toEqual({ provider: "DeepSeek", speech: "QWen" });
		expect(JSON.parse(await readFile(path, "utf8")).aiConfig).toEqual(aiConfig);
		expect(fetch).not.toHaveBeenCalled();
	} finally {
		vi.unstubAllGlobals();
		await app.dispose();
		await rm(directory, { recursive: true, force: true });
	}
});
it.each([
	{
		region: "CN",
		seeded: true,
		userChosen: false,
		provider: "QWen",
		expected: "DeepSeek",
	},
	{
		region: "CN",
		seeded: true,
		userChosen: true,
		provider: "QWen",
		expected: "QWen",
	},
	{
		region: "CN",
		seeded: false,
		userChosen: false,
		provider: "QWen",
		expected: "QWen",
	},
	{
		region: "US",
		seeded: true,
		userChosen: false,
		provider: "QWen",
		expected: "QWen",
	},
	{
		region: "",
		seeded: true,
		userChosen: false,
		provider: "QWen",
		expected: "QWen",
	},
	{
		region: "CN",
		seeded: true,
		userChosen: false,
		provider: "Kimi",
		expected: "Kimi",
	},
])(
	"AI-015 SETTINGS-098: migrate only an attributable legacy default $region $seeded $userChosen $provider",
	async ({ region, seeded, userChosen, provider, expected }) => {
		const directory = await mkdtemp(join(tmpdir(), "legacy-region-"));
		const path = join(directory, "settings-v1.json");
		await writeFile(
			path,
			JSON.stringify({
				version: 1,
				locale: "en",
				revision: 0,
				system: { deviceLocationInfo: { country_code: region } },
				aiConfig: {
					aiEngineProvider: provider,
					aiEngineProviderSeededFromGeo: seeded,
					aiEngineProviderUserChosen: userChosen,
				},
			}),
		);
		let app = runtime(directory);
		try {
			await app.runPromise(SettingsService.use((service) => service.locale()));
			const first = await readFile(path, "utf8");
			expect(JSON.parse(first).aiConfig.aiEngineProvider).toBe(expected);
			await app.dispose();
			app = runtime(directory);
			await app.runPromise(SettingsService.use((service) => service.locale()));
			expect(await readFile(path, "utf8")).toBe(first);
		} finally {
			await app.dispose();
			await rm(directory, { recursive: true, force: true });
		}
	},
);
it("SETTINGS-111: selective bootstrap removes exactly transient legacy keys once and preserves durable unknown fields and explicit defaults", async () => {
	const directory = await mkdtemp(join(tmpdir(), "bootstrap-locale-"));
	const path = join(directory, "settings-v1.json");
	const original = {
		version: 1,
		locale: "fr",
		revision: 4,
		currentSelectedDevice: "stale",
		mainscreen: { deviceName: "old", theme: "keep" },
		serverPorts: {
			pluginWSServerPort: 1,
			viaPluginPort: 2,
			pluginWebPageServerPort: 3,
			customPort: 4,
		},
		system: {
			upgradeInfo: { path: "stale" },
			openAsHidden: true,
			locale: "zh",
			durable: "keep",
		},
		aiConfig: { globalAIWakeKey: "Alt+Y", speechEngineType: "Azure" },
		future: { keep: true },
	};
	await writeFile(path, JSON.stringify(original));
	let app = runtime(directory);
	try {
		expect(
			(await app.runPromise(SettingsService.use((service) => service.locale())))
				.locale,
		).toBe("fr");
		const migrated = JSON.parse(await readFile(path, "utf8"));
		expect(migrated).toEqual({
			version: 1,
			locale: "fr",
			revision: 4,
			bootstrapVersion: 1,
			mainscreen: { theme: "keep" },
			serverPorts: { customPort: 4 },
			system: { openAsHidden: true, locale: "zh", durable: "keep" },
			aiConfig: original.aiConfig,
			future: original.future,
			general: { version: 1, launchAtLogin: false, startHidden: true },
		});
		const before = (await stat(path)).mtimeMs;
		await app.dispose();
		app = runtime(directory);
		await app.runPromise(SettingsService.use((service) => service.locale()));
		expect((await stat(path)).mtimeMs).toBe(before);
	} finally {
		await app.dispose();
		await rm(directory, { recursive: true, force: true });
	}
});

it("SETTINGS-111: an unknown legacy container survives bootstrap without destructive coercion", async () => {
	const directory = await mkdtemp(join(tmpdir(), "legacy-container-"));
	const path = join(directory, "settings-v1.json");
	await writeFile(
		path,
		JSON.stringify({
			version: 1,
			locale: "en",
			revision: 0,
			aiConfig: "future-format",
			system: ["preserve"],
		}),
	);
	const app = runtime(directory);
	try {
		await app.runPromise(SettingsService.use((service) => service.locale()));
		expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
			aiConfig: "future-format",
			system: ["preserve"],
			bootstrapVersion: 1,
		});
	} finally {
		await app.dispose();
		await rm(directory, { recursive: true, force: true });
	}
});
