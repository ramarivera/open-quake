import { expect, it } from "vitest";
import { smokeFont } from "./smoke-font";

it.each(["darwin", "linux", "win32"] as const)(
	"resolves a real font on %s with fallback",
	async (platform) => {
		const paths: string[] = [];
		const result = await smokeFont(platform, undefined, async (path) => {
			paths.push(path);
			if (paths.length === 1) throw new Error("not installed");
			return Buffer.from("synthetic font seam");
		});
		expect(paths).toHaveLength(2);
		expect(result.length).toBeGreaterThan(0);
		if (platform !== "darwin")
			expect(paths.some((p) => p.startsWith("/System"))).toBe(false);
	},
);
it("honors an explicit font and fails clearly instead of skipping decode", async () => {
	await expect(
		smokeFont("linux", "/fixture.ttf", async (path) => {
			expect(path).toBe("/fixture.ttf");
			throw new Error("missing");
		}),
	).rejects.toThrow("OPEN_QUAKE_SMOKE_FONT");
});
