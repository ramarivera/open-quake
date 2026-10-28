import type {
	MetricSample,
	ModuleId,
} from "../../../../../../../../packages/edge/src/monitor/monitor-contracts";
import type { StripTileProps } from "../../tileRegistry";
import { monitorKeySettings } from "./key-settings";
import { useMonitor } from "./useMonitor";
import {
	bare,
	percent,
	previewSnapshot,
	rate,
	sampleOf,
	size,
	temperature,
	withUnit,
} from "./view-model";

const ids: Record<string, ModuleId> = {
	cpuInfo: "cpu",
	gpuInfo: "gpu",
	memInfo: "memory",
	diskInfo: "disk",
	processInfo: "process",
	networkInfo: "network",
	powerInfo: "power",
	bluetoothInfo: "bluetooth",
};
export function MetricTile({
	tile,
	context,
}: StripTileProps): React.JSX.Element {
	const live =
		context.interactive !== false &&
		new URLSearchParams(window.location.search).get("surface") === "panel";
	const monitor = useMonitor(live),
		id = ids[tile.type] ?? "cpu";
	return (
		<MetricReadout
			sample={sampleOf(live ? monitor.snapshot : previewSnapshot(), id)}
			unit={monitorKeySettings(tile.key).temperatureUnit}
			preview={!live}
		/>
	);
}
export function MetricReadout({
	sample,
	unit,
	preview = false,
}: {
	sample: MetricSample;
	unit: "celsius" | "fahrenheit";
	preview?: boolean;
}): React.JSX.Element {
	const { id, values: v } = sample;
	const value =
		id === "cpu" || id === "gpu"
			? percent(v.load)
			: id === "memory"
				? size(v.used)
				: id === "process"
					? bare(v.all)
					: id === "disk"
						? v.disks
							? String(v.disks.length)
							: "--"
						: id === "network"
							? `↑ ${withUnit(rate(v.up), "MB/s")} ↓ ${withUnit(rate(v.down), "MB/s")}`
							: id === "power"
								? v.hasBattery === false
									? "AC Power"
									: percent(v.percent)
								: bare(v.connected ?? v.devices ?? v.adapters);
	return (
		<section
			className="monitor-metric-tile"
			data-metric={id}
			data-state={sample.state}
			aria-label={id}
		>
			<span>{id === "bluetooth" ? "Bluetooth" : id.toUpperCase()}</span>
			<strong>{value}</strong>
			{id === "cpu" || id === "gpu" ? (
				<span>
					{v.temperature === undefined &&
					v.temperatureAvailability === "unsupported-on-mac"
						? "Not available on this Mac"
						: temperature(v.temperature, unit)}
					{v.temperature !== undefined &&
					v.temperature > 0 &&
					v.temperature <= 150
						? unit === "fahrenheit"
							? " °F"
							: " °C"
						: ""}
				</span>
			) : null}
			<span>
				{preview
					? "Sample data"
					: sample.state === "available"
						? "Live"
						: sample.state}
			</span>
		</section>
	);
}
