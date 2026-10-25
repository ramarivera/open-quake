import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./management.css", import.meta.url), "utf8");
const drawerCss = css.slice(
	css.indexOf("@media (max-width: 759px) {"),
	css.indexOf("\n}\n", css.indexOf("@media (max-width: 759px) {")),
);

/** Every rule whose selector list targets exactly `selector`. */
function rules(source: string, selector: string): string[] {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(
		`(?:^|[,}\\n])\\s*${escaped}(?:\\s*,[^{]*)?\\s*\\{([^}]*)\\}`,
		"g",
	);
	return [...source.matchAll(pattern)].map((match) => match[1] ?? "");
}

describe("Display popover in the sidebar footer", () => {
	it("has no clipping ancestor between it and the window", () => {
		// overflow on any of these clipped the popover's right-hand controls at the
		// default 218 px sidebar width; z-index cannot escape an overflow clip.
		for (const ancestor of [
			".sidebar",
			".mc-sidebar-footer",
			".mc-ui-settings-host",
		]) {
			const declared = rules(css, ancestor);
			expect(declared.length, ancestor).toBeGreaterThan(0);
			for (const body of declared)
				expect(body, ancestor).not.toMatch(/overflow/);
		}
	});

	it("keeps sidebar scrolling and truncation on its own rows", () => {
		expect(rules(css, ".nav")[0]).toMatch(
			/min-height: 0;[\s\S]*overflow: hidden auto;/,
		);
		expect(rules(css, ".mc-product-mark")[0]).toContain("overflow: hidden");
		expect(rules(css, ".mc-ui-settings-button")[0]).toContain(
			"overflow: hidden",
		);
	});

	it("floats 300 px wide over the content beside a docked sidebar", () => {
		const popover = rules(css, ".mc-ui-settings")[0];
		expect(popover).toMatch(/position: absolute;/);
		expect(popover).toMatch(/left: 0;/);
		expect(popover).toMatch(/width: 300px;/);
		expect(popover).toMatch(/max-width: calc\(100vw - 24px\);/);
	});

	it("spans the footer inside the narrow drawer instead of crossing its edge", () => {
		expect(drawerCss).toContain(".mc-scrim");
		const popover = rules(drawerCss, ".mc-ui-settings");
		expect(popover).toHaveLength(1);
		expect(popover[0]).toMatch(/right: 0;/);
		expect(popover[0]).toMatch(/width: auto;/);
	});
});
