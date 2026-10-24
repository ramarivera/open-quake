import { describe, expect, it } from "vitest";
import { profileRequestAllowed } from "./profile-permissions";

describe("profile IPC authority", () => {
	const renderer = "file:///application/out/renderer/index.html";
	it("permits read-only app frames and only main-owned management writes", () => {
		expect(
			profileRequestAllowed(
				`${renderer}?surface=panel`,
				renderer,
				true,
				false,
				"read",
			),
		).toBe(true);
		for (const type of [
			"manage",
			"run-command",
			"choose-app",
			"thumbnail",
			"thumbnails",
			"cancel-thumbnails",
		]) {
			expect(
				profileRequestAllowed(
					`${renderer}?surface=management`,
					renderer,
					true,
					false,
					type,
				),
			).toBe(false);
			expect(profileRequestAllowed(renderer, renderer, false, true, type)).toBe(
				false,
			);
			expect(
				profileRequestAllowed(
					"file://host/application/out/renderer/index.html",
					renderer,
					true,
					true,
					type,
				),
			).toBe(false);
			expect(
				profileRequestAllowed(
					"https://example.com/application/out/renderer/index.html",
					renderer,
					true,
					true,
					type,
				),
			).toBe(false);
			expect(profileRequestAllowed(renderer, renderer, true, true, type)).toBe(
				true,
			);
		}
	});
});
