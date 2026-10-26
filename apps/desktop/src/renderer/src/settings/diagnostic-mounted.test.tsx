// @vitest-environment happy-dom
import { act, createElement } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type {
	ConnectionDiagnostic,
	LifecycleBridge,
	LifecycleReply,
} from "../../../shared/lifecycle-contracts";
import { ConnectionCheck } from "../ConnectionDiagnostic";
import { button, click, element, mount } from "../management/dom-test";

const status: ConnectionDiagnostic = {
	usb: "fail",
	hdmi: "fail",
	checking: false,
	mock: true,
	width: 0,
	height: 0,
	resolutionMismatch: false,
	issue: "none",
};
afterEach(() => {
	vi.useRealTimers();
	Reflect.deleteProperty(window, "quakeLifecycle");
});
it("MGMT-029/030/037 serializes retry, announces results for 2600ms and keeps persistent channel results", async () => {
	vi.useFakeTimers();
	let settle: (reply: LifecycleReply) => void = () => {};
	const request = vi.fn<LifecycleBridge["request"]>(async (command) =>
		command.action === "read"
			? { ok: true, status }
			: new Promise((resolve) => {
					settle = resolve;
				}),
	);
	Object.defineProperty(window, "quakeLifecycle", {
		configurable: true,
		value: {
			request,
			onStatus: () => () => {},
			displaySettingsAvailable: false,
			layoutRepairAvailable: false,
		} satisfies LifecycleBridge,
	});
	await mount(createElement(ConnectionCheck));
	expect(element("[role=status]").textContent).toBe("");
	await click(button("Re-detect"));
	expect(button("Checking…").disabled).toBe(true);
	expect(document.querySelector("[aria-busy=true]")).not.toBeNull();
	await click(button("Checking…"));
	expect(
		request.mock.calls.filter(([c]) => c.action === "redetect"),
	).toHaveLength(1);
	await act(async () =>
		settle({ ok: true, status: { ...status, usb: "pass" } }),
	);
	expect(document.body.textContent).toContain("1/2 checks passed");
	await act(async () => vi.advanceTimersByTimeAsync(2600));
	expect(document.body.textContent).not.toContain("1/2 checks passed");
	expect(button("Re-detect").disabled).toBe(false);
	expect(document.body.textContent).toContain("USB");
	await click(button("Re-detect"));
	await act(async () =>
		settle({ ok: false, code: "DESKTOP.DISPLAY.OPERATION_FAILED" }),
	);
	expect(document.body.textContent).toContain("Detection error");
	expect(button("Re-detect").disabled).toBe(false);
});
it("MGMT-038/039 SETTINGS-070 exposes offline guide and fixed project support from Connection", async () => {
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
	await mount(createElement(ConnectionCheck));
	await click(button("Installation Guide"));
	expect(document.querySelector("dialog[open]")).not.toBeNull();
	expect(element<HTMLAnchorElement>("a").href).toBe(
		"https://github.com/ramarivera/open-quake/issues",
	);
});
