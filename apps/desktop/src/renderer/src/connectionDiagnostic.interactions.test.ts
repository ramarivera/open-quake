// @vitest-environment happy-dom
import { act, createElement } from "react";
import { expect, it, vi } from "vitest";
import type {
	ConnectionDiagnostic,
	LifecycleBridge,
} from "../../shared/lifecycle-contracts";
import { ConnectionCheck } from "./ConnectionDiagnostic";
import { click, element, mount } from "./management/dom-test";

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

it("MGMT-028/033/035/036/040 drives channel transitions, details and cleanup through the lifecycle consumer", async () => {
	let receive: (status: ConnectionDiagnostic) => void = () => {};
	const off = vi.fn();
	const request: LifecycleBridge["request"] = vi.fn<LifecycleBridge["request"]>(
		async () => ({ ok: true, status: failed }),
	);
	const bridge: LifecycleBridge = {
		request,
		onStatus: (listener) => {
			receive = listener;
			return off;
		},
		displaySettingsAvailable: true,
		layoutRepairAvailable: true,
	};
	Object.defineProperty(window, "quakeLifecycle", {
		configurable: true,
		value: bridge,
	});
	const ready = vi.fn();
	const view = await mount(
		createElement<{ onReady?: (ready: boolean) => void }>(ConnectionCheck, {
			onReady: (value: boolean) => ready(value),
		}),
	);
	expect(request).toHaveBeenCalledExactlyOnceWith({ action: "read" });
	expect(
		element("[aria-controls=connection-usb]").getAttribute("aria-expanded"),
	).toBe("true");
	expect(element("#connection-usb").textContent).toContain("data transfer");
	await click(element("[aria-controls=connection-hdmi]"));
	expect(element("#connection-hdmi").textContent).toContain("Mini HDMI");
	await act(async () => receive({ ...failed, usb: "pass", checking: true }));
	expect(element(".connection-checks").getAttribute("aria-busy")).toBe("true");
	await act(async () =>
		receive({
			...failed,
			usb: "pass",
			resolutionMismatch: true,
			width: 960,
			height: 240,
		}),
	);
	expect(
		element("[aria-controls=connection-hdmi]").getAttribute("aria-expanded"),
	).toBe("true");
	expect(element("#connection-hdmi").textContent).toContain("1920x480");
	expect(element("#connection-hdmi").textContent).toContain(
		"your system display settings",
	);
	expect(element("#connection-hdmi").textContent).not.toContain("Windows");
	expect(element("[aria-controls=connection-hdmi]").textContent).toContain(
		"960x240",
	);
	await click(element("[aria-controls=connection-usb]"));
	expect(element("#connection-usb").textContent).toContain(
		"Connection is stable",
	);
	for (const [width, height] of [
		[1920, 480],
		[480, 1920],
	] as const) {
		await act(async () =>
			receive({ ...failed, usb: "pass", hdmi: "pass", width, height }),
		);
		expect(ready).toHaveBeenLastCalledWith(true);
		expect(element("#connection-hdmi").textContent).toContain(
			"Connection is stable",
		);
	}
	await act(async () =>
		receive({ ...failed, usb: "pass", hdmi: "pass", issue: "native-failed" }),
	);
	expect(ready).toHaveBeenLastCalledWith(false);
	expect(element("[role=alert]").textContent).toContain("10 minutes");
	await view.unmount();
	expect(off).toHaveBeenCalledOnce();
});
