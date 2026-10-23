import { describe, expect, it } from "vitest";
import { canRequestWallpaper } from "./media-permissions";

describe("media IPC caller permissions", () => {
	const renderer = "file:///app/out/renderer/index.html";
	it("allows reads on the panel and mutations only in management", () => {
		expect(canRequestWallpaper(renderer, renderer, { _tag: "import" })).toBe(
			true,
		);
		expect(
			canRequestWallpaper(`${renderer}?surface=panel`, renderer, {
				_tag: "read",
			}),
		).toBe(true);
		expect(
			canRequestWallpaper(`${renderer}?surface=panel`, renderer, {
				_tag: "import",
			}),
		).toBe(false);
	});
	it("rejects remote navigation, other local files, and malformed caller URLs", () => {
		for (const caller of [
			"https://example.test",
			"file:///private/other.html",
			"not a url",
		])
			expect(canRequestWallpaper(caller, renderer, { _tag: "read" })).toBe(
				false,
			);
		expect(
			canRequestWallpaper("http://localhost:9000/", "http://localhost:5186/", {
				_tag: "import",
			}),
		).toBe(false);
		expect(
			canRequestWallpaper(
				"http://localhost:5186/?surface=management",
				"http://localhost:5186/",
				{ _tag: "import" },
			),
		).toBe(true);
	});
});
