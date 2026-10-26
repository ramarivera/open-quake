// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MonitorSnapshot } from "../../../../../shared/monitor-contracts";
import {
	defaults,
	emptySnapshot,
	STYLES,
} from "../../../../../shared/monitor-contracts";
import { dispatch, mount, required } from "../../../test/mount";
import { MonitorPanel } from "./MonitorPanel";

const css = readFileSync(
	resolve("src/renderer/src/strip/tiles/monitor/monitor.css"),
	"utf8",
);

import { previewSnapshot } from "./view-model";

beforeEach(() => {
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const module = (root: ParentNode, id: string) =>
	required(root, `[data-testid="sys-monitor-module-${id}"]`, HTMLDivElement);

describe("WIDGETS-071/072/073: retained monitor consumers", () => {
	it.each(STYLES)(
		"%s reconciles all seven modules and explicitly reports missing/stale values",
		async (styleId) => {
			const view = await mount(
				createElement(MonitorPanel, {
					settings: { ...defaults(), styleId },
					snapshot: emptySnapshot(),
				}),
			);
			try {
				for (const id of [
					"cpu",
					"gpu",
					"mem",
					"process",
					"disk",
					"net",
					"battery",
				])
					expect(module(view.container, id).textContent).toContain(
						"Unavailable",
					);
				const snapshot = previewSnapshot();
				await view.render(
					createElement(MonitorPanel, {
						settings: { ...defaults(), styleId },
						snapshot,
					}),
				);
				expect(module(view.container, "cpu").textContent).toContain("37");
				expect(module(view.container, "gpu").textContent).toContain("12");
				expect(module(view.container, "mem").textContent).toContain("61");
				expect(module(view.container, "disk").textContent).toContain(
					"68% / 931 GB",
				);
				expect(module(view.container, "process").textContent).toContain("284");
				const stale: MonitorSnapshot = {
					...snapshot,
					samples: snapshot.samples.map((s) =>
						s.id === "cpu" ? { ...s, state: "stale" } : s,
					),
				};
				await view.render(
					createElement(MonitorPanel, {
						settings: { ...defaults(), styleId },
						snapshot: stale,
					}),
				);
				expect(module(view.container, "cpu").textContent).toContain("Stale");
				expect(module(view.container, "cpu").textContent).toContain("37");
			} finally {
				await view.unmount();
			}
		},
	);

	it("anime keeps compute/model, memory/process/disks and power/network groups when values change", async () => {
		const snapshot = previewSnapshot();
		const view = await mount(
			createElement(MonitorPanel, {
				settings: { ...defaults(), styleId: "anime" },
				snapshot,
			}),
		);
		try {
			expect(module(view.container, "cpu").closest(".monitor-compute")).toBe(
				module(view.container, "gpu").closest(".monitor-compute"),
			);
			expect(
				view.container.querySelector(".monitor-compute .monitor-model")
					?.textContent,
			).toContain("NVIDIA");
			for (const id of ["mem", "process", "disk"])
				expect(
					module(view.container, id).closest(".monitor-middle"),
				).not.toBeNull();
			for (const id of ["net", "battery"])
				expect(
					module(view.container, id).closest(".monitor-last"),
				).not.toBeNull();
			await view.render(
				createElement(MonitorPanel, {
					settings: { ...defaults(), styleId: "anime" },
					snapshot: {
						...snapshot,
						samples: snapshot.samples.map((s) =>
							s.id === "cpu" ? { ...s, values: { load: 0 } } : s,
						),
					},
				}),
			);
			expect(module(view.container, "cpu").textContent).toContain("Temp (N/A)");
			expect(
				required(
					view.container,
					'[data-testid="sys-monitor-value-cpu-temp"]',
					HTMLDivElement,
				).textContent,
			).toBe("--");
			expect(view.container.querySelectorAll(".monitor-sparkle")).toHaveLength(
				3,
			);
		} finally {
			await view.unmount();
		}
	});

	it("tactical groups processors/memory, scheduler, drives and communications with long labels", async () => {
		const snapshot = previewSnapshot();
		const model = "A very long graphics adapter model ".repeat(12);
		const view = await mount(
			createElement(MonitorPanel, {
				settings: { ...defaults(), styleId: "tactical" },
				snapshot: {
					...snapshot,
					samples: snapshot.samples.map((s) =>
						s.id === "gpu" ? { ...s, values: { ...s.values, model } } : s,
					),
				},
			}),
		);
		try {
			for (const id of ["cpu", "gpu", "mem"])
				expect(
					module(view.container, id).closest(".monitor-compute"),
				).not.toBeNull();
			expect(module(view.container, "process").textContent).toContain(
				"ACTIVE_TASK_SCHEDULER",
			);
			expect(module(view.container, "disk").textContent).toContain(
				"DRIVE_MANIFEST",
			);
			expect(module(view.container, "net").textContent).toContain(
				"WLAN_PRIMARY",
			);
			for (const id of ["net", "battery"])
				expect(
					module(view.container, id).closest(".monitor-bottom"),
				).not.toBeNull();
			expect(view.container.textContent).toContain(model);
			expect(
				view.container.querySelectorAll(
					".monitor-sparkle, .monitor-scanline, .monitor-needle",
				),
			).toHaveLength(0);
		} finally {
			await view.unmount();
		}
	});

	it.each([0, 50, 100])(
		"wasteland maps real %s percent to all three needles and removes unknown needles",
		async (load) => {
			const snapshot = previewSnapshot();
			const measured: MonitorSnapshot = {
				...snapshot,
				samples: snapshot.samples.map((s) =>
					s.id === "cpu" || s.id === "gpu"
						? { ...s, values: { ...s.values, load } }
						: s.id === "memory"
							? { ...s, values: { total: 100, used: load, free: 100 - load } }
							: s,
				),
			};
			const view = await mount(
				createElement(MonitorPanel, {
					settings: { ...defaults(), styleId: "wasteland" },
					snapshot: measured,
				}),
			);
			try {
				for (const id of ["cpu", "gpu", "mem"])
					expect(
						required(
							module(view.container, id),
							".monitor-needle",
							HTMLDivElement,
						).style.transform,
					).toBe(`rotate(${load * 2.7 - 135}deg)`);
				for (const id of ["disk", "net"])
					expect(
						module(view.container, id).closest(".monitor-top"),
					).not.toBeNull();
				for (const id of ["process", "battery"])
					expect(
						module(view.container, id).closest(".monitor-bottom"),
					).not.toBeNull();
				await view.render(
					createElement(MonitorPanel, {
						settings: { ...defaults(), styleId: "wasteland" },
						snapshot: emptySnapshot(),
					}),
				);
				expect(view.container.querySelectorAll(".monitor-needle")).toHaveLength(
					0,
				);
				expect(view.container.querySelectorAll(".monitor-rivet")).toHaveLength(
					4,
				);
			} finally {
				await view.unmount();
			}
		},
	);
});

it("MGMT-384: mounted disk sub-touch scrolls within bounds and cancellation/unmount stop inertia", async () => {
	const view = await mount(
		createElement(MonitorPanel, {
			settings: defaults(),
			snapshot: previewSnapshot(),
		}),
	);
	const list = required(
		view.container,
		'[data-quake-sub-touch="smDiskList"]',
		HTMLElement,
	);
	Object.defineProperties(list, {
		scrollHeight: { value: 800 },
		clientHeight: { value: 100 },
	});
	const touch = async (
		phase: "start" | "move" | "end",
		y: number,
		isEffective = true,
	) => {
		await act(async () => vi.advanceTimersByTime(20));
		await dispatch(
			list,
			new CustomEvent(
				phase === "end" ? "quake-sub-touch-end" : "quake-sub-touch-start",
				{
					detail: {
						phase,
						x: 100,
						y,
						startX: 100,
						startY: 200,
						isEffective,
						cancelled: !isEffective,
					},
				},
			),
		);
	};
	try {
		await touch("start", 200);
		await touch("move", 160);
		await touch("move", 80);
		expect(list.scrollTop).toBeGreaterThan(0);
		await touch("move", -1000);
		expect(list.scrollTop).toBe(700);
		await touch("end", -1000, false);
		const stopped = list.scrollTop;
		await act(async () => vi.advanceTimersByTime(1000));
		expect(list.scrollTop).toBe(stopped);
	} finally {
		await view.unmount();
	}
	await touch("move", 200);
	expect(list.scrollTop).toBe(700);
});

it("monitor motion preferences disable gauge transitions and no decorative loops remain", () => {
	const reduced = css.slice(
		css.indexOf("@media (prefers-reduced-motion: reduce)"),
	);
	expect(reduced).toContain("animation: none");
	expect(reduced).toContain("transition: none");
	// independent-device-design supersedes vendor scanline/twinkle/wobble loops.
	expect(css).not.toMatch(/@keyframes\s+monitor-(twinkle|scanline)/);
});
