import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	OrientationConfirmation,
	observeOrientation,
} from "../../renderer/src/settings/SetupWizard";
import strings from "../../renderer/src/settings/strings.json";
import type {
	ConnectionDiagnostic,
	DisplayOrientation,
	LifecycleBridge,
	LifecycleReply,
} from "../../shared/lifecycle-contracts";

const portrait: DisplayOrientation = {
	serialNumber: "a",
	rotation: 0,
	orientation: "vertical",
	isVertical: true,
	connected: true,
};
const status = (orientation = portrait): ConnectionDiagnostic => ({
	usb: "pass",
	hdmi: "pass",
	checking: false,
	mock: true,
	width: 480,
	height: 1920,
	resolutionMismatch: false,
	issue: "none",
	orientations: [orientation],
});
afterEach(() => vi.useRealTimers());
describe("wizard orientation consumer", () => {
	it.each(["en", "de"] as const)(
		"SETTINGS-058 renders orientation diagrams, status and platform remediation in %s",
		(locale) => {
			const render = (
				orientation: DisplayOrientation | undefined,
				platform = "darwin",
			) =>
				renderToStaticMarkup(
					createElement(OrientationConfirmation, {
						text: strings[locale].setup.orientation,
						orientation,
						platform,
						openSettings: () => {},
					}),
				);
			const vertical = render(portrait);
			expect(vertical.match(/<svg/g)).toHaveLength(2);
			expect(vertical).toContain("270°");
			expect(vertical).toContain(
				locale === "en"
					? "Open display settings"
					: "Anzeigeeinstellungen öffnen",
			);
			expect(vertical).not.toContain('data-tone="success">Recommended');
			const horizontal = render({
				...portrait,
				isVertical: false,
				orientation: "horizontal",
				rotation: 270,
			});
			expect(horizontal).toContain(
				locale === "en" ? "Congratulations!" : "Glückwunsch!",
			);
			expect(horizontal).not.toContain("<button");
			expect(render(undefined)).toContain(
				locale === "en" ? "Device not connected" : "Gerät nicht verbunden",
			);
		},
	);
	it("SCREEN-147 SETTINGS-058 subscribes by serial, polls every 2000ms, rejects stale reads and cleans up", async () => {
		vi.useFakeTimers();
		let listener: ((s: ConnectionDiagnostic) => void) | undefined;
		let resolveRead: ((s: LifecycleReply) => void) | undefined;
		const off = vi.fn();
		const request = vi.fn<LifecycleBridge["request"]>(
			() =>
				new Promise((resolve) => {
					resolveRead = resolve;
				}),
		);
		const publish = vi.fn();
		const disconnected = vi.fn();
		const stop = observeOrientation(
			{
				displaySettingsAvailable: true,
				layoutRepairAvailable: true,
				request,
				onStatus: (f) => {
					listener = f;
					return off;
				},
			},
			"a",
			publish,
			disconnected,
		);
		expect(request).toHaveBeenCalledExactlyOnceWith({ action: "read" });
		listener?.(status());
		expect(publish).toHaveBeenLastCalledWith(portrait);
		resolveRead?.({
			ok: true,
			status: status({ ...portrait, isVertical: false }),
		});
		await Promise.resolve();
		expect(publish).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(1999);
		expect(request).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(1);
		expect(request).toHaveBeenCalledTimes(2);
		listener?.(status({ ...portrait, serialNumber: "b" }));
		expect(publish).toHaveBeenLastCalledWith(undefined);
		expect(disconnected).not.toHaveBeenCalled();
		listener?.({ ...status(), usb: "fail", orientations: [] });
		expect(disconnected).toHaveBeenCalledOnce();
		stop();
		resolveRead?.({ ok: true, status: status() });
		await Promise.resolve();
		const calls = publish.mock.calls.length;
		await vi.advanceTimersByTimeAsync(10000);
		expect(request).toHaveBeenCalledTimes(2);
		expect(publish).toHaveBeenCalledTimes(calls);
		expect(off).toHaveBeenCalledOnce();
	});
});
