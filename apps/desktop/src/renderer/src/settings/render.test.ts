import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type AppLocaleBridge, useAppTranslations } from "../i18n";
import { GeneralSettings } from "./GeneralSettings";
import { SettingsRenderFixture } from "./render-fixture";
import {
	DisplayStep,
	ProfilesStep,
	SetupResumeEntry,
	SetupWizard,
} from "./SetupWizard";
import { initialChoices } from "./setup-model";
import type { RuntimeChoice } from "./setup-owners";
import { createSetupStore, type SetupStore } from "./stores";
import strings from "./strings.json";
import { fakeBridge, wizard } from "./test-fixtures";

afterEach(() => vi.unstubAllGlobals());

/** The app locale is still being read, as on first paint in the app. */
const reading: AppLocaleBridge = {
	read: () => new Promise(() => {}),
	set: () => new Promise(() => {}),
	subscribe: () => () => {},
	dispose: async () => {},
};
function render(
	locale: "en" | "de",
	node: ReactNode,
	app: AppLocaleBridge | null = reading,
): string {
	return renderToStaticMarkup(
		createElement(SettingsRenderFixture, { app, locale, node }),
	);
}
/** Renders a step part with the real translations. */
function Step({
	part,
}: {
	part: (t: ReturnType<typeof useAppTranslations>) => ReactNode;
}): ReactNode {
	return part(useAppTranslations("settings"));
}
const wizardFor = (
	store: SetupStore,
	runtime: RuntimeChoice = { state: "supported" },
) => createElement(SetupWizard, { store, runtime, onLeave: () => {} });
async function loaded(
	snapshot: ReturnType<typeof wizard>,
): Promise<SetupStore> {
	const store = createSetupStore(
		fakeBridge({ wizard: vi.fn(async () => snapshot) }),
	);
	await store.load();
	return store;
}
const keys = (value: unknown, prefix = ""): string[] =>
	typeof value === "object" && value !== null
		? Object.entries(value).flatMap(([key, child]) =>
				keys(child, `${prefix}.${key}`),
			)
		: [prefix];

describe("bundled settings copy", () => {
	it("has the same keys in English and German", () => {
		expect(keys(strings.de)).toEqual(keys(strings.en));
		expect(keys(strings.en)).toContain(".setup.orientation.title");
	});
});

describe("setup rendering", () => {
	it("shows a truthful unavailable state without a bridge", () => {
		const store = createSetupStore(undefined);
		const en = render("en", wizardFor(store));
		expect(en).toContain("Setup isn’t available in this window");
		expect(en).toContain("Go to Overview");
		expect(en).not.toContain("Try again");
		expect(render("de", wizardFor(store))).toContain(
			"Die Einrichtung ist in diesem Fenster nicht verfügbar",
		);
	});

	it("offers a retry after a failed read", async () => {
		const store = createSetupStore(
			fakeBridge({ wizard: vi.fn(() => Promise.reject(new Error("x"))) }),
		);
		await store.load();
		const html = render("en", wizardFor(store));
		expect(html).toContain("Setup progress couldn’t be read");
		expect(html).toContain("Try again");
	});

	it("announces loading before the snapshot arrives", () => {
		const store = createSetupStore(fakeBridge());
		expect(render("en", wizardFor(store))).toMatch(
			/role="status"[^>]*>Loading setup…/,
		);
	});

	it("resumes at the saved step with progress, rail state and actions", async () => {
		const store = await loaded(
			wizard({ step: "locale-region", locale: "de", region: "DE" }),
		);
		const html = render("de", wizardFor(store));
		expect(html).toContain("Schritt 2 von 6");
		expect(html).toContain("Sprache und Region");
		expect(html).toMatch(/aria-current="step"/);
		expect(html.match(/aria-current="step"/g)).toHaveLength(1);
		expect(html).toContain("Zurück");
		expect(html).toContain("Weiter");
		expect(html).toContain("Später fortsetzen");
		// Region names come from bundled ICU data and the saved region is selected.
		expect(html).toMatch(
			/<option value="DE" selected="">Deutschland<\/option>/,
		);
		expect(html).toContain("Gespeicherte Region");
	});

	it("omits the runtime step when the root does not support it", async () => {
		const store = await loaded(wizard({ step: "display" }));
		const html = render("en", wizardFor(store, { state: "unsupported" }));
		expect(html).toContain("Step 3 of 5");
		expect(html).not.toContain("Agent runtime");
	});

	it("labels desktop preview as hardware-unverified and waits for the device read", async () => {
		const store = await loaded(wizard({ step: "display" }));
		const html = render("en", wizardFor(store));
		expect(html).toContain("Desktop preview");
		expect(html).toContain("Hardware not verified");
		expect(html).toContain("Looking for a QUAKE…");
		// Continue stays disabled until a usable display is chosen.
		expect(html).toMatch(
			/<button type="button" class="mc-button" data-primary="true" disabled="">Continue/,
		);
	});

	it("shows a completed record with an explicit replay and no hardware claim", async () => {
		const store = await loaded(
			wizard({
				step: "complete",
				completed: true,
				localeConfirmed: true,
				region: "US",
				display: { _tag: "desktop-preview" },
				profileIds: ["a"],
				runtime: "skipped",
			}),
		);
		const html = render("en", wizardFor(store));
		expect(html).toContain("Setup complete");
		expect(html).toContain("Run setup again");
		expect(html).toContain("Setup doesn’t verify hardware");
		expect(html).toContain("United States");
		expect(html).toContain("Skipped");
		expect(html).not.toContain("Finish setup");
	});
});

describe("setup review fixes", () => {
	it("shows the app-wide language once read, not the wizard's stale copy", async () => {
		// Without a locale bridge the provider knows English is applied.
		const store = await loaded(
			wizard({ step: "locale-region", locale: "de", region: "DE" }),
		);
		const html = render("en", wizardFor(store), null);
		expect(html).toMatch(/checked="" value="en"/);
		expect(html).not.toMatch(/checked="" value="de"/);
		expect(html).toMatch(/<option value="DE" selected="">Germany<\/option>/);
	});

	const choices = initialChoices(wizard(), "US");
	const profiles = (
		state: Parameters<typeof ProfilesStep>[0]["profiles"],
		locale: "en" | "de" = "en",
	) =>
		render(
			locale,
			createElement(Step, {
				part: (t) =>
					createElement(ProfilesStep, {
						t,
						choices,
						setChoices: () => {},
						profiles: state,
						busy: false,
						onRetry: () => {},
					}),
			}),
		);

	it("offers a retry when the profile read fails, not when there is no owner", () => {
		const failed = profiles({ state: "failed" });
		expect(failed).toContain("Profiles couldn’t be loaded.");
		expect(failed).toMatch(/<button type="button" class="mc-button">Try again/);
		expect(profiles({ state: "failed" }, "de")).toContain("Erneut versuchen");
		expect(profiles({ state: "unavailable" })).not.toContain("Try again");
	});

	it("says choosing a profile doesn't change the active one", () => {
		const ready = {
			state: "ready",
			profiles: [{ id: "a", name: "Default" }],
			active: { "desktop-preview": "a" },
		} as const;
		const en = profiles(ready);
		expect(en).toContain("doesn’t create profiles or change the active one");
		expect(en).toMatch(/aria-describedby="[^"]*-note [^"]*-count"/);
		expect(profiles(ready, "de")).toContain("ändert das aktive Profil nicht");
	});

	it("reads orientation copy through the settings feature translator", () => {
		const html = render(
			"de",
			createElement(DisplayStep, {
				t: (key) => `translated ${key}`,
				choices,
				setChoices: () => {},
				devices: { state: "connected", serial: "QK-A", mock: true },
				busy: false,
				onCheckDevices: () => {},
			}),
		);
		expect(html).toContain("translated setup.orientation.title");
		expect(html).toContain("translated setup.orientation.portrait");
		expect(html).toContain("translated setup.orientation.unknown");
	});

	it("can check again while a QUAKE is connected, so a swapped device appears", () => {
		const display = (devices: Parameters<typeof DisplayStep>[0]["devices"]) =>
			render(
				"en",
				createElement(Step, {
					part: (t) =>
						createElement(DisplayStep, {
							t,
							choices,
							setChoices: () => {},
							devices,
							busy: false,
							onCheckDevices: () => {},
						}),
				}),
			);
		expect(
			display({ state: "connected", serial: "QK-A", mock: false }),
		).toContain("Check again");
		expect(display({ state: "offline" })).toContain("Check again");
		expect(display({ state: "unavailable" })).not.toContain("Check again");
		expect(display(null)).not.toContain("Check again");
	});
});

describe("setup entry points", () => {
	it("shows Resume setup only while incomplete", async () => {
		const entry = (store: SetupStore, current = false) =>
			createElement(SetupResumeEntry, {
				store,
				runtime: { state: "supported" },
				current,
				onOpen: () => {},
			});
		const incomplete = await loaded(wizard({ step: "profiles" }));
		expect(render("en", entry(incomplete))).toContain("Step 4 of 6");
		expect(render("de", entry(incomplete))).toContain("Einrichtung fortsetzen");
		expect(render("en", entry(incomplete, true))).toBe("");
		const complete = await loaded(
			wizard({ step: "complete", completed: true }),
		);
		expect(render("en", entry(complete))).toBe("");
		expect(render("en", entry(createSetupStore(undefined)))).toBe("");
	});

	it("keeps General usable without the settings bridge", () => {
		const html = render(
			"en",
			createElement(GeneralSettings, {
				setup: createSetupStore(undefined),
				onOpenSetup: () => {},
				bridge: undefined,
			}),
		);
		expect(html).toContain("Language");
		expect(html).toContain(
			"Startup preferences aren’t available in this window.",
		);
		expect(html).toContain("Setup isn’t available in this window.");
		expect(html).not.toContain('type="checkbox"');
	});

	it("disables login and background controls until preferences load", () => {
		const html = render(
			"de",
			createElement(GeneralSettings, {
				setup: createSetupStore(fakeBridge()),
				onOpenSetup: () => {},
				bridge: fakeBridge(),
			}),
		);
		expect(html).toContain("Bei Anmeldung öffnen");
		expect(html).toContain("Im Hintergrund starten");
		expect(html.match(/type="checkbox"[^>]*disabled=""/g)).toHaveLength(2);
	});
});
