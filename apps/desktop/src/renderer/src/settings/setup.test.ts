import assert from "node:assert/strict";
import { Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import { builtinProfiles } from "../../../../../../packages/device/src/profiles/profile-catalog";
import { encodeProfileEnvelope } from "../../../../../../packages/device/src/profiles/profile-contracts";
import { installProfileCatalog } from "../../../../../../packages/device/src/profiles/profile-manager-invariants";
import type {
	AgentConnectionsBridge,
	AgentConnectionView,
} from "../../../shared/agent-connections";
import type {
	ProfileBridge,
	ProfileReply,
} from "../../../shared/profile-manager";
import {
	type GeneralSnapshot,
	settingsFailure,
	type WizardSnapshot,
} from "./bridge";
import { REGION_CODES, regionFromLocale } from "./regions";
import {
	canContinue,
	continueDraft,
	initialChoices,
	profileDefaults,
	resumeStep,
	setupSteps,
} from "./setup-model";
import { readDisplay, readProfiles, runtimeChoice } from "./setup-owners";
import { createGeneralStore, createSetupStore } from "./stores";
import { fakeBridge, general, wizard } from "./test-fixtures";

const denied = {
	_tag: "SettingsOsApplyFailed",
	code: "QUAKE.SETTINGS.OS_APPLY_FAILED",
	reason: "denied",
};

describe("failure classification", () => {
	it("branches on catalog code and reason, never on message text", () => {
		expect(settingsFailure(denied)).toEqual({
			code: "QUAKE.SETTINGS.OS_APPLY_FAILED",
			reason: "denied",
		});
		expect(
			settingsFailure({ code: "QUAKE.WIZARD.INCOMPLETE", reason: "denied" }),
		).toEqual({ code: "QUAKE.WIZARD.INCOMPLETE" });
		// contextBridge strips custom Error fields; only the text would remain.
		expect(
			settingsFailure(new Error("The settings could not be saved")),
		).toEqual({ code: "unknown" });
		expect(settingsFailure({ code: "QUAKE.OTHER" })).toEqual({
			code: "unknown",
		});
		expect(settingsFailure(undefined)).toEqual({ code: "unknown" });
	});
});

describe("setup store", () => {
	it("is unavailable without a bridge and performs no calls", async () => {
		const store = createSetupStore(undefined);
		expect(await store.load()).toBe(false);
		expect(store.getState().status).toBe("unavailable");
	});

	it("allows one request at a time so a double submit cannot write twice", async () => {
		let release = (): void => {};
		const bridge = fakeBridge({
			saveWizard: vi.fn(
				() =>
					new Promise<WizardSnapshot>((done) => {
						release = () => done(wizard({ revision: 2, step: "display" }));
					}),
			),
		});
		const store = createSetupStore(bridge);
		await store.load();
		const first = store.save({ step: "display", locale: "en", region: "US" });
		expect(store.getState().pending).toBe("save");
		expect(await store.save({ step: "display" })).toBe(false);
		release();
		expect(await first).toBe(true);
		expect(bridge.saveWizard).toHaveBeenCalledTimes(1);
		expect(store.getState().snapshot?.step).toBe("display");
	});

	it("keeps the last snapshot and stays incomplete when completion fails", async () => {
		const bridge = fakeBridge({
			wizard: vi.fn(async () => wizard({ revision: 4, step: "runtime" })),
			completeWizard: vi.fn(async () => {
				throw { code: "QUAKE.SETTINGS.PERSIST_FAILED" };
			}),
		});
		const store = createSetupStore(bridge);
		await store.load();
		expect(await store.complete()).toBe(false);
		expect(store.getState()).toMatchObject({
			status: "ready",
			pending: null,
			failure: { code: "QUAKE.SETTINGS.PERSIST_FAILED" },
			snapshot: { completed: false, revision: 4 },
		});
	});

	it("ignores a late reply older than the snapshot already shown", async () => {
		const bridge = fakeBridge({
			wizard: vi.fn(async () => wizard({ revision: 9, locale: "de" })),
			saveWizard: vi.fn(async () => wizard({ revision: 3 })),
		});
		const store = createSetupStore(bridge);
		await store.load();
		await store.save({ step: "locale-region" });
		expect(store.getState().snapshot).toMatchObject({
			revision: 9,
			locale: "de",
		});
	});

	it("reports a failed first read without inventing progress", async () => {
		const store = createSetupStore(
			fakeBridge({ wizard: vi.fn(() => Promise.reject(new Error("gone"))) }),
		);
		await store.load();
		expect(store.getState()).toMatchObject({
			status: "failed",
			snapshot: null,
			failure: { code: "unknown" },
		});
	});
});

describe("general store", () => {
	it("shows the OS readback, not saved intent, after a denied login write", async () => {
		const loginStatus = vi.fn(async () => false);
		const bridge = fakeBridge({
			loginStatus,
			general: vi
				.fn<() => Promise<GeneralSnapshot>>()
				.mockResolvedValueOnce(general())
				.mockResolvedValue(general({ revision: 2, launchAtLogin: true })),
			saveGeneral: vi.fn(() => Promise.reject(denied)),
		});
		const store = createGeneralStore(bridge);
		await store.load();
		expect(await store.set("launchAtLogin", true)).toBe(false);
		expect(bridge.saveGeneral).toHaveBeenCalledWith({ launchAtLogin: true });
		expect(store.getState()).toMatchObject({
			snapshot: { launchAtLogin: true },
			login: { status: "known", enabled: false },
			pending: null,
			failure: {
				field: "launchAtLogin",
				failure: { code: "QUAKE.SETTINGS.OS_APPLY_FAILED", reason: "denied" },
			},
		});
		expect(loginStatus).toHaveBeenCalledTimes(2);
	});

	it("doesn't let an older reload overwrite a newer OS readback or refusal", async () => {
		let release = (_value: boolean): void => {};
		const loginStatus = vi
			.fn<() => Promise<boolean>>()
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						release = resolve;
					}),
			)
			.mockResolvedValue(true);
		const bridge = fakeBridge({ loginStatus });
		const store = createGeneralStore(bridge);
		const oldLoad = store.load();
		await store.load();
		expect(store.getState().login).toEqual({ status: "known", enabled: true });
		release(false);
		await oldLoad;
		expect(store.getState().login).toEqual({ status: "known", enabled: true });
	});

	it("rechecks login only for login changes", async () => {
		const bridge = fakeBridge({
			saveGeneral: vi.fn(async () =>
				general({ revision: 2, startHidden: true }),
			),
		});
		const store = createGeneralStore(bridge);
		await store.load();
		expect(await store.set("startHidden", true)).toBe(true);
		expect(bridge.saveGeneral).toHaveBeenCalledWith({ startHidden: true });
		expect(bridge.loginStatus).toHaveBeenCalledTimes(1);
		expect(store.getState().snapshot?.startHidden).toBe(true);
	});

	it("keeps an unknown login status distinct from off", async () => {
		const store = createGeneralStore(
			fakeBridge({
				general: vi.fn(async () => general({ launchAtLogin: true })),
				loginStatus: vi.fn(() =>
					Promise.reject({
						code: "QUAKE.SETTINGS.OS_APPLY_FAILED",
						reason: "timeout",
					}),
				),
			}),
		);
		await store.load();
		expect(store.getState().login).toEqual({
			status: "unknown",
			failure: { code: "QUAKE.SETTINGS.OS_APPLY_FAILED", reason: "timeout" },
		});
	});

	it("never calls the bridge on construction", () => {
		const bridge = fakeBridge();
		createGeneralStore(bridge);
		createSetupStore(bridge);
		for (const call of Object.values(bridge))
			expect(call).not.toHaveBeenCalled();
	});
});

const unsupported = { state: "unsupported" } as const;
const supported = { state: "supported" } as const;
const configured = { state: "configured", count: 1 } as const;

describe("setup model", () => {
	const connected = { state: "connected", serial: "QK-1", mock: true } as const;
	const profiles = {
		state: "ready",
		profiles: [
			{ id: "a", name: "Default" },
			{ id: "b", name: "Meet AI" },
		],
		active: { "desktop-preview": "a", "QK-1": "b" },
	} as const;

	it("includes the runtime step only while the root supports it", () => {
		expect(setupSteps(unsupported)).not.toContain("runtime");
		expect(setupSteps(supported)).toContain("runtime");
		expect(setupSteps(configured).at(-1)).toBe("review");
	});

	it("resumes where an incomplete record stopped", () => {
		const withRuntime = setupSteps(supported);
		const without = setupSteps(unsupported);
		expect(resumeStep(wizard({ step: "display" }), without)).toBe("display");
		expect(resumeStep(wizard({ step: "runtime" }), withRuntime)).toBe(
			"runtime",
		);
		expect(resumeStep(wizard({ step: "runtime" }), without)).toBe("review");
		expect(
			resumeStep(wizard({ step: "runtime", runtime: "skipped" }), withRuntime),
		).toBe("review");
		expect(
			resumeStep(wizard({ step: "complete", completed: true }), withRuntime),
		).toBe("review");
	});

	it("saves the explicit locale with the region and never creates profiles", () => {
		const choices = initialChoices(wizard({ locale: "de" }), "DE");
		expect(continueDraft("locale-region", choices, "de")).toEqual({
			step: "display",
			locale: "de",
			region: "DE",
		});
		expect(
			continueDraft("profiles", { ...choices, profileIds: ["a"] }, "de"),
		).toEqual({ step: "runtime", profileIds: ["a"] });
		expect(
			continueDraft("runtime", { ...choices, runtime: "skipped" }, "de"),
		).toEqual({ step: "runtime", runtime: "skipped" });
	});

	it("prefers saved choices over OS suggestions", () => {
		expect(initialChoices(wizard({ region: "AR" }), "US").region).toBe("AR");
		expect(initialChoices(wizard(), null).region).toBe("");
	});

	it("only continues from Display with a connected QUAKE or explicit preview", () => {
		const base = initialChoices(wizard(), "US");
		const at = (display: Parameters<typeof canContinue>[1]["display"]) =>
			canContinue(
				"display",
				{ ...base, display },
				connected,
				profiles,
				supported,
			);
		expect(at(null)).toBe(false);
		expect(at({ _tag: "desktop-preview" })).toBe(true);
		expect(at({ _tag: "quake", deviceId: "QK-1" })).toBe(true);
		expect(at({ _tag: "quake", deviceId: "QK-2" })).toBe(false);
		expect(
			canContinue(
				"display",
				{ ...base, display: { _tag: "quake", deviceId: "QK-1" } },
				{ state: "offline" },
				profiles,
				supported,
			),
		).toBe(false);
	});

	it("needs a usable profile and offers a configured runtime only with a saved selection", () => {
		const base = initialChoices(wizard(), "US");
		expect(canContinue("profiles", base, connected, profiles, supported)).toBe(
			false,
		);
		expect(
			canContinue(
				"profiles",
				{ ...base, profileIds: ["gone"] },
				connected,
				profiles,
				configured,
			),
		).toBe(false);
		expect(
			canContinue(
				"profiles",
				{ ...base, profileIds: ["b"] },
				connected,
				profiles,
				configured,
			),
		).toBe(true);
		expect(
			canContinue(
				"profiles",
				{ ...base, profileIds: ["b", "gone"] },
				connected,
				profiles,
				configured,
			),
		).toBe(false);
		const chosen = { ...base, runtime: "configured" } as const;
		expect(canContinue("runtime", chosen, connected, profiles, supported)).toBe(
			false,
		);
		expect(
			canContinue("runtime", chosen, connected, profiles, configured),
		).toBe(true);
		expect(
			canContinue(
				"runtime",
				{ ...base, runtime: "skipped" },
				connected,
				profiles,
				supported,
			),
		).toBe(true);
	});

	it("preselects existing saved profiles, else the display's active profile", () => {
		expect(profileDefaults(["b", "gone"], profiles, null)).toEqual(["b"]);
		expect(profileDefaults([], profiles, { _tag: "desktop-preview" })).toEqual([
			"a",
		]);
		expect(
			profileDefaults([], profiles, { _tag: "quake", deviceId: "QK-1" }),
		).toEqual(["b"]);
		expect(profileDefaults(["x"], { state: "failed" }, null)).toEqual(["x"]);
	});
});

describe("owner reads", () => {
	it("maps the hardware owner's read without any other request", async () => {
		const request = vi.fn(async () => ({
			_tag: "ready",
			mock: true,
			snapshot: {
				serial: "QK-1",
				available: true,
				preferenceStatus: "saved",
				session: "s1",
				preferences: {
					knobLedAlwaysOn: true,
					buzzerEnabled: true,
					alertVolume: 84,
				},
				inputMode: "device",
			},
		}));
		expect(await readDisplay({ request })).toEqual({
			state: "connected",
			serial: "QK-1",
			mock: true,
		});
		expect(request).toHaveBeenCalledExactlyOnceWith({ _tag: "read" });
		expect(
			await readDisplay({ request: async () => ({ _tag: "offline" }) }),
		).toEqual({
			state: "offline",
		});
		expect(
			await readDisplay({ request: async () => ({ nonsense: 1 }) }),
		).toEqual({
			state: "failed",
		});
		expect(
			await readDisplay({ request: () => Promise.reject(new Error("ipc")) }),
		).toEqual({ state: "failed" });
		expect(await readDisplay(undefined)).toEqual({ state: "unavailable" });
	});

	it("reads profiles as a preview with the manager's visibility rule", async () => {
		const [first, ...rest] = builtinProfiles("darwin");
		assert(first);
		// The real catalog install hides 1-0 on macOS.
		const envelope = installProfileCatalog(
			{
				schemaVersion: 1,
				manager: Option.none(),
				profiles: [first, ...rest],
				activeByDevice: {
					"desktop-preview": { profileId: "1-1", pageId: "p" },
				},
			},
			"darwin",
		);
		const reply: ProfileReply = {
			_tag: "success",
			view: {
				envelope: encodeProfileEnvelope(envelope),
				serials: [],
				apps: [],
				thumbnails: {},
				progress: { running: false, done: 0, total: 0, failed: 0 },
			},
		};
		const request = vi.fn(async () => reply);
		const bridge = { request } as unknown as ProfileBridge;
		const read = await readProfiles(bridge, "de");
		assert(read.state === "ready");
		expect(read.profiles.map((profile) => profile.id)).not.toContain("1-0");
		expect(read.profiles).toHaveLength(rest.length);
		expect(read.active).toEqual({ "desktop-preview": "1-1" });
		expect(request).toHaveBeenCalledExactlyOnceWith({
			type: "read",
			locale: "de",
			preview: true,
		});
		const corrupt = {
			...reply,
			view: { ...reply.view, envelope: { schemaVersion: 2 } },
		} as unknown as ProfileReply;
		expect(
			await readProfiles(
				{ request: async () => corrupt } as unknown as ProfileBridge,
				"en",
			),
		).toEqual({ state: "failed" });
	});

	it("treats any saved connection as configured, never selection or health", () => {
		const bridge = {
			request: vi.fn(),
			onSnapshot: vi.fn(),
		} as unknown as AgentConnectionsBridge;
		const connection = {
			id: "c1",
			name: "Hermes",
			kind: "hermes",
			baseURL: "http://127.0.0.1:1/v1",
			credentialAvailable: false,
		};
		const view = (count: number) =>
			({
				revision: 1,
				cleanupPending: false,
				connections: Array.from({ length: count }, () => connection),
			}) as unknown as AgentConnectionView;
		expect(runtimeChoice(undefined, view(1))).toEqual({ state: "unsupported" });
		expect(runtimeChoice(bridge, null)).toEqual({ state: "supported" });
		expect(runtimeChoice(bridge, view(0))).toEqual({ state: "supported" });
		expect(runtimeChoice(bridge, view(2))).toEqual({
			state: "configured",
			count: 2,
		});
		expect(bridge.request).not.toHaveBeenCalled();
	});

	it("suggests a region from the OS locale offline", () => {
		expect(REGION_CODES).toHaveLength(249);
		expect(regionFromLocale("en-US")).toBe("US");
		expect(regionFromLocale("de")).toBe("DE");
		expect(regionFromLocale("not a locale")).toBeNull();
		expect(regionFromLocale(undefined)).toBeNull();
	});
});
