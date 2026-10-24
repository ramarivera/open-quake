import type {
	MetricSample,
	MetricValues,
	MonitorSnapshot,
} from "../../../../../../../../packages/edge/src/monitor/monitor-contracts";
import { emptySnapshot } from "../../../../../shared/monitor-contracts";

const finite = (n: number | undefined): n is number =>
	n !== undefined && Number.isFinite(n);
export const pct = (n: number | undefined): number | undefined =>
	finite(n) ? Math.max(0, Math.min(100, n)) : undefined;
export const bare = (n: number | undefined): string =>
	finite(n) ? String(Math.round(n)) : "--";
export const withUnit = (value: string, unit: string): string =>
	value === "--" ? value : `${value}${unit}`;
export const percent = (n: number | undefined): string =>
	withUnit(bare(pct(n)), "%");
export const size = (bytes: number | undefined): string =>
	!finite(bytes) || bytes < 0
		? "--"
		: bytes >= 1024 ** 4
			? `${Math.round(bytes / 1024 ** 4)} TB`
			: `${Math.round(bytes / 1024 ** 3)} GB`;
export const rate = (bytes: number | undefined): string =>
	!finite(bytes) || bytes < 0
		? "--"
		: bytes / 1024 ** 2 >= 100
			? String(Math.round(bytes / 1024 ** 2))
			: (bytes / 1024 ** 2).toFixed(1);
export const temperature = (
	c: number | undefined,
	unit: "celsius" | "fahrenheit",
): string =>
	!finite(c) || c <= 0 || c > 150
		? "--"
		: String(Math.round(unit === "fahrenheit" ? (c * 9) / 5 + 32 : c));
export const memoryPercent = (v: MetricValues): number | undefined =>
	finite(v.total) && v.total > 0 && finite(v.used)
		? pct((100 * v.used) / v.total)
		: undefined;
export function diskView(sample: MetricSample) {
	const all = sample.values.disks;
	const visible =
		all && all.length > 8
			? [...all]
					.sort((a, b) => (b.usedPercent ?? -1) - (a.usedPercent ?? -1))
					.slice(0, 8)
			: all;
	return {
		rows:
			visible?.map((d) => ({
				...d,
				name: d.name.replace(/[\\/]+$/, "") || d.name,
				summary: `${percent(d.usedPercent)} / ${size(d.size)}`,
			})) ?? [],
		empty: sample.state === "available" && all?.length === 0,
		overflow:
			all && all.length > 8
				? `+${all.length - 8} drives · highest ${percent(visible?.[0]?.usedPercent)}`
				: undefined,
	};
}
export function sampleOf(
	snapshot: MonitorSnapshot,
	id: MetricSample["id"],
): MetricSample {
	return (
		snapshot.samples.find((sample) => sample.id === id) ?? {
			id,
			state: "unavailable",
			collectedAt: 0,
			values: {},
		}
	);
}
/** Exact WIDGETS-080 fixture. Only a labelled PC preview or mock smoke supplies it. */
export function previewSnapshot(): MonitorSnapshot {
	const values: Readonly<Record<MetricSample["id"], MetricValues>> = {
		cpu: { load: 37, temperature: 52 },
		gpu: { load: 12, temperature: 44, model: "NVIDIA GeForce RTX 4070" },
		memory: {
			total: 32 * 1024 ** 3,
			used: 19.4 * 1024 ** 3,
			free: 12.6 * 1024 ** 3,
		},
		process: { all: 284, running: 96, sleeping: 171, blocked: 17 },
		disk: {
			disks: [
				{ name: "C:", size: 931 * 1024 ** 3, usedPercent: 68 },
				{ name: "D:", size: 1863 * 1024 ** 3, usedPercent: 41 },
				{ name: "E:", size: 465 * 1024 ** 3, usedPercent: 83 },
			],
		},
		network: {
			iface: "WLAN",
			link: "wireless",
			up: 1.8 * 1024 ** 2,
			down: 12.4 * 1024 ** 2,
		},
		power: {
			hasBattery: true,
			source: "battery",
			batteryState: "discharging",
			percent: 87,
		},
	};
	return {
		sampledAt: 1,
		samples: emptySnapshot().samples.map((sample) => ({
			...sample,
			state: "available",
			collectedAt: 1,
			values: values[sample.id],
		})),
	};
}
