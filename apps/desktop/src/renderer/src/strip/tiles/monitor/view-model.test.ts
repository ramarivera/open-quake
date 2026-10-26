import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parsePower } from "../../../../../main/monitor/native-parsers";
import {
	defaults,
	emptySnapshot,
	STYLES,
} from "../../../../../shared/monitor-contracts";
import { MonitorPanel } from "./MonitorPanel";
import { appName } from "./MonitorSettings";
import {
	bare,
	diskView,
	percent,
	previewSnapshot,
	sampleOf,
	size,
	temperature,
} from "./view-model";

describe("source-backed monitor readouts", () => {
	it("hides uncollected sample numbers in every panel consumer and style", () => {
		for (const styleId of STYLES) {
			for (const settings of [
				{ ...defaults(), styleId, metrics: ["cpu" as const] },
				{
					...defaults(),
					styleId,
					override: { active: true, hz: 1, metrics: ["cpu" as const] },
				},
				{ ...defaults(), styleId, enabled: false },
			]) {
				const html = renderToStaticMarkup(
					createElement(MonitorPanel, {
						settings,
						snapshot: previewSnapshot(),
						preview: true,
					}),
				);
				expect(html).toContain(
					'data-testid="sys-monitor-value-mem-used-gb">--',
				);
				expect(html).toContain("Off");
				expect(html).toContain("Preview · Sample data");
			}
		}
	});
	it("names the executable's closest app bundle without exposing its private path", () => {
		expect(
			appName(
				"/Users/private/Outer.app/Contents/Helpers/Inner.app/Contents/MacOS/helper",
			),
		).toBe("Inner");
		expect(appName("/Applications/Upper.APP/Contents/MacOS/helper")).toBe(
			"Upper",
		);
		expect(appName("C:\\Users\\private\\Apps\\Editor.exe")).toBe("Editor");
	});
	it("keeps real zero distinct from missing values and converts valid temperatures", () => {
		expect(bare(undefined)).toBe("--");
		expect(bare(0)).toBe("0");
		expect(percent(120)).toBe("100%");
		expect(percent(undefined)).toBe("--");
		expect(percent(0)).toBe("0%");
		expect(size(1024 ** 4)).toBe("1 TB");
		expect(temperature(52, "fahrenheit")).toBe("126");
		for (const n of [0, -1, 151, undefined])
			expect(temperature(n, "celsius")).toBe("--");
	});
	it("sorts overflow, normalizes Windows drive names and distinguishes empty from unavailable", () => {
		const disks = Array.from({ length: 10 }, (_, i) => ({
			name: `${i}:\\`,
			usedPercent: i * 10,
			size: 1024 ** 3,
		}));
		const sample = {
			id: "disk",
			state: "available",
			collectedAt: 1,
			values: { disks },
		} as const;
		const view = diskView(sample);
		expect(view.rows).toHaveLength(8);
		expect(view.rows[0]?.name).toBe("9:");
		expect(view.overflow).toBe("+2 drives · highest 90%");
		expect(diskView({ ...sample, values: { disks: [] } }).empty).toBe(true);
		expect(
			diskView({ ...sample, state: "unavailable", values: {} }).empty,
		).toBe(false);
	});
	it("renders all seven modules in all five styles, keeps startup honest and no-battery neutral", () => {
		for (const style of STYLES) {
			const initial = renderToStaticMarkup(
				createElement(MonitorPanel, {
					settings: { ...defaults(), styleId: style },
					snapshot: emptySnapshot(),
				}),
			);
			expect(initial).toContain("Unavailable");
			expect(initial).not.toContain(">0<");
			expect(initial).not.toContain(">100<");
			expect(initial).not.toMatch(/--(?:<small>|%|°C|°F|MB\/s)/);
			const fixture = previewSnapshot();
			const html = renderToStaticMarkup(
				createElement(MonitorPanel, {
					settings: { ...defaults(), styleId: style },
					snapshot: fixture,
					preview: true,
				}),
			);
			for (const id of [
				"cpu",
				"gpu",
				"mem",
				"process",
				"disk",
				"net",
				"battery",
			])
				expect(html).toContain(`sys-monitor-module-${id}`);
			expect(html).toContain('data-quake-sub-touch="smDiskList"');
			expect(html).toContain("Sample data");
		}
		const snapshot = previewSnapshot();
		const html = renderToStaticMarkup(
			createElement(MonitorPanel, {
				settings: defaults(),
				snapshot: {
					...snapshot,
					samples: snapshot.samples.map((s) =>
						s.id === "power"
							? { ...s, values: parsePower("Now drawing from 'AC Power'\n") }
							: s,
					),
				},
			}),
		);
		expect(html).toContain("AC Power");
		expect(html).not.toContain(">100<");
		expect(html).toContain(
			'data-testid="sys-monitor-value-battery-percent">--</div>',
		);
		expect(sampleOf(snapshot, "cpu").values.load).toBe(37);
	});
	it.each([
		["AC Power", "charging", "Charging", "AC Power"],
		["AC Power", "charged", "Charged", "AC Power"],
		["AC Power", "AC attached; not charging", "Not charging", "AC Power"],
		["Battery Power", "discharging", "Discharging", "Battery Power"],
	])(
		"renders native source %s and status %s independently in every style",
		(source, native, status, supply) => {
			const fixture = previewSnapshot();
			const power = parsePower(
				`Now drawing from '${source}'\n -InternalBattery-0 (id=1) 87%; ${native}; 0:00 remaining`,
			);
			for (const styleId of STYLES) {
				const html = renderToStaticMarkup(
					createElement(MonitorPanel, {
						settings: { ...defaults(), styleId },
						snapshot: {
							...fixture,
							samples: fixture.samples.map((s) =>
								s.id === "power" ? { ...s, values: power } : s,
							),
						},
					}),
				);
				expect(html).toContain(
					`data-testid="sys-monitor-battery-status">${status}</b>`,
				);
				expect(html).toContain(
					`data-testid="sys-monitor-power-source">${supply === "Battery Power" && styleId === "cyber" ? "ON_BATTERY" : supply}</b>`,
				);
			}
		},
	);
	it("omits units for absent disk usage and keeps measured zero", () => {
		const sample = {
			id: "disk",
			state: "available",
			collectedAt: 1,
			values: {
				disks: [
					{ name: "Unknown" },
					{ name: "Empty", usedPercent: 0, size: 0 },
				],
			},
		} as const;
		expect(diskView(sample).rows.map((row) => row.summary)).toEqual([
			"-- / --",
			"0% / 0 GB",
		]);
	});
});
