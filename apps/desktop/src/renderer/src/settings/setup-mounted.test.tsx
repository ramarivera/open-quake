// @vitest-environment happy-dom

import { Schema } from "effect";
import { act, createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { builtinProfiles } from "../../../../../../packages/device/src/profiles/profile-catalog";
import {
	createInitialProfileEnvelope,
	encodeProfileEnvelope,
	ProfileEnvelope,
} from "../../../../../../packages/device/src/profiles/profile-contracts";
import {
	applyManagerCommand,
	installProfileCatalog,
	managerState,
} from "../../../../../../packages/device/src/profiles/profile-manager-invariants";
import {
	type AppLocaleBridge,
	type LocaleSnapshot,
	WIZARD_LANGUAGES,
} from "../../../shared/locale";
import type { SettingsBackendBridge } from "../../../shared/settings-backend";
import { App } from "../App";
import { AppLocaleProvider } from "../i18n";
import { button, click, element, mount } from "../management/dom-test";
import { PermissionGuidance } from "./PermissionGuidance";
import { SetupWizard } from "./SetupWizard";
import { SETUP_SHOWN } from "./setup-launch";
import { createSetupStore } from "./stores";
import { fakeBridge, wizard } from "./test-fixtures";

vi.mock("../keys/KeyEditor", () => ({ KeyEditor: () => null }));
vi.mock("../keys/IconPicker", () => ({ IconPickerSurface: () => null }));
beforeEach(() => {
	localStorage.clear();
	window.history.replaceState(null, "", "/");
	vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(
		function (this: HTMLDialogElement) {
			this.open = true;
		},
	);
	vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (
		this: HTMLDialogElement,
	) {
		this.open = false;
	});
});
afterEach(() => {
	Reflect.deleteProperty(window, "quakeSettings");
	Reflect.deleteProperty(window, "quakeLifecycle");
	Reflect.deleteProperty(window, "quakeProfileManager");
	vi.useRealTimers();
});
function installSettings(bridge: ReturnType<typeof fakeBridge>) {
	Object.defineProperty(window, "quakeSettings", {
		configurable: true,
		value: {
			...bridge,
			dispose: async () => {},
		} satisfies SettingsBackendBridge,
	});
}
it("MAIN-125 SETTINGS-051/052 opens offline once, leaves without completing and resumes saved progress after reload", async () => {
	const bridge = fakeBridge();
	installSettings(bridge);
	const first = await mount(createElement(App));
	expect(element(".content-inner").getAttribute("data-page")).toBe("setup");
	expect(localStorage.getItem(SETUP_SHOWN)).toBe("1");
	await click(button("Finish later"));
	expect(element(".content-inner").getAttribute("data-page")).toBe("overview");
	expect(bridge.completeWizard).not.toHaveBeenCalled();
	await first.unmount();
	await mount(createElement(App));
	expect(element(".content-inner").getAttribute("data-page")).toBe("overview");
	await click(element(".setup-resume"));
	expect(document.body.textContent).toContain("Get Started");
});
it("SETTINGS-051 explicit navigation wins a late read and completed setup never auto-opens", async () => {
	let finish: (value: ReturnType<typeof wizard>) => void = () => {};
	installSettings(
		fakeBridge({
			wizard: () =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		}),
	);
	const first = await mount(createElement(App));
	await click(element("[data-nav-page=screen]"));
	await act(async () => finish(wizard()));
	expect(element(".content-inner").getAttribute("data-page")).toBe("screen");
	expect(localStorage.getItem(SETUP_SHOWN)).toBeNull();
	await first.unmount();
	installSettings(
		fakeBridge({
			wizard: async () => wizard({ completed: true, step: "complete" }),
		}),
	);
	await mount(createElement(App));
	expect(element(".content-inner").getAttribute("data-page")).toBe("overview");
});
it("SETTINGS-053/054/056 hides welcome progress, offers legal reading and confirms region before saving", async () => {
	let saved = wizard();
	const bridge = fakeBridge({
		saveWizard: vi.fn(async (draft) => {
			saved = { ...saved, ...draft, revision: saved.revision + 1 };
			return saved;
		}),
	});
	const store = createSetupStore(bridge);
	await store.load();
	await mount(
		createElement(SetupWizard, {
			store,
			runtime: { state: "unsupported" },
			onLeave: () => {},
		}),
	);
	expect(element(".setup-steps").hasAttribute("hidden")).toBe(true);
	expect(document.body.textContent).toContain("Privacy information");
	await click(button("Get Started"));
	expect(element(".setup-steps").hasAttribute("hidden")).toBe(false);
	await click(button("China"));
	await click(button("Continue"));
	expect(document.querySelector("dialog[open]")?.textContent).toContain(
		"China",
	);
	expect(saved.region).toBeUndefined();
	await click(button("Cancel"));
	expect(document.querySelector("dialog")).toBeNull();
	expect(element(".setup").getAttribute("data-step")).toBe("locale-region");
	await click(button("Continue"));
	await click(button("Confirm"));
	expect(saved.region).toBe("CN");
	expect(element(".setup").getAttribute("data-step")).toBe("display");
});
it("MAIN-128 guides after 1500ms once without requesting any permissions", async () => {
	vi.useFakeTimers();
	const request = vi.fn();
	Object.defineProperty(window, "quakeLifecycle", {
		configurable: true,
		value: { platform: "darwin", request },
	});
	const first = await mount(createElement(PermissionGuidance, { ready: true }));
	await act(async () => vi.advanceTimersByTimeAsync(1499));
	expect(document.querySelector("aside")).toBeNull();
	await act(async () => vi.advanceTimersByTimeAsync(1));
	expect(document.body.textContent).toContain("Setup doesn't request access");
	expect(request).not.toHaveBeenCalled();
	await first.unmount();
	await mount(createElement(PermissionGuidance, { ready: true }));
	await act(async () => vi.advanceTimersByTimeAsync(2000));
	expect(document.querySelector("aside")).toBeNull();
});

it("SETTINGS-011 debug overrides completed startup only in development and reset preserves explicit preferences", async () => {
	const bridge = fakeBridge({
		wizard: async () => wizard({ completed: true, step: "complete" }),
	});
	installSettings({ ...bridge, development: true, wizardDebug: true });
	await mount(createElement(App));
	expect(bridge.replayWizard).toHaveBeenCalledOnce();
	expect(element(".content-inner").getAttribute("data-page")).toBe("setup");
	await click(button("Finish later"));
	await click(element("[data-nav-page=settings]"));
	await click(button("Reset first-run flag"));
	expect(document.body.textContent).toContain("First-run flag reset");
	expect(bridge.saveGeneral).not.toHaveBeenCalled();
});
it("SETTINGS-011 hides debug tools in production and ignores saved debug preferences", async () => {
	const { SETUP_DEBUG } = await import("./setup-launch");
	localStorage.setItem(SETUP_DEBUG, "1");
	localStorage.setItem(SETUP_SHOWN, "1");
	installSettings(fakeBridge());
	await mount(createElement(App));
	expect(element(".content-inner").getAttribute("data-page")).toBe("overview");
	await click(element("[data-nav-page=settings]"));
	expect(document.body.textContent).not.toContain(
		"Development wizard controls",
	);
});

it.each(WIZARD_LANGUAGES)(
	"SETTINGS-055 $value applies the language tile immediately, refreshes profile titles and reloads persisted locale",
	async ({ value, label }) => {
		let saved = wizard({
			step: "locale-region",
			locale: value === "en" ? "de" : "en",
		});
		let locale: LocaleSnapshot = { locale: saved.locale, revision: 1 };
		const listeners = new Set<(next: LocaleSnapshot) => void>();
		const localeBridge: AppLocaleBridge = {
			read: async () => locale,
			set: async (next) => {
				locale = { locale: next, revision: locale.revision + 1 };
				for (const receive of listeners) receive(locale);
				return locale;
			},
			subscribe: (receive) => {
				listeners.add(receive);
				return () => {
					listeners.delete(receive);
				};
			},
			dispose: async () => {},
		};
		const profiles = vi.fn<Window["quakeProfileManager"]["request"]>(
			async (command) => ({
				_tag: "success",
				view: {
					envelope: encodeProfileEnvelope({
						...createInitialProfileEnvelope(),
						profiles: Schema.validateSync(ProfileEnvelope.fields.profiles)(
							builtinProfiles(
								"darwin",
								command.type === "read" ? command.locale : "en",
							),
						),
					}),
					serials: [],
					apps: [],
					thumbnails: {},
					progress: { running: false, done: 0, total: 0, failed: 0 },
				},
			}),
		);
		Object.defineProperty(window, "quakeProfileManager", {
			configurable: true,
			value: { request: profiles },
		});
		const bridge = fakeBridge({
			wizard: async () => saved,
			saveWizard: vi.fn(async (draft) => {
				saved = { ...saved, ...draft, revision: saved.revision + 1 };
				if (draft.locale) await localeBridge.set(draft.locale);
				return saved;
			}),
		});
		const store = createSetupStore(bridge);
		await store.load();
		const renderWizard = (owner: typeof store) => (
			<AppLocaleProvider bridge={localeBridge}>
				<SetupWizard
					store={owner}
					runtime={{ state: "unsupported" }}
					onLeave={() => {}}
				/>
			</AppLocaleProvider>
		);
		const view = await mount(renderWizard(store), false);
		expect(document.body.textContent).toContain(label);
		await click(element(`input[type=radio][value=${value}]`));
		expect(saved.locale).toBe(value);
		expect(document.documentElement.lang).toBe(value);
		expect(profiles).toHaveBeenLastCalledWith({
			type: "read",
			locale: value,
			preview: true,
		});
		await act(async () => {
			await store.save({ step: "profiles" });
		});
		const title = builtinProfiles("darwin", value).find(
			(profile) => profile.id === "1-1",
		)?.name;
		expect(title).toBeTruthy();
		expect(document.body.textContent).toContain(title);
		await view.unmount();
		const reloaded = createSetupStore(bridge);
		await reloaded.load();
		await mount(renderWizard(reloaded), false);
		expect(reloaded.getState().snapshot?.locale).toBe(value);
		expect(document.documentElement.lang).toBe(value);
		expect(document.body.textContent).toContain(title);
	},
);

it("SETTINGS-054 bundles project legal documents and advances only on explicit Get Started consent", async () => {
	let saved = wizard();
	const saveWizard = vi.fn(
		async (draft: Parameters<SettingsBackendBridge["saveWizard"]>[0]) => {
			saved = {
				...saved,
				step: draft.step ?? saved.step,
				revision: saved.revision + 1,
			};
			return saved;
		},
	);
	const store = createSetupStore(fakeBridge({ saveWizard }));
	await store.load();
	await mount(
		createElement(SetupWizard, {
			store,
			runtime: { state: "unsupported" },
			onLeave: () => {},
		}),
	);
	expect(document.body.textContent).toContain(
		'By selecting "Get Started", you agree to the MIT license',
	);
	await click(button("MIT license"));
	expect(element("dialog[open]").textContent).toContain(
		"Copyright (c) 2026 Ramiro Rivera",
	);
	expect(element("dialog[open]").textContent).toContain(
		'THE SOFTWARE IS PROVIDED "AS IS"',
	);
	await click(button("Close"));
	expect(document.activeElement).toBe(button("MIT license"));
	await click(button("Privacy information"));
	expect(element("dialog[open]").textContent).toContain(
		"doesn't look up your IP location",
	);
	expect(element("dialog[open]").textContent).toContain("configured service");
	await click(button("Close"));
	await click(button("Software notice"));
	expect(element("dialog[open]").textContent).toContain(
		"Third-party dependencies",
	);
	expect(element("dialog[open]").textContent).toContain(
		"doesn't accept vendor terms",
	);
	await act(async () =>
		element("dialog").dispatchEvent(new Event("cancel", { cancelable: true })),
	);
	expect(saveWizard).not.toHaveBeenCalled();
	expect(saved.step).toBe("welcome");
	await click(button("Get Started"));
	expect(saveWizard).toHaveBeenCalledExactlyOnceWith({ step: "locale-region" });
	expect(saved.step).toBe("locale-region");
});

it.each([false, true])(
	"SETTINGS-059 seeds visibility and handles draft failure with changed-selection rejection %s",
	async (rejectChangedSelection) => {
		vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux");
		let envelope = installProfileCatalog(
			createInitialProfileEnvelope(),
			"linux",
		);
		const initial = applyManagerCommand(envelope, {
			type: "default-visibility",
			ids: ["1-1"],
		});
		if (initial._tag !== "updated") throw new Error("visibility fixture");
		envelope = initial.envelope;
		let saved = wizard({
			step: "profiles",
			display: { _tag: "desktop-preview" },
			profileIds: ["1-2"],
		});
		let release: (() => void) | undefined;
		let fail = true;
		const bridge = fakeBridge({
			wizard: async () => saved,
			saveWizard: vi.fn(async (draft) => {
				if (fail) {
					await new Promise<void>((resolve) => {
						release = resolve;
					});
					throw { code: "QUAKE.SETTINGS.PERSIST_FAILED" };
				}
				saved = { ...saved, ...draft, revision: saved.revision + 1 };
				return saved;
			}),
		});
		const request = vi.fn<Window["quakeProfileManager"]["request"]>(
			async (command) => {
				if (
					command.type === "manage" &&
					command.command.type === "default-visibility"
				) {
					const result = applyManagerCommand(envelope, command.command);
					if (result._tag !== "updated")
						throw new Error("unexpected visibility rejection");
					envelope = result.envelope;
				}
				return {
					_tag: "success",
					view: {
						envelope: encodeProfileEnvelope(envelope),
						serials: [],
						apps: [],
						thumbnails: {},
						progress: { running: false, done: 0, total: 0, failed: 0 },
					},
				};
			},
		);
		Object.defineProperty(window, "quakeProfileManager", {
			configurable: true,
			value: { request },
		});
		const store = createSetupStore(bridge);
		await store.load();
		await mount(
			createElement(SetupWizard, {
				store,
				runtime: { state: "unsupported" },
				onLeave: () => {},
			}),
		);
		const checks = () => [
			...document.querySelectorAll<HTMLInputElement>("input[type=checkbox]"),
		];
		expect(checks()).toHaveLength(9);
		expect(checks().filter((box) => box.checked)).toHaveLength(1);
		expect(checks().find((box) => box.checked)?.disabled).toBe(true);
		const hidden = checks().find((box) => !box.checked);
		if (!hidden) throw new Error("missing hidden choice");
		await click(hidden);
		expect(checks().filter((box) => box.checked)).toHaveLength(2);
		await click(button("Continue"));
		expect(button("Saving…").disabled).toBe(true);
		expect(button("Back").disabled).toBe(true);
		expect(button("Finish later").disabled).toBe(true);
		expect(
			envelope.profiles.filter(
				(p) => !managerState(envelope).hidden.includes(p.id),
			),
		).toHaveLength(3);
		await act(async () => release?.());
		expect(element(".setup").getAttribute("data-step")).toBe("profiles");
		expect(document.querySelector("[role=alert]")?.textContent).toContain(
			"Profile visibility was saved",
		);
		expect(document.querySelector("[role=alert]")?.textContent).not.toContain(
			"Nothing changed",
		);
		const committed = encodeProfileEnvelope(envelope);
		if (rejectChangedSelection) {
			const unchecked = checks().find((box) => !box.checked);
			if (!unchecked) throw new Error("Missing unchecked choice");
			await click(unchecked);
			request.mockResolvedValueOnce({
				_tag: "rejected",
				reason: "QUAKE.PROFILE.WRITE_FAILED",
			});
			await click(button("Continue"));
			expect(document.querySelectorAll("[role=alert]")).toHaveLength(1);
			expect(document.querySelector("[role=alert]")?.textContent).not.toContain(
				"visibility was saved",
			);
			expect(document.querySelector("[role=alert]")?.textContent).toContain(
				"Nothing changed",
			);
			await click(button("Back"));
			expect(element(".setup").getAttribute("data-step")).not.toBe("profiles");
			expect(document.querySelectorAll("[role=alert]")).toHaveLength(1);
			expect(document.querySelector("[role=alert]")?.textContent).not.toContain(
				"visibility was saved",
			);
			return;
		}
		fail = false;
		await click(button("Continue"));
		expect(element(".setup").getAttribute("data-step")).toBe("review");
		expect(saved.profileIds).toHaveLength(2);
		expect(encodeProfileEnvelope(envelope)).toEqual(committed);
		expect(
			request.mock.calls.filter(([command]) => command.type === "manage"),
		).toHaveLength(1);
	},
);
