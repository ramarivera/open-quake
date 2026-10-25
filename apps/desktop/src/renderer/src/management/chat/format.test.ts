import { describe, expect, it } from "vitest";
import { fill, relativeTime } from "./format";

describe("conversation list formatting", () => {
	const now = Date.UTC(2026, 9, 25, 12);
	it("fills placeholders and leaves unknown ones empty", () => {
		expect(fill("Message {name}…", { name: "Hermes" })).toBe("Message Hermes…");
		expect(fill("{a}{b}", { a: 1 })).toBe("1");
	});
	it("describes recent updates relatively and older ones by date", () => {
		expect(relativeTime(now - 5_000, now, "en", "Just now")).toBe("Just now");
		expect(relativeTime(now - 5 * 60_000, now, "en", "x")).toBe("5 min. ago");
		expect(relativeTime(now - 3 * 3_600_000, now, "en", "x")).toBe("3 hr. ago");
		expect(relativeTime(now - 30 * 3_600_000, now, "en", "x")).toBe(
			"yesterday",
		);
		expect(relativeTime(Date.UTC(2026, 9, 12, 12), now, "en", "x")).toBe(
			"Oct 12",
		);
	});
});
