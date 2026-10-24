import { describe, expect, it } from "vitest";
import type { Slots } from "../../../../shared/agents";
import { reconcileSlotDrafts } from "./slot-drafts";

const saved: Slots = {
	"1,5": "main",
	"1,6": "main",
	"2,5": "main",
	"2,6": "main",
};
describe("DK-Claw pending slot assignments", () => {
	it("keeps pending assignments across fresh unrelated model/runtime snapshots", () => {
		const draft = { ...saved, "1,5": "writer" };
		expect(
			reconcileSlotDrafts(draft, saved, { ...saved }, ["main", "writer"]),
		).toEqual(draft);
	});
	it("adopts committed changes only for untouched slots", () => {
		const next = { ...saved, "1,6": "reader", "1,5": "reader" };
		expect(
			reconcileSlotDrafts({ ...saved, "1,5": "writer" }, saved, next, [
				"main",
				"writer",
				"reader",
			]),
		).toEqual({ ...next, "1,5": "writer" });
	});
	it("uses committed fallback when a pending agent was deleted", () => {
		expect(
			reconcileSlotDrafts({ ...saved, "1,5": "deleted" }, saved, saved, [
				"main",
			]),
		).toEqual(saved);
	});
	it("treats acknowledged assignments as the new baseline for later changes", () => {
		const synced = { ...saved, "1,5": "writer" };
		const next = { ...synced, "1,5": "reader" };
		expect(
			reconcileSlotDrafts(synced, synced, next, ["main", "writer", "reader"]),
		).toEqual(next);
	});
});
