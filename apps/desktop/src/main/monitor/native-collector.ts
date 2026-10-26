import { execFile } from "node:child_process";
import { cpus, freemem, networkInterfaces, totalmem } from "node:os";
import { Effect, Schema } from "effect";
import type {
	MetricSample,
	ModuleId,
} from "../../../../../packages/edge/src/monitor/monitor-contracts";
import type { MetricCollector } from "../../../../../packages/edge/src/monitor/monitor-service";
import { MonitorCollectionFailed } from "../../shared/monitor-errors";
import { type LinuxFiles, linuxFiles, linuxMetrics } from "./linux-metrics";
import {
	parseDisks,
	parseNetworkCounters,
	parsePower,
	parseProcesses,
} from "./native-parsers";
import {
	parseLinuxDisks,
	parseLinuxNetwork,
	parseMetricJson,
	windowsMetricScript,
} from "./platform-metrics";

const command = (
	file: string,
	args: readonly string[],
	signal: AbortSignal,
): Promise<string> =>
	new Promise((resolve, reject) => {
		execFile(
			file,
			args,
			{
				signal,
				timeout: 2000,
				maxBuffer: 1024 * 1024,
				encoding: "utf8",
				windowsHide: true,
				env:
					process.platform === "win32"
						? process.env
						: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LC_ALL: "C" },
			},
			(error, stdout) => (error ? reject(error) : resolve(stdout)),
		);
	});
type Result = Omit<MetricSample, "id" | "collectedAt">;
/** No native dependency: unsupported fields stay absent, never guessed. */
export function nativeCollector(
	platform: NodeJS.Platform = process.platform,
	run: typeof command = command,
	interfaces: typeof networkInterfaces = networkInterfaces,
	files: LinuxFiles = linuxFiles,
	now: () => number = Date.now,
): MetricCollector {
	let previousCpu: { idle: number; total: number } | undefined;
	let previousNetwork:
		| { iface: string; up: number; down: number; time: number }
		| undefined;
	const slow = new Map<ModuleId, { remaining: number; result: Result }>();
	const externalInterface = () =>
		Object.entries(interfaces()).find(([, entries]) =>
			entries?.some(
				(entry) =>
					!entry.internal &&
					(entry.family === "IPv4" || entry.family === "IPv6"),
			),
		)?.[0];
	const networkRate = (values: Result["values"]): Result => {
		const { iface, up, down } = values;
		if (!iface || up === undefined || down === undefined)
			return { state: "unavailable", values: iface ? { iface } : {} };
		const time = now(),
			previous = previousNetwork;
		previousNetwork = { iface, up, down, time };
		const seconds = previous ? (time - previous.time) / 1000 : 0;
		return {
			state: "available",
			values: {
				iface,
				...(previous &&
				previous.iface === iface &&
				seconds > 0 &&
				up >= previous.up &&
				down >= previous.down
					? {
							up: (up - previous.up) / seconds,
							down: (down - previous.down) / seconds,
						}
					: {}),
			},
		};
	};
	const collect = async (
		id: ModuleId,
		signal: AbortSignal,
	): Promise<Result> => {
		if (platform === "win32") {
			if (id !== "memory") {
				const values = parseMetricJson(
					await run(
						"powershell.exe",
						[
							"-NoLogo",
							"-NoProfile",
							"-NonInteractive",
							"-Command",
							windowsMetricScript(id),
						],
						signal,
					),
				);
				return id === "network"
					? networkRate(values)
					: {
							state: Object.keys(values).length ? "available" : "unavailable",
							values,
						};
			}
		}
		if (id === "memory") {
			const total = totalmem(),
				free = freemem();
			return {
				state: "available",
				values: { total, free, used: total - free },
			};
		}
		if (id === "cpu") {
			const entries = cpus();
			if (!entries.length) return { state: "unsupported", values: {} };
			const current = entries.reduce(
				(sum, cpu) => ({
					idle: sum.idle + cpu.times.idle,
					total:
						sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0),
				}),
				{ idle: 0, total: 0 },
			);
			const previous = previousCpu;
			previousCpu = current;
			const elapsed = previous ? current.total - previous.total : 0;
			let temperature = {};
			if (platform === "linux") {
				try {
					temperature = await linuxMetrics("cpu", files, signal);
				} catch {
					/* Optional sensor cannot hide CPU load. */
				}
			}
			return {
				state:
					elapsed > 0 || Object.keys(temperature).length
						? "available"
						: "unavailable",
				values: {
					...temperature,
					...(previous && elapsed > 0
						? {
								load: Math.max(
									0,
									Math.min(
										100,
										100 * (1 - (current.idle - previous.idle) / elapsed),
									),
								),
							}
						: {}),
				},
			};
		}
		if (platform === "linux") {
			if (id === "disk")
				return {
					state: "available",
					values: parseLinuxDisks(await run("/bin/df", ["-kPT"], signal)),
				};
			if (id === "process")
				return {
					state: "available",
					values: parseProcesses(
						await run("/bin/ps", ["-A", "-o", "state="], signal),
					),
				};
			if (id === "network") {
				const iface = externalInterface();
				return iface
					? networkRate(
							parseLinuxNetwork(
								await files.read("/proc/net/dev", signal),
								iface,
							),
						)
					: { state: "unavailable", values: {} };
			}
			let values = await linuxMetrics(id, files, signal);
			if (id === "gpu" && !Object.keys(values).length) {
				try {
					const row = (
						await run(
							"nvidia-smi",
							[
								"--query-gpu=utilization.gpu,temperature.gpu,name",
								"--format=csv,noheader,nounits",
							],
							signal,
						)
					)
						.trim()
						.split("\n")[0]
						?.split(",");
					const load = Number(row?.[0]),
						temperature = Number(row?.[1]);
					values = {
						...(Number.isFinite(load) && load >= 0 && load <= 100
							? { load }
							: {}),
						...(Number.isFinite(temperature) &&
						temperature > 0 &&
						temperature <= 150
							? { temperature }
							: {}),
						...(row?.[2]?.trim() ? { model: row[2].trim() } : {}),
					};
				} catch (cause) {
					if (
						!(
							cause instanceof Error &&
							"code" in cause &&
							cause.code === "ENOENT"
						)
					)
						throw cause;
				}
			}
			return {
				state: Object.keys(values).length ? "available" : "unsupported",
				values,
			};
		}
		if (platform !== "darwin") return { state: "unsupported", values: {} };
		if (id === "gpu") {
			const text = await run(
				"/usr/sbin/ioreg",
				["-r", "-c", "IOAccelerator"],
				signal,
			);
			const load = /"Device Utilization %"\s*[=:]\s*(\d+)/.exec(text)?.[1];
			return load !== undefined && Number(load) <= 100
				? { state: "available", values: { load: Number(load) } }
				: { state: "unsupported", values: {} };
		}
		if (id === "bluetooth") {
			const raw = JSON.parse(
				await run(
					"/usr/sbin/system_profiler",
					["SPBluetoothDataType", "-json"],
					signal,
				),
			);
			const decoded = Schema.decodeUnknownSync(
				Schema.Struct({
					SPBluetoothDataType: Schema.Array(
						Schema.Struct({
							devices_connected: Schema.optional(Schema.Array(Schema.Unknown)),
						}),
					),
				}),
			)(raw);
			const records = decoded.SPBluetoothDataType.filter(
				(v) => v.devices_connected !== undefined,
			);
			return records.length
				? {
						state: "available",
						values: {
							connected: records.reduce(
								(sum, v) => sum + (v.devices_connected?.length ?? 0),
								0,
							),
						},
					}
				: { state: "unavailable", values: {} };
		}
		switch (id) {
			case "disk":
				return {
					state: "available",
					values: {
						disks: parseDisks(await run("/bin/df", ["-kP"], signal)),
					},
				};
			case "process":
				return {
					state: "available",
					values: parseProcesses(
						await run("/bin/ps", ["-A", "-o", "state="], signal),
					),
				};
			case "power":
				return {
					state: "available",
					values: parsePower(
						await run("/usr/bin/pmset", ["-g", "batt"], signal),
					),
				};
			case "network": {
				const iface = externalInterface();
				if (!iface) return { state: "unavailable", values: {} };
				const counters = parseNetworkCounters(
					await run("/usr/sbin/netstat", ["-ibn"], signal),
					iface,
				);
				return counters
					? networkRate({ iface, ...counters })
					: { state: "unavailable", values: { iface } };
			}
		}
	};
	return {
		reset: Effect.sync(() => {
			previousCpu = undefined;
			previousNetwork = undefined;
			slow.clear();
		}),
		collect: (id) =>
			Effect.tryPromise({
				try: async (signal) => {
					const cached = slow.get(id);
					if (cached && cached.remaining-- > 0) return cached.result;
					const result = await collect(id, signal);
					if (
						(id === "disk" || id === "bluetooth") &&
						result.state === "available"
					)
						slow.set(id, { remaining: 59, result });
					return result;
				},
				catch: (cause) => new MonitorCollectionFailed(cause),
			}).pipe(
				Effect.catchTag("MonitorCollectionFailed", (error) =>
					Effect.succeed<Result>({
						state:
							error.originalCause instanceof Error &&
							"code" in error.originalCause &&
							(error.originalCause.code === "EPERM" ||
								error.originalCause.code === "EACCES")
								? "permission-denied"
								: "error",
						values: {},
					}),
				),
			),
	};
}
