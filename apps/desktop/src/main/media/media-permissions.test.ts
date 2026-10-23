import { describe, expect, it } from "vitest";
import { canRequestWallpaper } from "./media-permissions";

describe("media IPC caller permissions", () => {
	const renderer = "file:///app/out/renderer/index.html";
	it("allows panel reads and requires management identity for mutations", () => {
		for (const query of ["", "?surface=panel", "?surface=management"]) {
			expect(
				canRequestWallpaper(
					`${renderer}${query}`,
					renderer,
					{ _tag: "read" },
					false,
				),
			).toBe(true);
			for (const tag of ["select", "import", "configure", "clear", "restore"]) {
				expect(
					canRequestWallpaper(
						`${renderer}${query}`,
						renderer,
						{ _tag: tag },
						false,
					),
				).toBe(false);
				expect(
					canRequestWallpaper(
						`${renderer}${query}`,
						renderer,
						{ _tag: tag },
						true,
					),
				).toBe(true);
			}
		}
	});
	it("rejects remote navigation, other local files, and malformed caller URLs", () => {
		for (const caller of [
			"https://example.test",
			"file:///private/other.html",
			"not a url",
		])
			for (const management of [true, false])
				expect(
					canRequestWallpaper(caller, renderer, { _tag: "read" }, management),
				).toBe(false);
		expect(
			canRequestWallpaper(
				"http://localhost:9000/",
				"http://localhost:5186/",
				{ _tag: "import" },
				true,
			),
		).toBe(false);
		expect(
			canRequestWallpaper(
				"http://localhost:5186/?surface=management",
				"http://localhost:5186/",
				{ _tag: "import" },
				false,
			),
		).toBe(false);
		expect(
			canRequestWallpaper(
				"http://localhost:5186/",
				"http://localhost:5186/",
				{ _tag: "import" },
				true,
			),
		).toBe(true);
	});
});
