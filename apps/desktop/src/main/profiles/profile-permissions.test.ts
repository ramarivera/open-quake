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
			"thumbnail-style",
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
	it("rejects same-origin document, query and fragment navigation for writes", () => {
		for (const renderer of [
			"http://localhost:5173/index.html",
			"file:///app/index.html",
		]) {
			const expected = `${renderer}?surface=management&rotation=0`;
			expect(
				profileRequestAllowed(
					expected,
					renderer,
					true,
					true,
					"manage",
					expected,
				),
			).toBe(true);
			for (const url of [
				renderer,
				`${expected}&other=1`,
				`${expected}#foreign`,
				`${renderer}?surface=panel`,
				renderer.replace("index.html", "other.html"),
			]) {
				expect(
					profileRequestAllowed(url, renderer, true, true, "manage", expected),
				).toBe(false);
				expect(
					profileRequestAllowed(
						url,
						renderer,
						true,
						true,
						"run-command",
						expected,
					),
				).toBe(false);
			}
			expect(
				profileRequestAllowed(
					expected,
					renderer,
					false,
					true,
					"manage",
					expected,
				),
			).toBe(false);
		}
	});
});
