import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConnectionDiagnostic } from "../../shared/lifecycle-contracts";
import { DiagnosticView, hdmiMessage } from "./ConnectionDiagnostic";

const status: ConnectionDiagnostic = {
	usb: "fail",
	hdmi: "fail",
	checking: false,
	mock: false,
	width: 0,
	height: 0,
	resolutionMismatch: false,
	issue: "none",
};
const render = (value: ConnectionDiagnostic | undefined) =>
	renderToStaticMarkup(
		createElement(DiagnosticView, { status: value, notice: "", run: () => {} }),
	);
describe("connection diagnostic page", () => {
	it("offers expandable troubleshooting and Re-detect while preserving desktop preview", () => {
		const html = render(status);
		expect(html).toContain("USB Control Connection");
		expect(html).toContain("No HDMI monitor detected");
		expect(html).toContain('aria-expanded="true"');
		expect(html).toContain("USB cable that supports data transfer");
		expect(html).toContain("Re-detect");
		expect(html).toContain("Desktop preview is available");
	});
	it("disables checks during loading, distinguishes simulated input, and reports both passing", () => {
		expect(render(undefined)).toContain('disabled=""');
		expect(render({ ...status, checking: true })).toContain("Checking");
		const html = render({ ...status, usb: "pass", hdmi: "pass", mock: true });
		expect(html).toContain("simulated USB");
		expect(html.match(/data-pass="true"/g)).toHaveLength(2);
		expect(html).toContain('role="status" aria-live="polite"></p>');
		expect(html).not.toContain(
			"Detection complete, both connections are normal",
		);
	});
	it("explains a failed layout repair and its automatic prompt cooldown", () => {
		const html = render({
			...status,
			usb: "pass",
			hdmi: "pass",
			issue: "native-failed",
		});
		expect(html).toContain('role="alert"');
		expect(html).toContain("Quake display arrangement failed");
		expect(html).toContain("10 minutes");
		expect(html).toContain("Open Display Settings");
		expect(html).toContain("Arrange Quake display again");
		expect(html).not.toContain("both connections are normal");
	});
	it("uses physical dimensions in the recovered resolution error", () => {
		expect(
			hdmiMessage({
				...status,
				resolutionMismatch: true,
				width: 960,
				height: 240,
			}),
		).toBe(
			"Display detected, but resolution is incorrect (current 960x240, expected 1920x480)",
		);
	});
});
