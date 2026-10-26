// @vitest-environment happy-dom
import { act, createElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import {
	INITIAL_WIZARD,
	type WizardSnapshot,
} from "../../../../../../packages/edge/src/settings/wizard-contracts";
import type {
	ConnectionDiagnostic,
	LifecycleBridge,
} from "../../../shared/lifecycle-contracts";
import type { SettingsBackendBridge } from "../../../shared/settings-backend";
import { App } from "../App";
import { click, element, mount } from "./dom-test";

vi.mock("../keys/KeyEditor", () => ({ KeyEditor: () => null }));
vi.mock("../keys/IconPicker", () => ({ IconPickerSurface: () => null }));
const failed: ConnectionDiagnostic = {
	usb: "fail",
	hdmi: "fail",
	checking: false,
	mock: false,
	width: 0,
	height: 0,
	resolutionMismatch: false,
	issue: "none",
};
let receive: LifecycleBridge["onStatus"] extends (listener: infer T) => unknown
	? T
	: never;
beforeEach(() => {
	window.history.replaceState(null, "", "/?page=connection");
	Object.defineProperty(window, "quakeLifecycle", {
		configurable: true,
		value: {
			request: async () => ({ ok: true, status: failed }),
			onStatus: (listener) => {
				receive = listener;
				return () => {};
			},
			displaySettingsAvailable: false,
			layoutRepairAvailable: false,
		} satisfies LifecycleBridge,
	});
});

it("MGMT-023/027/036 enters on both channels, ignores duplicate hotplug passes, recovers on loss and permits preview", async () => {
	await mount(createElement(App));
	const page = () => element(".content-inner").getAttribute("data-page");
	expect(page()).toBe("connection");
	await act(async () => receive({ ...failed, usb: "pass" }));
	expect(page()).toBe("connection");
	const pass: ConnectionDiagnostic = {
		...failed,
		usb: "pass",
		hdmi: "pass",
		width: 1920,
		height: 480,
	};
	await act(async () => receive(pass));
	expect(page()).toBe("screen");
	const screen = element(".content-inner");
	await act(async () => {
		receive(pass);
		receive({ ...pass });
	});
	expect(element(".content-inner")).toBe(screen);
	expect(page()).toBe("screen");
	await act(async () => receive(failed));
	expect(page()).toBe("connection");
	await click(element("[data-nav-page=screen]"));
	expect(page()).toBe("screen");
	await act(async () => receive({ ...failed }));
	expect(page()).toBe("screen");
});

it("MGMT-013/020/025/048 opens Agents and Settings through visible navigation in the same shell", async () => {
	await mount(createElement(App));
	const shell = element(".management-window");
	const titlebar = element(".mc-titlebar");
	await click(element("[data-nav-page=agents]"));
	expect(element(".content-inner").getAttribute("data-page")).toBe("agents");
	expect(document.querySelector(".agent-workbench")).not.toBeNull();
	await click(element("[data-nav-page=settings]"));
	expect(document.querySelector(".maintenance-settings")).not.toBeNull();
	expect(document.body.textContent).toContain("General");
	expect(document.body.textContent).toContain("Settings");
	expect(element(".management-window")).toBe(shell);
	expect(element(".mc-titlebar")).toBe(titlebar);
});

it("MGMT-026 keeps an explicit no-device preview when the startup setup read completes late", async () => {
	let finish: (snapshot: WizardSnapshot) => void = () => {};
	const wizard = vi.fn(
		() =>
			new Promise<WizardSnapshot>((resolve) => {
				finish = resolve;
			}),
	);
	const unavailable = async (): Promise<never> => {
		throw new Error("Unused owner operation");
	};
	const bridge: SettingsBackendBridge = {
		wizard,
		general: unavailable,
		saveGeneral: unavailable,
		loginStatus: unavailable,
		saveWizard: unavailable,
		seedRegion: unavailable,
		replayWizard: unavailable,
		completeWizard: unavailable,
		dispose: async () => {},
	};
	Object.defineProperty(window, "quakeSettings", {
		configurable: true,
		value: bridge,
	});
	window.history.replaceState(null, "", "/");
	await mount(createElement(App));
	await click(element("[data-nav-page=screen]"));
	await act(async () =>
		finish({
			...INITIAL_WIZARD,
			revision: 0,
			locale: "en",
			hardwareVerified: false,
		}),
	);
	expect(wizard).toHaveBeenCalledOnce();
	expect(element(".content-inner").getAttribute("data-page")).toBe("screen");
	Reflect.deleteProperty(window, "quakeSettings");
});

it("CENTER-105 SETTINGS-002/003 resolves retired sessions and general/device deep links", async () => {
	for (const [name, target] of [
		["ClawDashboard", "agents"],
		["ClawInstall", "agents"],
		["settings-general", "settings"],
		["settings-device", "controls"],
	]) {
		window.history.replaceState(null, "", `/?activeTab=${name}`);
		const view = await mount(createElement(App));
		expect(element(".content-inner").getAttribute("data-page")).toBe(target);
		if (target === "agents")
			expect(
				element("#agents-tab-sessions").getAttribute("aria-selected"),
			).toBe("true");
		await view.unmount();
	}
});

it("MGMT-007/018/019/431 SETTINGS-001/003 keeps chrome, help and exit through focused settings navigation", async () => {
	const command = vi.fn(async () => true);
	Object.defineProperty(window, "quakeManagement", {
		configurable: true,
		value: {
			platform: "linux",
			command,
			setTheme: async () => true,
			onActivate: () => () => {},
		},
	});
	window.history.replaceState(null, "", "/?activeTab=settings");
	const view = await mount(createElement(App));
	try {
		const title = element(".mc-titlebar");
		const general = element<HTMLButtonElement>("#shell-tab-settings");
		general.focus();
		await act(async () =>
			general.dispatchEvent(
				new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
			),
		);
		expect(element(".content-inner").getAttribute("data-page")).toBe(
			"controls",
		);
		expect(document.activeElement?.id).toBe("shell-tab-controls");
		expect(element("#shell-tab-controls").getAttribute("aria-selected")).toBe(
			"true",
		);
		expect(element(".mc-titlebar")).toBe(title);
		await act(async () =>
			element("#shell-tab-controls").dispatchEvent(
				new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
			),
		);
		expect(document.activeElement?.id).toBe("shell-tab-settings");
		const footer = element(".mc-sidebar-footer");
		const exit = [...footer.querySelectorAll("button")].find(
			(item) => item.textContent === "Exit",
		);
		const help = [...footer.querySelectorAll("button")].find(
			(item) => item.textContent === "Help",
		);
		expect(help?.getAttribute("aria-haspopup")).toBe("dialog");
		if (!exit) throw new Error("Exit missing");
		await click(exit);
		expect(command).toHaveBeenCalledWith({ action: "quit" });
		expect(document.querySelector("webview")).toBeNull();
		expect(document.body.textContent).not.toMatch(
			/notificationCount|manualCalibration|gameModeMonitorConfig/,
		);
	} finally {
		await view.unmount();
		Object.defineProperty(window, "quakeManagement", {
			configurable: true,
			value: undefined,
		});
	}
});

it("MGMT-005 cancels device polling and ignores a late reply after renderer unmount", async () => {
	vi.useFakeTimers();
	const request = vi.fn(async () => ({ _tag: "offline" }));
	Object.defineProperty(window, "quakeHardware", {
		configurable: true,
		value: { request },
	});
	window.history.replaceState(null, "", "/?activeTab=settings-device");
	try {
		const view = await mount(createElement(App));
		await act(async () => vi.advanceTimersByTimeAsync(1000));
		expect(request.mock.calls.length).toBeGreaterThan(1);
		await view.unmount();
		const count = request.mock.calls.length;
		await act(async () => vi.advanceTimersByTimeAsync(3000));
		expect(request).toHaveBeenCalledTimes(count);
	} finally {
		vi.useRealTimers();
		Object.defineProperty(window, "quakeHardware", {
			configurable: true,
			value: undefined,
		});
	}
});
