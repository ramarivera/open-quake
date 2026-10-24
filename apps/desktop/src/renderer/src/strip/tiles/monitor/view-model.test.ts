import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
	defaults,
	emptySnapshot,
	STYLES,
} from "../../../../../shared/monitor-contracts";
import { MonitorPanel } from "./MonitorPanel";
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
	it("keeps real zero distinct from missing values and converts valid temperatures", () => {
		expect(bare(undefined)).toBe("--");
		expect(bare(0)).toBe("0");
		expect(percent(120)).toBe("100%");
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
						s.id === "power" ? { ...s, values: { hasBattery: false } } : s,
					),
				},
			}),
		);
		expect(html).toContain("AC Power");
		expect(html).not.toContain(">100<");
		expect(sampleOf(snapshot, "cpu").values.load).toBe(37);
	});
});
