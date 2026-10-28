import type {
	Disk,
	MetricValues,
} from "../../../../../packages/edge/src/monitor/monitor-contracts";
/** macOS df -kP. Ignore APFS service mounts, retain Data and external volumes. */
export function parseDisks(output: string): readonly Disk[] {
	const disks: Disk[] = [];
	for (const line of output.trim().split("\n").slice(1)) {
		const match = /^(\S+)\s+(\d+)\s+\d+\s+\d+\s+(\d+)%\s+(.+)$/.exec(
			line.trim(),
		);
		if (!match) continue;
		const [, fs, blocks, used, mount] = match;
		if (!fs?.startsWith("/dev/") || !mount || !blocks || !used) continue;
		if (
			mount !== "/System/Volumes/Data" &&
			mount !== "/" &&
			!mount.startsWith("/Volumes/")
		)
			continue;
		if (mount === "/" && output.includes(" /System/Volumes/Data")) continue;
		disks.push({
			name: mount === "/System/Volumes/Data" ? "Macintosh HD" : mount,
			size: Number(blocks) * 1024,
			usedPercent: Number(used),
		});
	}
	return disks;
}
export function parseProcesses(output: string): MetricValues {
	const states = output.trim().split(/\s+/).filter(Boolean);
	if (!states.length) return {};
	return {
		all: states.length,
		running: states.filter((s) => s.startsWith("R")).length,
		sleeping: states.filter((s) => /^[SI]/.test(s)).length,
		blocked: states.filter((s) => /^[UD]/.test(s)).length,
	};
}
export function parsePower(output: string): MetricValues {
	const source = /^Now drawing from '(AC Power|Battery Power)'/m.exec(
		output,
	)?.[1];
	if (!source) return {};
	const supply = source === "AC Power" ? "ac" : "battery";
	if (!/InternalBattery|\bBattery-/.test(output))
		return supply === "ac"
			? { source: supply, hasBattery: false }
			: { source: supply };
	const percent = /\b(\d+)%;/.exec(output)?.[1];
	const state = /;\s*(charging|discharging|charged|not charging)\b/.exec(
		output,
	)?.[1];
	return {
		hasBattery: true,
		source: supply,
		...(percent !== undefined && Number(percent) <= 100
			? { percent: Number(percent) }
			: {}),
		...(state === "not charging"
			? { batteryState: "not-charging" as const }
			: state === "charging" || state === "discharging" || state === "charged"
				? { batteryState: state }
				: {}),
	};
}

/** sysctl -n hw.model returns a model identifier without a key prefix. */
export function parseHardwareModel(output: string): string | undefined {
	const model = output.trim().replace(/^hw\.model:\s*/, "");
	return /^[A-Za-z0-9,._-]+$/.test(model) ? model : undefined;
}

export function parseNetworkCounters(
	output: string,
	iface: string,
): { up: number; down: number } | undefined {
	const lines = output.trim().split("\n");
	const header = lines[0]?.trim().split(/\s+/) ?? [];
	const incoming = header.indexOf("Ibytes"),
		outgoing = header.indexOf("Obytes");
	if (incoming < 0 || outgoing < 0) return;
	for (const line of lines.slice(1)) {
		const cells = line.trim().split(/\s+/);
		if (cells[0] !== iface || !cells[2]?.startsWith("<Link#")) continue;
		const up = Number(cells[outgoing]),
			down = Number(cells[incoming]);
		if (Number.isFinite(up) && Number.isFinite(down)) return { up, down };
	}
	return;
}
