import { cpus, type NetworkInterfaceInfo } from "node:os";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeCollector } from "./native-collector";
import {
	parseDisks,
	parseHardwareModel,
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
	it("parses a sysctl model identifier and rejects unexpected output", () => {
		expect(parseHardwareModel("Mac15,12\n")).toBe("Mac15,12");
		expect(parseHardwareModel("hw.model: Mac15,12\n")).toBe("Mac15,12");
		expect(parseHardwareModel("Mac15,12\nprivate detail")).toBeUndefined();
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
	it("keeps unsupported platforms explicitly unsupported", async () => {
		const collector = nativeCollector("freebsd");
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

describe("qualified platform fixtures", () => {
	const iface: () => Record<string, NetworkInterfaceInfo[]> = () => ({
		eth0: [
			{
				address: "10.0.0.2",
				netmask: "255.255.255.0",
				family: "IPv4",
				mac: "00:11:22:33:44:55",
				internal: false,
				cidr: "10.0.0.2/24",
			},
		],
	});
	it("uses typed Windows stdio for CPU, GPU, disks, network, process, power and Bluetooth", async () => {
		let time = 1000;
		const run = vi.fn(async (_file: string, args: readonly string[]) => {
			const script = args.at(-1) ?? "";
			if (script.includes("Win32_Processor")) return '{"load":0}';
			if (script.includes("Win32_VideoController"))
				return '{"model":"Fixture GPU","temperature":55}';
			if (script.includes("Win32_LogicalDisk"))
				return '{"disks":[{"name":"C:","size":100000,"usedPercent":40}]}';
			if (script.includes("Get-NetAdapter"))
				return JSON.stringify({
					iface: "Ethernet",
					up: time * 10,
					down: time * 20,
				});
			if (script.includes("Win32_Battery"))
				return '{"hasBattery":false,"source":"ac"}';
			if (script.includes("Get-PnpDevice")) return '{"devices":0}';
			return '{"all":87}';
		});
		const collector = nativeCollector(
			"win32",
			run,
			iface,
			undefined,
			() => time,
		);
		expect(await Effect.runPromise(collector.collect("cpu"))).toEqual({
			state: "available",
			values: { load: 0 },
		});
		expect((await Effect.runPromise(collector.collect("gpu"))).values).toEqual({
			model: "Fixture GPU",
			temperature: 55,
		});
		expect(
			(await Effect.runPromise(collector.collect("disk"))).values.disks,
		).toHaveLength(1);
		expect(
			(await Effect.runPromise(collector.collect("process"))).values.all,
		).toBe(87);
		expect(
			(await Effect.runPromise(collector.collect("power"))).values,
		).toEqual({ hasBattery: false, source: "ac" });
		expect(
			(await Effect.runPromise(collector.collect("bluetooth"))).values.devices,
		).toBe(0);
		expect(
			(await Effect.runPromise(collector.collect("network"))).values.up,
		).toBeUndefined();
		time = 2000;
		expect(
			(await Effect.runPromise(collector.collect("network"))).values,
		).toEqual({ iface: "Ethernet", up: 10000, down: 20000 });
		expect(
			run.mock.calls.every(
				([file, args]) =>
					file === "powershell.exe" && args.includes("-NonInteractive"),
			),
		).toBe(true);
	});
	it("isolates Windows denial, disconnection, malformed output and rejects fake fields", async () => {
		for (const code of ["EACCES", "EPERM", "ECONNRESET", "ETIMEDOUT"]) {
			const c = nativeCollector("win32", async () => {
				throw Object.assign(new Error("private"), { code });
			});
			expect((await Effect.runPromise(c.collect("gpu"))).state).toBe(
				code === "EACCES" || code === "EPERM" ? "permission-denied" : "error",
			);
			expect((await Effect.runPromise(c.collect("memory"))).state).toBe(
				"available",
			);
		}
		expect(
			(
				await Effect.runPromise(
					nativeCollector("win32", async () => '{"load":"invalid"}').collect(
						"cpu",
					),
				)
			).state,
		).toBe("error");
		expect(
			(
				await Effect.runPromise(
					nativeCollector("win32", async () => "{}").collect("power"),
				)
			).values,
		).toEqual({});
	});
	it("reads Linux GPU/temperature/power/Bluetooth fixtures and caches slow inventory for sixty cycles", async () => {
		const fixture: Record<string, string> = {
			"/sys/class/drm/card0/device/gpu_busy_percent": "0",
			"/sys/class/drm/card0/device/hwmon/hwmon0/temp1_input": "52000",
			"/sys/class/power_supply/BAT0/type": "Battery",
			"/sys/class/power_supply/BAT0/status": "Discharging",
			"/sys/class/power_supply/BAT0/capacity": "67",
		};
		const files = {
			read: async (path: string) => fixture[path] ?? "",
			list: async (path: string) =>
				path === "/sys/class/drm"
					? ["card0"]
					: path.endsWith("/hwmon")
						? ["hwmon0"]
						: path === "/sys/class/power_supply"
							? ["BAT0"]
							: path === "/sys/class/bluetooth"
								? ["hci0"]
								: [],
		};
		const run = vi.fn(
			async () =>
				"Filesystem Type 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 ext4 20000000 10000000 10000000 50% /\ntmpfs tmpfs 20000000 1 1 1% /run\n/dev/sdb1 ext4 100 1 99 1% /tiny",
		);
		const c = nativeCollector("linux", run, iface, files);
		expect((await Effect.runPromise(c.collect("gpu"))).values).toEqual({
			load: 0,
			temperature: 52,
		});
		expect((await Effect.runPromise(c.collect("power"))).values).toEqual({
			hasBattery: true,
			source: "battery",
			percent: 67,
			batteryState: "discharging",
		});
		expect((await Effect.runPromise(c.collect("bluetooth"))).values).toEqual({
			adapters: 1,
		});
		for (let i = 0; i < 60; i++)
			expect(
				(await Effect.runPromise(c.collect("disk"))).values.disks,
			).toHaveLength(1);
		expect(run).toHaveBeenCalledTimes(1);
		await Effect.runPromise(c.collect("disk"));
		expect(run).toHaveBeenCalledTimes(2);
		if (c.reset) await Effect.runPromise(c.reset);
		await Effect.runPromise(c.collect("disk"));
		expect(run).toHaveBeenCalledTimes(3);
	});
	it("qualifies macOS optional GPU and Bluetooth without inventing temperature", async () => {
		const c = nativeCollector("darwin", async (file) =>
			file.endsWith("ioreg")
				? '"Device Utilization %"=0'
				: '{"SPBluetoothDataType":[{"devices_connected":[{}]}]}',
		);
		expect((await Effect.runPromise(c.collect("gpu"))).values).toEqual({
			load: 0,
			model: cpus()[0]?.model.trim(),
			temperatureAvailability: "unsupported-on-mac",
		});
		expect(
			(await Effect.runPromise(c.collect("bluetooth"))).values.connected,
		).toBe(1);
	});
	it("collects cached Mac hardware identity and reports unsupported temperature explicitly", async () => {
		const run = vi.fn(async (file: string) => {
			if (file.endsWith("sysctl")) return "Mac15,12\n";
			if (file.endsWith("ioreg")) return '"Device Utilization %"=0';
			if (file.endsWith("pmset")) return "Now drawing from 'AC Power'\n";
			throw new Error(`Unexpected command: ${file}`);
		});
		const collector = nativeCollector("darwin", run);
		expect(await Effect.runPromise(collector.collect("power"))).toEqual({
			state: "available",
			values: { hasBattery: false, source: "ac" },
		});
		expect(await Effect.runPromise(collector.collect("gpu"))).toEqual({
			state: "available",
			values: {
				load: 0,
				model: `${cpus()[0]?.model.trim()} · Mac15,12`,
				temperatureAvailability: "unsupported-on-mac",
			},
		});
		expect(await Effect.runPromise(collector.collect("cpu"))).toMatchObject({
			values: { temperatureAvailability: "unsupported-on-mac" },
		});
		expect(
			run.mock.calls.filter(([file]) => file.endsWith("sysctl")),
		).toHaveLength(1);
		expect(run.mock.calls.map(([file]) => file)).not.toContain("powermetrics");
	});
	it("reports failed GPU reads as unavailable and retries a failed model lookup", async () => {
		let sysctlCalls = 0;
		const run = vi.fn(async (file: string) => {
			if (file.endsWith("sysctl")) {
				sysctlCalls++;
				if (sysctlCalls === 1) throw new Error("transient");
				return "Mac15,12\n";
			}
			throw new Error("ioreg failed");
		});
		const collector = nativeCollector("darwin", run);
		const first = await Effect.runPromise(collector.collect("gpu"));
		expect(first.state).toBe("unavailable");
		const second = await Effect.runPromise(collector.collect("gpu"));
		if (process.arch === "arm64")
			expect(second.values.model).toBe(`${cpus()[0]?.model.trim()} · Mac15,12`);
		else expect(second.values.model).toBeUndefined();
	});
	it("keeps real battery percentage and charging state from mocked pmset output", async () => {
		const collector = nativeCollector(
			"darwin",
			async () =>
				"Now drawing from 'AC Power'\n -InternalBattery-0 (id=1) 87%; charging; 0:12 remaining",
		);
		expect(await Effect.runPromise(collector.collect("power"))).toEqual({
			state: "available",
			values: {
				hasBattery: true,
				source: "ac",
				percent: 87,
				batteryState: "charging",
			},
		});
	});
});

it.each([
	{ load: "255", temperature: "200000" },
	{ load: "-1", temperature: "0" },
	{ load: "invalid", temperature: "-1000" },
])(
	"skips an unusable first DRM card and collects the next valid GPU: %j",
	async (invalid) => {
		const run = vi.fn(async () => {
			throw new Error("fallback must not run");
		});
		const c = nativeCollector("linux", run, () => ({}), {
			list: async (path) =>
				path === "/sys/class/drm"
					? ["card1", "card0", "card0-DP-1"]
					: path.endsWith("/hwmon")
						? ["hwmon0"]
						: [],
			read: async (path) =>
				path.includes("/card0/")
					? path.endsWith("gpu_busy_percent")
						? invalid.load
						: invalid.temperature
					: path.endsWith("gpu_busy_percent")
						? "42"
						: "52000",
		});
		expect(await Effect.runPromise(c.collect("gpu"))).toEqual({
			state: "available",
			values: { load: 42, temperature: 52 },
		});
		expect(run).not.toHaveBeenCalled();
	},
);
it("skips invalid GPU temperature sensors on the same card", async () => {
	const c = nativeCollector(
		"linux",
		async () => "",
		() => ({}),
		{
			list: async (path) =>
				path === "/sys/class/drm"
					? ["card0"]
					: path.endsWith("/hwmon")
						? ["invalid", "valid"]
						: [],
			read: async (path) =>
				path.endsWith("gpu_busy_percent")
					? ""
					: path.includes("/invalid/")
						? "200000"
						: "52000",
		},
	);
	expect(await Effect.runPromise(c.collect("gpu"))).toEqual({
		state: "available",
		values: { temperature: 52 },
	});
});

it.each(["ENOENT", "ENOTDIR"])(
	"reports missing Linux sysfs classes as unsupported, without fake hardware values: %s",
	async (code) => {
		for (const id of ["bluetooth", "power"] as const) {
			const c = nativeCollector(
				"linux",
				async () => "",
				() => ({}),
				{
					read: async () => {
						throw new Error("no device reads expected");
					},
					list: async () => {
						throw Object.assign(new Error("missing class"), { code });
					},
				},
			);
			expect(await Effect.runPromise(c.collect(id))).toEqual({
				state: "unsupported",
				values: {},
			});
		}
	},
);
it.each(["EACCES", "EPERM", "EIO"])(
	"preserves real Linux class enumeration failures: %s",
	async (code) => {
		for (const id of ["bluetooth", "power"] as const) {
			const c = nativeCollector(
				"linux",
				async () => "",
				() => ({}),
				{
					read: async () => "",
					list: async () => {
						throw Object.assign(new Error("class read failed"), { code });
					},
				},
			);
			expect(await Effect.runPromise(c.collect(id))).toEqual({
				state: code === "EIO" ? "error" : "permission-denied",
				values: {},
			});
		}
	},
);
it("distinguishes a confirmed empty inventory from absent Linux sysfs support", async () => {
	const c = nativeCollector(
		"linux",
		async () => "",
		() => ({}),
		{ read: async () => "", list: async () => [] },
	);
	expect(await Effect.runPromise(c.collect("bluetooth"))).toEqual({
		state: "available",
		values: { adapters: 0 },
	});
	expect(await Effect.runPromise(c.collect("power"))).toEqual({
		state: "available",
		values: { hasBattery: false },
	});
});
