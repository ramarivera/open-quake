import { execFile } from "node:child_process";
import { cpus, freemem, networkInterfaces, totalmem } from "node:os";
import { Effect } from "effect";
import type {
	MetricSample,
	ModuleId,
} from "../../../../../packages/edge/src/monitor/monitor-contracts";
import type { MetricCollector } from "../../../../../packages/edge/src/monitor/monitor-service";
import { MonitorCollectionFailed } from "../../shared/monitor-errors";
import {
	parseDisks,
	parseNetworkCounters,
	parsePower,
	parseProcesses,
} from "./native-parsers";

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
				env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LC_ALL: "C" },
			},
			(error, stdout) => (error ? reject(error) : resolve(stdout)),
		);
	});
type Result = Omit<MetricSample, "id" | "collectedAt">;
/** No native dependency: unsupported fields stay absent, never guessed. */
export function nativeCollector(
	platform: NodeJS.Platform = process.platform,
	run: typeof command = command,
): MetricCollector {
	let previousCpu: { idle: number; total: number } | undefined;
	let previousNetwork:
		| { iface: string; up: number; down: number; time: number }
		| undefined;
	const collect = async (
		id: ModuleId,
		signal: AbortSignal,
	): Promise<Result> => {
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
			return {
				state: elapsed > 0 ? "available" : "unavailable",
				values:
					previous && elapsed > 0
						? {
								load: Math.max(
									0,
									Math.min(
										100,
										100 * (1 - (current.idle - previous.idle) / elapsed),
									),
								),
							}
						: {},
			};
		}
		if (id === "gpu" || platform !== "darwin")
			return { state: "unsupported", values: {} };
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
				const iface = Object.entries(networkInterfaces()).find(([, entries]) =>
					entries?.some((entry) => !entry.internal && entry.family === "IPv4"),
				)?.[0];
				if (!iface) return { state: "unavailable", values: {} };
				const counters = parseNetworkCounters(
					await run("/usr/sbin/netstat", ["-ibn"], signal),
					iface,
				);
				if (!counters) return { state: "unavailable", values: { iface } };
				const time = Date.now(),
					previous = previousNetwork;
				previousNetwork = { iface, ...counters, time };
				const seconds = previous ? (time - previous.time) / 1000 : 0;
				return {
					state: "available",
					values: {
						iface,
						...(previous &&
						previous.iface === iface &&
						seconds > 0 &&
						counters.up >= previous.up &&
						counters.down >= previous.down
							? {
									up: (counters.up - previous.up) / seconds,
									down: (counters.down - previous.down) / seconds,
								}
							: {}),
					},
				};
			}
		}
	};
	return {
		collect: (id) =>
			Effect.tryPromise({
				try: (signal) => collect(id, signal),
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
