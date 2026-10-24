import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
	realpathSync: vi.fn((path) =>
		path.endsWith("/symlink") ? "/outside" : path,
	),
}));

import { SCRATCH, validateOutput } from "./touch-probe-guards.mjs";

describe("probe scratch boundary without disk or HID", () => {
	it("allows a canonical scratch path and rejects traversal or a symlink escape", () => {
		expect(validateOutput(`${SCRATCH}/frames.jsonl`)).toBe(
			`${SCRATCH}/frames.jsonl`,
		);
		expect(() => validateOutput(`${SCRATCH}/../outside.jsonl`)).toThrow(
			"inside strip-touch scratch",
		);
		expect(() => validateOutput(`${SCRATCH}/symlink/frames.jsonl`)).toThrow(
			"inside strip-touch scratch",
		);
	});
});
