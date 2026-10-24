import type { NetworkInterfaceInfo } from "node:os";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeCollector } from "./native-collector";
import {
	parseDisks,
	parseNetworkCounters,
	parsePower,
	parseProcesses,
} from "./native-parsers";

describe("platform collection boundaries", () => {
	afterEach(() => vi.restoreAllMocks());
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
			source: "ac",
		});
		expect(
			parsePower(
				"Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1) 87%; discharging; 4:12 remaining",
			),
		).toEqual({
			hasBattery: true,
			percent: 87,
			source: "battery",
			batteryState: "discharging",
		});
		expect(parsePower("invalid")).toEqual({});
	});
	it.each([
		["charging", "charging"],
		["charged", "charged"],
		["AC attached; not charging", "not-charging"],
	])(
		"retains AC source independently of battery state %s",
		(native, batteryState) => {
			expect(
				parsePower(
					`Now drawing from 'AC Power'\n -InternalBattery-0 (id=1) 100%; ${native}; 0:00 remaining`,
				),
			).toEqual({
				hasBattery: true,
				source: "ac",
				percent: 100,
				batteryState,
			});
		},
	);
	it("does not invent battery status or accept out-of-range capacity", () => {
		expect(
			parsePower(
				"Now drawing from 'AC Power'\n -InternalBattery-0 (id=1) 255%; unknown;",
			),
		).toEqual({ hasBattery: true, source: "ac" });
	});
	it("samples link counters on an IPv6-only external interface", async () => {
		const interfaces = (): NodeJS.Dict<NetworkInterfaceInfo[]> => ({
			lo0: [
				{
					address: "::1",
					netmask: "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff",
					family: "IPv6",
					mac: "00:00:00:00:00:00",
					internal: true,
					cidr: "::1/128",
					scopeid: 0,
				},
			],
			en0: [
				{
					address: "2001:db8::1",
					netmask: "ffff:ffff:ffff:ffff::",
					family: "IPv6",
					mac: "aa:bb:cc:dd:ee:ff",
					internal: false,
					cidr: "2001:db8::1/64",
					scopeid: 0,
				},
			],
		});
		const now = vi.spyOn(Date, "now").mockReturnValue(1000);
		const run = vi
			.fn()
			.mockResolvedValueOnce(
				"Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll\nen0 1500 <Link#6> aa 5 0 1024 3 0 2048 0",
			)
			.mockResolvedValueOnce(
				"Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll\nen0 1500 <Link#6> aa 5 0 4096 3 0 4096 0",
			);
		const collector = nativeCollector("darwin", run, interfaces);
		expect(await Effect.runPromise(collector.collect("network"))).toEqual({
			state: "available",
			values: { iface: "en0" },
		});
		now.mockReturnValue(2000);
		expect(await Effect.runPromise(collector.collect("network"))).toEqual({
			state: "available",
			values: { iface: "en0", up: 2048, down: 3072 },
		});
		expect(run).toHaveBeenCalledWith(
			"/usr/sbin/netstat",
			["-ibn"],
			expect.any(AbortSignal),
		);
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
