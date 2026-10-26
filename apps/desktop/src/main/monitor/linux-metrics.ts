import { readdir, readFile } from "node:fs/promises";
import type {
	MetricValues,
	ModuleId,
} from "../../../../../packages/edge/src/monitor/monitor-contracts";
import { sensorNumber } from "./platform-metrics";
export interface LinuxFiles {
	read(path: string, signal: AbortSignal): Promise<string>;
	list(path: string): Promise<string[]>;
}
export const linuxFiles: LinuxFiles = {
	read: (path, signal) => readFile(path, { encoding: "utf8", signal }),
	list: (path) => readdir(path),
};
const missing = (cause: unknown): boolean =>
	cause instanceof Error &&
	"code" in cause &&
	(cause.code === "ENOENT" || cause.code === "ENOTDIR");
const optional = async <A>(read: () => Promise<A>): Promise<A | undefined> => {
	try {
		return await read();
	} catch (cause) {
		if (missing(cause)) return;
		throw cause;
	}
};
export async function linuxMetrics(
	id: ModuleId,
	files: LinuxFiles,
	signal: AbortSignal,
): Promise<MetricValues> {
	const read = (path: string) => optional(() => files.read(path, signal));
	const list = async (path: string) =>
		(await optional(() => files.list(path))) ?? [];
	if (id === "cpu") {
		for (const hw of await list("/sys/class/hwmon")) {
			const base = `/sys/class/hwmon/${hw}`;
			const name = (await read(`${base}/name`))?.trim();
			if (
				!["coretemp", "k10temp", "zenpower", "cpu_thermal"].includes(name ?? "")
			)
				continue;
			const temperature = sensorNumber(await read(`${base}/temp1_input`), 1000);
			if (temperature !== undefined && temperature > 0 && temperature <= 150)
				return { temperature };
		}
	}
	if (id === "gpu") {
		for (const card of (await list("/sys/class/drm"))
			.filter((c) => /^card\d+$/.test(c))
			.sort()) {
			const base = `/sys/class/drm/${card}/device`;
			const rawLoad = sensorNumber(await read(`${base}/gpu_busy_percent`));
			const load =
				rawLoad !== undefined && rawLoad >= 0 && rawLoad <= 100
					? rawLoad
					: undefined;
			let temperature: number | undefined;
			for (const hw of await list(`${base}/hwmon`)) {
				const candidate = sensorNumber(
					await read(`${base}/hwmon/${hw}/temp1_input`),
					1000,
				);
				if (candidate !== undefined && candidate > 0 && candidate <= 150) {
					temperature = candidate;
					break;
				}
			}
			if (load !== undefined || temperature !== undefined)
				return {
					...(load !== undefined ? { load } : {}),
					...(temperature !== undefined ? { temperature } : {}),
				};
		}
	}
	if (id === "power") {
		let source: "ac" | "battery" | undefined;
		const batteries: string[] = [];
		for (const name of await files.list("/sys/class/power_supply")) {
			const base = `/sys/class/power_supply/${name}`,
				type = (await read(`${base}/type`))?.trim();
			if (type === "Battery") batteries.push(base);
			else if (type === "Mains" || type === "USB" || type === "USB_C") {
				const online = (await read(`${base}/online`))?.trim();
				if (online === "1") source = "ac";
				else if (online === "0" && !source) source = "battery";
			}
		}
		if (!batteries.length)
			return { hasBattery: false, ...(source ? { source } : {}) };
		const base = batteries[0];
		const status = (await read(`${base}/status`))?.trim();
		const percent = sensorNumber(await read(`${base}/capacity`));
		const batteryState =
			status === "Charging"
				? "charging"
				: status === "Discharging"
					? "discharging"
					: status === "Full"
						? "charged"
						: status === "Not charging"
							? "not-charging"
							: undefined;
		return {
			hasBattery: true,
			...(source
				? { source }
				: status === "Discharging"
					? { source: "battery" as const }
					: {}),
			...(percent !== undefined && percent >= 0 && percent <= 100
				? { percent }
				: {}),
			...(batteryState ? { batteryState } : {}),
		};
	}
	if (id === "bluetooth")
		return { adapters: (await files.list("/sys/class/bluetooth")).length };
	return {};
}
