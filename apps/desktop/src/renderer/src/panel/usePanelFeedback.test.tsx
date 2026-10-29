// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { QuakeEvent } from "../../../preload/quake";
import { mount } from "../test/mount";
import { PanelFeedbackLayer } from "./PanelFeedbackLayer";
import { usePanelFeedback } from "./usePanelFeedback";

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

function Feedback({
	events,
	diagnostics = false,
}: {
	events: readonly QuakeEvent[];
	diagnostics?: boolean;
}) {
	const view = usePanelFeedback(
		{ events: [...events], eventsReceived: events.length },
		diagnostics,
	);
	return (
		<svg role="img" aria-label="Panel feedback test">
			<PanelFeedbackLayer view={view} inputDiagnostics={diagnostics} />
		</svg>
	);
}
const connected: QuakeEvent = {
	source: "hid",
	kind: "status",
	state: "connected",
};
const inputs: readonly QuakeEvent[] = [
	connected,
	{ source: "hid", kind: "rotate", direction: 1 },
	{ source: "hid", kind: "touch", points: [{ x: 100, y: 80, action: 1 }] },
];

it("ordinary input schedules no diagnostic expiry while offline feedback still works", async () => {
	vi.useFakeTimers();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const view = await mount(<Feedback events={inputs} />);
	try {
		expect(view.container.querySelector(".panel-knob,.panel-touch")).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
		await view.render(
			<Feedback
				events={[
					...inputs,
					{
						source: "hid",
						kind: "status",
						state: "disconnected",
						reason: "scope-closed",
					},
				]}
			/>,
		);
		expect(view.container.textContent).toContain("Controls offline");
		expect(vi.getTimerCount()).toBe(0);
	} finally {
		await view.unmount();
	}
});

it("opt-in diagnostics expire and disabling them cancels their pending timer", async () => {
	vi.useFakeTimers();
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const view = await mount(<Feedback events={inputs} diagnostics />);
	try {
		expect(view.container.querySelector(".panel-touch")).not.toBeNull();
		expect(vi.getTimerCount()).toBe(1);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(901);
		});
		expect(view.container.querySelector(".panel-touch")).toBeNull();
		await view.render(<Feedback events={inputs} />);
		expect(vi.getTimerCount()).toBe(0);
		await view.render(<Feedback events={inputs} diagnostics />);
		expect(view.container.querySelector(".panel-touch")).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
	} finally {
		await view.unmount();
	}
});
