import { createContext, useContext, useEffect, useRef, useState } from "react";
import type {
	MetricSample,
	MonitorSnapshot,
} from "../../../../../../../../packages/edge/src/monitor/monitor-contracts";
import type {
	MediaView,
	MonitorSettings,
	StyleId,
} from "../../../../../shared/monitor-contracts";
import { stripPaletteProperties } from "../../palette";
import { mountDiskScroll } from "./disk-scroll";
import { labels as l, settingsLabels } from "./strings";
import {
	bare,
	diskView,
	memoryPercent,
	pct,
	percent,
	rate,
	sampleOf,
	size,
	temperature,
	withUnit,
} from "./view-model";
import "./monitor.css";

const palette = stripPaletteProperties();

const PanelStyle = createContext<StyleId>("glass");

type Children = { children: React.ReactNode; className?: string };
const Card = ({ children, className = "" }: Children): React.JSX.Element => (
	<div className={`monitor-card ${className}`}>{children}</div>
);
const Heading = ({ children }: Children): React.JSX.Element => (
	<div className="monitor-heading">{children}</div>
);
const Bar = ({ value }: { value: number | undefined }): React.JSX.Element => (
	<div className="monitor-bar" data-unknown={value === undefined}>
		<div
			style={{
				transform: `scaleX(${(pct(value) ?? 0) / 100})`,
				visibility: value === undefined ? "hidden" : "visible",
			}}
		/>
	</div>
);
const Value = ({
	value,
	unit = "",
	id,
}: {
	value: string;
	unit?: string;
	id: string;
}): React.JSX.Element => (
	<div className="monitor-value" data-testid={`sys-monitor-value-${id}`}>
		{value}
		{value === "--" ? null : <small>{unit}</small>}
	</div>
);
function Status({
	sample,
}: {
	sample: MetricSample;
}): React.JSX.Element | null {
	return sample.state === "available" ? null : (
		<span
			className="monitor-state"
			title={
				sample.collectedAt
					? new Date(sample.collectedAt).toISOString()
					: "No sample"
			}
		>
			{sample.state === "stale" ? "Stale" : `Unavailable · ${sample.state}`}
		</span>
	);
}
function Processor({
	sample,
	unit,
}: {
	sample: MetricSample;
	unit: MonitorSettings["temperatureUnit"];
}): React.JSX.Element {
	const v = sample.values,
		id = sample.id;
	const style = useContext(PanelStyle);
	return (
		<div
			className={`monitor-processor monitor-${id}`}
			data-testid={`sys-monitor-module-${id}`}
			data-state={sample.state}
		>
			<div className="monitor-processor-row">
				<div>
					<Value value={bare(pct(v.load))} unit="%" id={`${id}-load`} />
					<Heading>{id === "cpu" ? l.cpuLoad : l.gpuLoad}</Heading>
					<Status sample={sample} />
				</div>
				<div className="monitor-temperature">
					<Value
						value={temperature(v.temperature, unit)}
						unit={unit === "celsius" ? "°C" : "°F"}
						id={`${id}-temp`}
					/>
					<Heading>
						{style === "cyber" && id === "cpu"
							? "Temp_Critical"
							: style === "anime" && v.temperature === undefined
								? l.tempNA
								: l.temperature}
					</Heading>
					{v.temperature === undefined ? (
						<span className="monitor-field-unavailable">Unavailable</span>
					) : null}
				</div>
			</div>
			<Bar value={v.load} />
		</div>
	);
}
function Memory({ sample }: { sample: MetricSample }): React.JSX.Element {
	const v = sample.values;
	return (
		<div
			className="monitor-memory"
			data-testid="sys-monitor-module-mem"
			data-state={sample.state}
		>
			<Heading>{l.memory}</Heading>
			<span className="monitor-total">
				{size(v.total)} {l.total}
			</span>
			<Value value={bare(memoryPercent(v))} unit="%" id="mem-used" />
			<Status sample={sample} />
			<Bar value={memoryPercent(v)} />
			<div className="monitor-pair">
				<span>
					<b data-testid="sys-monitor-value-mem-used-gb">{size(v.used)}</b>{" "}
					{l.used}
				</span>
				<span>
					<b data-testid="sys-monitor-value-mem-free">{size(v.free)}</b>{" "}
					{l.free}
				</span>
			</div>
		</div>
	);
}
function Processes({
	sample,
	title,
}: {
	sample: MetricSample;
	title?: string;
}): React.JSX.Element {
	const v = sample.values;
	const style = useContext(PanelStyle);
	return (
		<div
			className="monitor-process"
			data-testid="sys-monitor-module-process"
			data-state={sample.state}
		>
			<Heading>{title ?? l.processes}</Heading>
			<div className="monitor-process-total">
				<Value
					value={bare(v.all)}
					unit={style === "tactical" ? l.totalThreads : l.tasks}
					id="process-all"
				/>
			</div>
			<Status sample={sample} />
			<div className="monitor-process-bars">
				{[v.running, v.sleeping, v.blocked].map((n, i) => (
					<div
						key={["run", "sleep", "block"][i]}
						style={{
							flexGrow: n ?? 0,
							visibility: n === undefined ? "hidden" : "visible",
						}}
					/>
				))}
			</div>
			<div className="monitor-process-counts">
				{(
					[
						["running", l.stateRunning],
						["sleeping", l.sleepWord],
						["blocked", l.blockWord],
					] as const
				).map(([key, text]) => (
					<div key={key}>
						<b data-testid={`sys-monitor-value-process-${key}`}>
							{bare(v[key])}
						</b>
						<span>{text}</span>
					</div>
				))}
			</div>
		</div>
	);
}
function Disks({
	sample,
	title,
}: {
	sample: MetricSample;
	title?: string;
}): React.JSX.Element {
	const ref = useRef<HTMLElement>(null),
		disks = diskView(sample);
	useEffect(() => {
		if (ref.current) return mountDiskScroll(ref.current);
	}, []);
	return (
		<div
			className="monitor-disks"
			data-testid="sys-monitor-module-disk"
			data-state={sample.state}
		>
			<Heading>{title ?? l.storage}</Heading>
			<Status sample={sample} />
			<section
				ref={ref}
				className="monitor-disk-list"
				data-quake-sub-touch="smDiskList"
				data-support-quake-move="true"
				aria-label="Storage drives"
			>
				{disks.empty ? (
					<p>{l.noDiskDetected}</p>
				) : disks.rows.length === 0 ? (
					<p>Unavailable</p>
				) : (
					disks.rows.map((disk) => (
						<div key={disk.name} className="monitor-disk-row">
							<div className="monitor-disk-label">
								<span>
									{l.disk} ({disk.name})
								</span>
								<span data-testid={`sys-monitor-value-disk-${disk.name}`}>
									{disk.summary}
								</span>
							</div>
							<Bar value={disk.usedPercent} />
						</div>
					))
				)}
				{disks.overflow ? (
					<p className="monitor-overflow">{disks.overflow}</p>
				) : null}
			</section>
		</div>
	);
}
function Network({ sample }: { sample: MetricSample }): React.JSX.Element {
	const v = sample.values;
	const style = useContext(PanelStyle);
	return (
		<div
			className="monitor-network"
			data-testid="sys-monitor-module-net"
			data-state={sample.state}
		>
			<Heading>
				{l.interface}{" "}
				<span data-testid="sys-monitor-value-net-iface">
					{v.iface || l.network}
				</span>
			</Heading>
			<Status sample={sample} />
			<div className="monitor-network-rates">
				<div>
					<span>{style === "tactical" ? l.upShort : `↑ ${l.transmit}`}</span>
					<Value value={rate(v.up)} unit="MB/s" id="net-up" />
				</div>
				<div>
					<span>{style === "tactical" ? l.downShort : `↓ ${l.receive}`}</span>
					<Value value={rate(v.down)} unit="MB/s" id="net-down" />
				</div>
			</div>
			{style === "tactical" ? (
				<span className="monitor-link">WLAN_PRIMARY</span>
			) : v.link ? (
				<span className="monitor-link">{v.link}</span>
			) : null}
		</div>
	);
}
function Power({ sample }: { sample: MetricSample }): React.JSX.Element {
	const v = sample.values;
	const style = useContext(PanelStyle);
	const hasBattery = v.hasBattery === true;
	const status =
		v.hasBattery === false && v.source === "ac"
			? l.acPower
			: v.batteryState === "charging"
				? l.charging
				: v.batteryState === "discharging"
					? l.discharging
					: v.batteryState === "charged"
						? l.charged
						: v.batteryState === "not-charging"
							? l.notCharging
							: "Unavailable";
	return (
		<div
			className="monitor-power"
			data-testid="sys-monitor-module-battery"
			data-state={sample.state}
		>
			<Heading>
				{style === "cyber"
					? "Power_Core"
					: style === "tactical"
						? "[PWR]"
						: l.energyStatus}
			</Heading>
			<span className="monitor-total">{l.systemPowerSource}</span>
			<Value
				value={hasBattery ? bare(pct(v.percent)) : "--"}
				unit="%"
				id="battery-percent"
			/>
			<Heading>{l.currentCapacity}</Heading>
			<Status sample={sample} />
			<div className="monitor-battery-segments" aria-hidden="true">
				{[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((threshold) => (
					<span
						key={threshold}
						data-filled={
							hasBattery && v.percent !== undefined && v.percent >= threshold
						}
					/>
				))}
			</div>
			<div className="monitor-power-details">
				<span>{l.powerState}</span>
				<b data-testid="sys-monitor-battery-status">{status}</b>
				<span>{l.supplyMode}</span>
				<b data-testid="sys-monitor-power-source">
					{v.source === undefined
						? "--"
						: v.source === "battery"
							? style === "cyber"
								? "ON_BATTERY"
								: l.batteryPower
							: l.acPower}
				</b>
			</div>
		</div>
	);
}
function Analog({
	sample,
	memory,
	unit,
}: {
	sample: MetricSample;
	memory?: boolean;
	unit: MonitorSettings["temperatureUnit"];
}): React.JSX.Element {
	const v = sample.values,
		value = memory ? memoryPercent(v) : pct(v.load);
	return (
		<div
			className="monitor-analog"
			data-testid={`sys-monitor-module-${memory ? "mem" : sample.id}`}
			data-state={sample.state}
		>
			<div className="monitor-gauge">
				<div className="monitor-gauge-ticks" />
				<span className="monitor-gauge-caption">
					{memory
						? l.memUsedPct
						: sample.id === "cpu"
							? l.cpuLoadPct
							: l.gpuLoadPct}
				</span>
				<b
					data-testid={`sys-monitor-value-${memory ? "mem-used" : `${sample.id}-load`}`}
				>
					{bare(value)}
				</b>
				{value !== undefined ? (
					<div
						className="monitor-needle"
						style={{ transform: `rotate(${value * 2.7 - 135}deg)` }}
					/>
				) : null}
				<i />
			</div>
			<div className="monitor-analog-plate">
				<Heading>
					{memory
						? `${size(v.total)} ${l.capacity}`
						: sample.id === "cpu"
							? l.tempStatus
							: v.model || "--"}
				</Heading>
				<b
					data-testid={`sys-monitor-value-${memory ? "mem-used-gb" : `${sample.id}-temp`}`}
				>
					{memory
						? size(v.used)
						: withUnit(
								temperature(v.temperature, unit),
								unit === "celsius" ? "°C" : "°F",
							)}
				</b>
				{memory ? (
					<small>
						{l.used} · {size(v.free)} {l.free}
					</small>
				) : null}
				<Status sample={sample} />
			</div>
		</div>
	);
}
function Canvas({
	settings,
	snapshot,
}: {
	settings: MonitorSettings;
	snapshot: MonitorSnapshot;
}): React.JSX.Element {
	const cpu = sampleOf(snapshot, "cpu"),
		gpu = sampleOf(snapshot, "gpu"),
		mem = sampleOf(snapshot, "memory"),
		process = sampleOf(snapshot, "process"),
		disk = sampleOf(snapshot, "disk"),
		net = sampleOf(snapshot, "network"),
		power = sampleOf(snapshot, "power");
	const processors = (
		<>
			<Processor sample={cpu} unit={settings.temperatureUnit} />
			<Processor sample={gpu} unit={settings.temperatureUnit} />
		</>
	);
	const model = (
		<div className="monitor-model">
			<Heading>
				{settings.styleId === "anime"
					? l.activeGraphicsUnit
					: l.hardwareIdentifier}
			</Heading>
			<span data-testid="sys-monitor-value-gpu-model">
				{gpu.values.model || "--"}
			</span>
		</div>
	);
	switch (settings.styleId) {
		case "glass":
			return (
				<div className="monitor-layout">
					<Card className="monitor-compute">
						<div>
							<Heading>{l.systemPerformance}</Heading>
							<span className="monitor-subtitle">{l.primaryCoreCluster}</span>
						</div>
						<div className="monitor-compute-values">{processors}</div>
						{model}
					</Card>
					<div className="monitor-middle">
						<Card>
							<Memory sample={mem} />
						</Card>
						<Card>
							<Processes sample={process} />
						</Card>
					</div>
					<Card className="monitor-storage-network">
						<Disks sample={disk} title={l.storageNetwork} />
						<Network sample={net} />
					</Card>
					<Card className="monitor-energy">
						<Power sample={power} />
					</Card>
				</div>
			);
		case "cyber":
			return (
				<>
					<div className="monitor-ticker">
						{`${l.systemStatus} // CPU ${percent(cpu.values.load)} // GPU ${percent(gpu.values.load)} // MEM ${percent(memoryPercent(mem.values))} // NET ${withUnit(rate(net.values.up), "MB/s")}`}
					</div>
					<div className="monitor-layout">
						<Card>
							<Heading>CPU_CORE_MGMT</Heading>
							<Processor sample={cpu} unit={settings.temperatureUnit} />
						</Card>
						<Card>
							<Heading>GPU_RENDER_GRID</Heading>
							<Processor sample={gpu} unit={settings.temperatureUnit} />
							{model}
						</Card>
						<Card>
							<Heading>SYS_PHYS_MEM</Heading>
							<Memory sample={mem} />
						</Card>
						<Card>
							<Processes sample={process} title="Process_Queue" />
						</Card>
						<Card>
							<Disks sample={disk} title="Storage_Nodes" />
						</Card>
						<div className="monitor-last">
							<Card>
								<Network sample={net} />
							</Card>
							<Card>
								<Power sample={power} />
							</Card>
						</div>
					</div>
					<div className="monitor-scanline" />
				</>
			);
		case "anime":
			return (
				<div className="monitor-layout">
					<Card className="monitor-compute">
						<span className="monitor-pill">{l.systemCore}</span>
						<Heading>{l.cpuGpuActivity}</Heading>
						<div className="monitor-compute-values">{processors}</div>
						{model}
					</Card>
					<div className="monitor-middle">
						<div className="monitor-middle-top">
							<Card>
								<Memory sample={mem} />
							</Card>
							<Card>
								<Processes sample={process} />
							</Card>
						</div>
						<Card>
							<Disks sample={disk} title={l.storage} />
						</Card>
					</div>
					<div className="monitor-last">
						<Card>
							<Power sample={power} />
						</Card>
						<Card>
							<Network sample={net} />
						</Card>
					</div>
					{["yellow", "pink", "blue"].map((tint) => (
						<span
							key={tint}
							className={`monitor-sparkle ${tint}`}
							aria-hidden="true"
						>
							✦
						</span>
					))}
				</div>
			);
		case "tactical":
			return (
				<div className="monitor-layout">
					<div className="monitor-compute">
						<Card>
							<Heading>[CPU]</Heading>
							<Processor sample={cpu} unit={settings.temperatureUnit} />
						</Card>
						<Card>
							<Heading>[GPU] {gpu.values.model || "--"}</Heading>
							<Processor sample={gpu} unit={settings.temperatureUnit} />
						</Card>
						<Card>
							<Memory sample={mem} />
						</Card>
					</div>
					<Card className="monitor-tasks">
						<Processes sample={process} title="ACTIVE_TASK_SCHEDULER" />
					</Card>
					<div className="monitor-right">
						<Card>
							<Disks sample={disk} title="DRIVE_MANIFEST" />
						</Card>
						<div className="monitor-bottom">
							<Card>
								<Network sample={net} />
							</Card>
							<Card>
								<Power sample={power} />
							</Card>
						</div>
					</div>
				</div>
			);
		case "wasteland":
			return (
				<div className="monitor-layout">
					<div className="monitor-gauges">
						<Analog sample={cpu} unit={settings.temperatureUnit} />
						<Analog sample={gpu} unit={settings.temperatureUnit} />
						<Analog sample={mem} memory unit={settings.temperatureUnit} />
					</div>
					<div className="monitor-right">
						<div className="monitor-top">
							<Card>
								<Disks sample={disk} title={l.storageDrives} />
							</Card>
							<Card>
								<Network sample={net} />
							</Card>
						</div>
						<div className="monitor-bottom">
							<Card>
								<Processes sample={process} title={l.activeTaskSubsystems} />
							</Card>
							<Card>
								<Power sample={power} />
							</Card>
						</div>
					</div>
					{["tl", "tr", "bl", "br"].map((pos) => (
						<i key={pos} className={`monitor-rivet ${pos}`} />
					))}
				</div>
			);
	}
}
function PanelWithMedia({
	settings,
	snapshot,
	media,
	preview = false,
}: {
	settings: MonitorSettings;
	snapshot: MonitorSnapshot;
	media?: MediaView | undefined;
	preview?: boolean;
}): React.JSX.Element {
	const [failed, setFailed] = useState(false);
	const [playing, setPlaying] = useState(false);
	const custom =
		settings.background === "custom" && media?.available && !failed;
	const invalid =
		settings.background === "custom" && (media?.available === false || failed);
	useEffect(() => {
		if (!custom || media.kind !== "video" || playing) return;
		const timer = setTimeout(() => setFailed(true), 5000);
		return () => clearTimeout(timer);
	}, [custom, media, playing]);
	return (
		<section
			className="oq-monitor"
			style={palette}
			data-style={settings.styleId}
			data-background={settings.background}
			data-testid="sys-monitor-view"
			aria-label="System monitor"
		>
			{settings.background !== "none" ? (
				<div className="monitor-built-in" aria-hidden="true" />
			) : null}
			{custom ? (
				media.kind === "image" ? (
					<img
						className="monitor-background"
						src={media.url}
						alt=""
						onError={() => setFailed(true)}
					/>
				) : (
					<video
						className="monitor-background"
						src={media.url}
						autoPlay
						muted
						loop
						playsInline
						onPlaying={() => setPlaying(true)}
						onError={() => setFailed(true)}
					/>
				)
			) : null}
			<div className="monitor-scrim" />
			<PanelStyle.Provider value={settings.styleId}>
				<Canvas settings={settings} snapshot={snapshot} />
			</PanelStyle.Provider>
			{invalid ? (
				<div className="monitor-background-error" role="status">
					{settingsLabels.bgInvalid}
				</div>
			) : null}
			{preview ? (
				<span className="monitor-preview-label">Preview · Sample data</span>
			) : null}
		</section>
	);
}

export function MonitorPanel(
	props: Parameters<typeof PanelWithMedia>[0],
): React.JSX.Element {
	return <PanelWithMedia key={props.media?.url ?? "builtin"} {...props} />;
}
