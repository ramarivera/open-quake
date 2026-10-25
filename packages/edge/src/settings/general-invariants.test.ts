import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { reachableWindow } from "./general-invariants.js";

const rectangle = fc.record({
	x: fc.integer({ min: -50000, max: 50000 }),
	y: fc.integer({ min: -50000, max: 50000 }),
	width: fc.integer({ min: 1, max: 32768 }),
	height: fc.integer({ min: 1, max: 32768 }),
});
describe("management reachability", () => {
	it("always fits inside one connected work area and correction is stable", () =>
		fc.assert(
			fc.property(
				rectangle,
				fc.array(rectangle, { minLength: 1, maxLength: 8 }),
				(saved, areas) => {
					const result = reachableWindow(saved, areas);
					expect(result).toBeDefined();
					if (!result) return;
					expect(
						areas.some(
							(area) =>
								result.x >= area.x &&
								result.y >= area.y &&
								result.x + result.width <= area.x + area.width &&
								result.y + result.height <= area.y + area.height,
						),
					).toBe(true);
					expect(reachableWindow(result, areas)).toEqual(result);
				},
			),
		));
	it("keeps valid bounds on a negative-coordinate display and returns no guessed bounds without a display", () => {
		const saved = { x: -1500, y: -700, width: 1000, height: 600 };
		expect(
			reachableWindow(saved, [
				{ x: -1920, y: -1080, width: 1920, height: 1080 },
			]),
		).toEqual(saved);
		expect(reachableWindow(saved, [])).toBeUndefined();
	});
});
