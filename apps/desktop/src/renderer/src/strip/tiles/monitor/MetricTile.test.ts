import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MODULES } from "../../../../../../../../packages/edge/src/monitor/monitor-contracts";
import { MetricReadout } from "./MetricTile";

describe("individual monitor readouts", () => {
	it("preserves missing values and measured zero for each registered consumer", () => {
		for (const id of MODULES) {
			const render = (
				values: Parameters<typeof MetricReadout>[0]["sample"]["values"],
			) =>
				renderToStaticMarkup(
					createElement(MetricReadout, {
						sample: { id, state: "available", collectedAt: 1, values },
						unit: "fahrenheit",
					}),
				);
			expect(render({})).toContain("--");
			expect(render({})).not.toContain(">0<");
			const measured = render({
				load: 0,
				temperature: 50,
				all: 0,
				used: 0,
				disks: [],
				up: 0,
				down: 0,
				percent: 0,
				connected: 0,
			});
			expect(measured).not.toContain("--");
			expect(measured).not.toContain("GBGB");
			if (id === "cpu" || id === "gpu") expect(measured).toContain("122");
		}
	});
	it("labels previews and confirmed AC desktops without inventing charge", () => {
		const html = renderToStaticMarkup(
			createElement(MetricReadout, {
				sample: {
					id: "power",
					state: "available",
					collectedAt: 1,
					values: { hasBattery: false },
				},
				unit: "celsius",
				preview: true,
			}),
		);
		expect(html).toContain("AC Power");
		expect(html).toContain("Sample data");
		expect(html).not.toContain("100");
	});
});
