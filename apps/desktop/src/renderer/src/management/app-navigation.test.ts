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
