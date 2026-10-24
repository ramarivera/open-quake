import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { nativeCollector } from "./native-collector";
import {
	parseDisks,
	parseNetworkCounters,
	parsePower,
	parseProcesses,
} from "./native-parsers";

describe("platform collection boundaries", () => {
	it("parses APFS data/external mounts without double counting system volumes", () => {
		expect(
			parseDisks(
				"Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s1 100 20 80 20% /\n/dev/disk3s5 100 50 50 50% /System/Volumes/Data\n/dev/disk5s1 200 90 110 45% /Volumes/External Disk\ndevfs 10 10 0 100% /dev",
			),
		).toEqual([
			{ name: "Macintosh HD", size: 102400, usedPercent: 50 },
			{ name: "/Volumes/External Disk", size: 204800, usedPercent: 45 },
		]);
	});
	it("never manufactures battery charge for AC desktops", () => {
		expect(parsePower("Now drawing from 'AC Power'\n")).toEqual({
			hasBattery: false,
		});
		expect(
			parsePower(
				"Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1) 87%; discharging; 4:12 remaining",
			),
		).toEqual({ hasBattery: true, percent: 87, charging: false });
		expect(parsePower("invalid")).toEqual({});
	});
	it("parses process state and link counters without IP row duplication", () => {
		expect(parseProcesses("R\nS+\nU\nI\nZ")).toEqual({
			all: 5,
			running: 1,
			sleeping: 2,
			blocked: 1,
		});
		expect(
			parseNetworkCounters(
				"Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll\nen0 1500 <Link#6> aa 5 0 1024 3 0 2048 0\nen0 1500 192.168 aa 5 0 999 3 0 999 0",
				"en0",
			),
		).toEqual({ up: 2048, down: 1024 });
	});
	it("keeps non-macOS native-only metrics unsupported", async () => {
		const collector = nativeCollector("linux");
		for (const id of ["gpu", "disk", "process", "network", "power"] as const)
			expect(await Effect.runPromise(collector.collect(id))).toEqual({
				state: "unsupported",
				values: {},
			});
		expect(
			(await Effect.runPromise(collector.collect("memory"))).values.total,
		).toBeGreaterThan(0);
	});
	it("isolates permission and missing-command failures from supported modules", async () => {
		for (const code of ["EACCES", "ENOENT"]) {
			const collector = nativeCollector("darwin", async () => {
				throw Object.assign(new Error("private path"), { code });
			});
			expect(await Effect.runPromise(collector.collect("disk"))).toEqual({
				state: code === "EACCES" ? "permission-denied" : "error",
				values: {},
			});
			expect((await Effect.runPromise(collector.collect("memory"))).state).toBe(
				"available",
			);
		}
	});
});
