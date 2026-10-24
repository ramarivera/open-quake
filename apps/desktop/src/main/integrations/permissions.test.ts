import { describe, expect, it } from "vitest";
import { integrationRequestAllowed } from "./permissions";

describe("integration IPC authority", () => {
	it("permits mutations only from the management document main frame", () => {
		const renderer = "file:///app/out/index.html";
		expect(
			integrationRequestAllowed(
				`${renderer}?page=ha`,
				renderer,
				true,
				true,
				"ha.connect",
			),
		).toBe(true);
		expect(
			integrationRequestAllowed(renderer, renderer, true, false, "ha.connect"),
		).toBe(false);
		expect(
			integrationRequestAllowed(renderer, renderer, false, true, "ha.connect"),
		).toBe(false);
		expect(
			integrationRequestAllowed(
				"https://attacker.test",
				renderer,
				true,
				true,
				"ha.connect",
			),
		).toBe(false);
		expect(
			integrationRequestAllowed(
				"file:///app/other.html",
				renderer,
				true,
				true,
				"ha.connect",
			),
		).toBe(false);
		expect(
			integrationRequestAllowed(renderer, renderer, true, false, "ha.live"),
		).toBe(true);
	});
});
