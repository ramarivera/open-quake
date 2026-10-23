import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { QuakeEvent } from "../../../preload/quake";
import { WallpaperCanvas } from "../wallpaper/WallpaperCanvas";
import { PanelFeedbackLayer } from "./PanelFeedbackLayer";
import {
	applyPanelEvent,
	formatDetents,
	IDLE_AFTER_MS,
	initialPanelFeedback,
	nextPanelDeadline,
	type PanelFeedback,
	PRESS_PULSE_MS,
	TOUCH_MARK_MS,
	viewPanelFeedback,
} from "./panelFeedback";

const connected: QuakeEvent = {
	source: "hid",
	kind: "status",
	state: "connected",
};

function fold(events: readonly QuakeEvent[], now = 0): PanelFeedback {
	return events.reduce(
		(state, event) => applyPanelEvent(state, event, now),
		initialPanelFeedback,
	);
}

const layer = (state: PanelFeedback, now: number): string =>
	renderToStaticMarkup(
		createElement(PanelFeedbackLayer, {
			view: viewPanelFeedback(state, now),
		}),
	);

describe("panel knob feedback", () => {
	it("tracks signed detents and hides the knob after the idle window", () => {
		const state = fold([
			connected,
			{ source: "hid", kind: "rotate", direction: 1 },
			{ source: "hid", kind: "rotate", direction: 1 },
			{ source: "hid", kind: "rotate", direction: -1 },
			{ source: "hid", kind: "rotate", direction: 1 },
		]);
		expect(state.detents).toBe(2);
		expect(viewPanelFeedback(state, 0).knobVisible).toBe(true);
		expect(viewPanelFeedback(state, IDLE_AFTER_MS - 1).knobVisible).toBe(true);
		expect(viewPanelFeedback(state, IDLE_AFTER_MS).knobVisible).toBe(false);
		expect(nextPanelDeadline(state, 0)).toBe(IDLE_AFTER_MS);
		expect(nextPanelDeadline(state, IDLE_AFTER_MS)).toBeNull();
	});

	it("holds an HID press until release and pulses a stateless mock press", () => {
		const down = fold([connected, { source: "hid", kind: "press", state: 1 }]);
		expect(viewPanelFeedback(down, 0).pressed).toBe(true);
		// A held knob keeps its feedback visible past the idle window.
		expect(viewPanelFeedback(down, IDLE_AFTER_MS * 3)).toMatchObject({
			pressed: true,
			knobVisible: true,
		});
		const up = applyPanelEvent(
			down,
			{ source: "hid", kind: "press", state: 0 },
			10,
		);
		expect(viewPanelFeedback(up, 10).pressed).toBe(false);

		const pulse = fold([
			{ source: "mock", kind: "status", state: "connected" },
			{ source: "mock", kind: "press" },
		]);
		expect(viewPanelFeedback(pulse, PRESS_PULSE_MS - 1).pressed).toBe(true);
		expect(viewPanelFeedback(pulse, PRESS_PULSE_MS).pressed).toBe(false);
		expect(nextPanelDeadline(pulse, 0)).toBe(PRESS_PULSE_MS);
	});

	it("leaves keep-alives out of the feedback", () => {
		const state = fold([connected]);
		expect(
			applyPanelEvent(state, { source: "hid", kind: "keepalive", seq: 9 }, 5),
		).toBe(state);
	});

	it("formats detents with a true minus sign", () => {
		expect([formatDetents(3), formatDetents(0), formatDetents(-12)]).toEqual([
			"+3",
			"0",
			"−12",
		]);
	});
});

describe("panel link state", () => {
	it("stays quiet before the first status and while connected", () => {
		expect(viewPanelFeedback(initialPanelFeedback, 0).link).toEqual({
			state: "pending",
		});
		expect(viewPanelFeedback(fold([connected]), 0).link).toEqual({
			state: "connected",
		});
	});

	it("reports disconnects and catalog errors, and releases a held press", () => {
		const held = fold([connected, { source: "hid", kind: "press", state: 1 }]);
		const dropped = applyPanelEvent(
			held,
			{
				source: "hid",
				kind: "status",
				state: "disconnected",
				reason: "transport-ended",
			},
			0,
		);
		expect(viewPanelFeedback(dropped, 0)).toMatchObject({
			link: {
				state: "offline",
				detail: "Reconnecting to the QUAKE",
				code: null,
			},
			pressed: false,
			knobVisible: false,
		});
		const failed = applyPanelEvent(
			dropped,
			{
				source: "hid",
				kind: "status",
				state: "error",
				error: {
					_tag: "QuakeDeviceNotFound",
					code: "QUAKE.DEVICE.NOT_FOUND",
					category: "unavailable",
				},
			},
			0,
		);
		expect(viewPanelFeedback(failed, 0).link).toEqual({
			state: "offline",
			detail: "Retrying automatically",
			code: "QUAKE.DEVICE.NOT_FOUND",
		});
		expect(
			viewPanelFeedback(applyPanelEvent(failed, connected, 0), 0).link,
		).toEqual({ state: "connected" });
	});
});

describe("panel touch feedback", () => {
	it("plots only in-canvas points and expires them", () => {
		const state = fold([
			connected,
			{
				source: "hid",
				kind: "touch",
				points: [
					{ action: 1, x: 100, y: 200 },
					{ action: 1, x: 2400, y: 200 },
					{ action: 1, x: 300, y: 900 },
				],
			},
		]);
		expect(viewPanelFeedback(state, 0).touches).toEqual([
			{ id: "1-0", x: 100, y: 200 },
		]);
		expect(viewPanelFeedback(state, TOUCH_MARK_MS).touches).toEqual([]);
		// Other events do not erase marks that are still on screen.
		const rotated = applyPanelEvent(
			state,
			{ source: "hid", kind: "rotate", direction: 1 },
			1,
		);
		expect(viewPanelFeedback(rotated, 1).touches).toHaveLength(1);
	});
});

describe("panel feedback layer", () => {
	it("draws the knob at the detent angle and labels mock input", () => {
		const mock = fold([
			{ source: "mock", kind: "status", state: "connected" },
			{ source: "mock", kind: "rotate", direction: 1 },
			{ source: "mock", kind: "rotate", direction: 1 },
		]);
		const markup = layer(mock, 0);
		expect(markup).toContain('data-visible="true"');
		expect(markup).toContain("rotate(30deg)");
		expect(markup).toContain(">+2<");
		expect(markup).toContain("Mock input");
		expect(layer(fold([connected]), 0)).not.toContain("Mock input");
	});

	it("replaces the knob with an offline plate that names the error code", () => {
		const markup = layer(
			fold([
				{
					source: "hid",
					kind: "status",
					state: "error",
					error: {
						_tag: "QuakeDeviceNotFound",
						code: "QUAKE.DEVICE.NOT_FOUND",
						category: "unavailable",
					},
				},
			]),
			0,
		);
		expect(markup).toContain("Controls offline");
		expect(markup).toContain("QUAKE.DEVICE.NOT_FOUND");
		expect(markup).not.toContain("panel-knob");
	});

	it("renders inside the shared canvas without changing the preview markup", () => {
		const preview = renderToStaticMarkup(createElement(WallpaperCanvas, {}));
		const panel = renderToStaticMarkup(
			createElement(
				WallpaperCanvas,
				{},
				createElement(PanelFeedbackLayer, {
					view: viewPanelFeedback(fold([connected]), 0),
				}),
			),
		);
		expect(panel).toContain('viewBox="0 0 1920 480"');
		expect(panel.indexOf("panel-feedback")).toBeLessThan(
			panel.indexOf("</svg>"),
		);
		expect(preview).not.toContain("panel-feedback");
		expect(
			panel.replace(/<g class="panel-feedback">.*<\/g><\/svg>/, "</svg>"),
		).toBe(preview);
	});
});
