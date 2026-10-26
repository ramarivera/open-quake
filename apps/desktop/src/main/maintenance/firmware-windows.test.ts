import { win32 } from "node:path";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { firmwareFiles } from "./firmware-files";
import { windowsDfuDiscovery, windowsDfuPaths } from "./volume-discovery";

// No Windows drive is touched. Only the filesystem calls used by discovery are supplied.
vi.mock("node:path", async (original) => {
	const paths = await original<typeof import("node:path")>();
	return {
		...paths,
		basename: paths.win32.basename,
		join: paths.win32.join,
		resolve: paths.win32.resolve,
	};
});
vi.mock("node:fs/promises", async (original) => ({
	...(await original<typeof import("node:fs/promises")>()),
	lstat: async (path: string) => ({
		isDirectory: () => /^[EF]:\\$/.test(path),
		isFile: () => path.endsWith("INFO_UF2.TXT"),
		isSymbolicLink: () => false,
		size: 64,
		dev: 1,
		ino: path.startsWith("E:") ? 10 : 20,
	}),
	realpath: async (path: string) => path,
	stat: async () => ({ dev: 0 }),
	readFile: async () => "UF2 Board-ID: QUAKE RP2040",
}));

describe("synthetic Windows boot drives", () => {
	it("treats failed optional probes as empty polls and recovers later", async () => {
		const probe = vi
			.fn()
			.mockRejectedValueOnce(new Error("PowerShell timeout"))
			.mockRejectedValueOnce(new SyntaxError("invalid discovery JSON"))
			.mockResolvedValue(["E:\\"]);
		const files = firmwareFiles([], [], probe);
		expect(await Effect.runPromise(files.discover())).toEqual([]);
		expect(await Effect.runPromise(files.discover())).toEqual([]);
		expect(await Effect.runPromise(files.discover())).toHaveLength(1);
		expect(probe).toHaveBeenLastCalledWith(false);
	});

	it("carries recognizable drive letters from discovery to distinct volume choices", async () => {
		const paths = windowsDfuPaths(
			["E:", "F:"].map((DeviceID) => ({
				DeviceID,
				VolumeName: "QUAKE DFU",
				DriveType: 2,
			})),
		);
		expect(paths).toEqual(["E:\\", "F:\\"]);
		const files = firmwareFiles([], [], async () => paths);
		const volumes = await Effect.runPromise(files.discover());
		expect(volumes.map((volume) => volume.label)).toEqual([
			"QUAKE DFU (E:\\)",
			"QUAKE DFU (F:\\)",
		]);
		expect(new Set(volumes.map((volume) => volume.id)).size).toBe(2);
		for (const [index, volume] of volumes.entries())
			expect(files.pathFor(volume.id)).toBe(win32.resolve(paths[index] ?? ""));
	});
});

for (const failFirst of [false, true]) {
	it(`caches 500ms discovery polls for 5s, including failed probes=${failFirst}`, async () => {
		let time = 0;
		const query = vi.fn(
			async () => '[{"DeviceID":"E:","VolumeName":"QUAKE DFU","DriveType":2}]',
		);
		if (failFirst) query.mockRejectedValueOnce(new Error("synthetic timeout"));
		const discover = windowsDfuDiscovery(query, () => time);
		const first = discover();
		const concurrent = discover();
		expect(concurrent).toBe(first);
		await first.catch(() => []);
		for (time = 500; time < 5000; time += 500) await discover();
		expect(query).toHaveBeenCalledTimes(1);
		time = 4999;
		await discover();
		expect(query).toHaveBeenCalledTimes(1);
		time = 5000;
		expect(await discover()).toEqual(["E:\\"]);
		expect(query).toHaveBeenCalledTimes(2);
		await discover(true);
		expect(query).toHaveBeenCalledTimes(3);
	});
}
