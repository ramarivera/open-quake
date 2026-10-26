import { Schema } from "effect";
import type {
	MetricValues,
	ModuleId,
} from "../../../../../packages/edge/src/monitor/monitor-contracts";
import { MetricValues as Values } from "../../../../../packages/edge/src/monitor/monitor-contracts";

export const parseMetricJson = (text: string): MetricValues =>
	Schema.decodeUnknownSync(Values)(JSON.parse(text.replace(/^\uFEFF/, "")));

/** Fixed local scripts only. PowerShell emits the same bounded, typed DTO as Unix adapters. */
export const windowsMetricScript = (id: ModuleId): string => {
	const scripts: Partial<Record<ModuleId, string>> = {
		cpu: "$c=Get-CimInstance Win32_Processor; $v=@{}; $loads=@($c | Where-Object {$null -ne $_.LoadPercentage}); if($loads.Count){$v.load=($loads | Measure-Object LoadPercentage -Average).Average}; $v",
		gpu: '$v=@{}; $g=@(Get-CimInstance Win32_VideoController | Where-Object {$_.Status -eq "OK"}); if($g.Count){$v.model=$g[0].Name}; $n=Get-Command nvidia-smi -ErrorAction SilentlyContinue; if($n){$r=& $n.Source --query-gpu=utilization.gpu,temperature.gpu --format=csv,noheader,nounits; if($LASTEXITCODE -eq 0){$a=($r | Select-Object -First 1) -split ","; $x=0.0; if([double]::TryParse($a[0],[ref]$x)){$v.load=$x}; if([double]::TryParse($a[1],[ref]$x)){$v.temperature=$x}}}; $v',
		disk: '$d=@(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Where-Object {$_.Size -gt 0} | ForEach-Object {@{name=$_.DeviceID; size=[double]$_.Size; usedPercent=100*(1-[double]$_.FreeSpace/[double]$_.Size)}}); @{disks=$d}',
		process: "$p=@(Get-Process); @{all=$p.Count}",
		network:
			'$n=Get-NetAdapter | Where-Object {$_.Status -eq "Up" -and $_.HardwareInterface} | Sort-Object ifIndex | Select-Object -First 1; if($n){$s=$n | Get-NetAdapterStatistics; @{iface=$n.Name; up=[double]$s.SentBytes; down=[double]$s.ReceivedBytes}}else{@{}}',
		power:
			'$b=@(Get-CimInstance Win32_Battery); if(!$b.Count){@{hasBattery=$false;source="ac"}}else{$v=@{hasBattery=$true}; if($null -ne $b[0].EstimatedChargeRemaining){$v.percent=[double]$b[0].EstimatedChargeRemaining}; switch($b[0].BatteryStatus){1 {$v.source="battery";$v.batteryState="discharging"} 2 {$v.source="ac";$v.batteryState="not-charging"} 3 {$v.source="ac";$v.batteryState="charged"} 6 {$v.source="ac";$v.batteryState="charging"} 7 {$v.source="ac";$v.batteryState="charging"} 8 {$v.source="ac";$v.batteryState="charging"} 9 {$v.source="ac";$v.batteryState="charging"}}; $v}',
		bluetooth:
			"$d=@(Get-PnpDevice -Class Bluetooth -PresentOnly); @{devices=$d.Count}",
	};
	return `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; $ErrorActionPreference="Stop"; & { ${scripts[id] ?? "@{}"} } | ConvertTo-Json -Compress -Depth 4`;
};

export const parseLinuxDisks = (output: string): MetricValues => ({
	disks: output
		.trim()
		.split("\n")
		.slice(1)
		.flatMap((line) => {
			const m =
				/^(\/dev\/\S+)\s+(\S+)\s+(\d+)\s+\d+\s+\d+\s+(\d+)%\s+(.+)$/.exec(
					line.trim(),
				);
			if (!m?.[2] || !m[3] || !m[4] || !m[5]) return [];
			const size = Number(m[3]) * 1024;
			return [
				"ext4",
				"ext3",
				"ext2",
				"xfs",
				"btrfs",
				"ntfs",
				"ntfs3",
				"exfat",
				"vfat",
				"f2fs",
				"zfs",
			].includes(m[2]) && size >= 10 * 1024 ** 3
				? [{ name: m[5], size, usedPercent: Number(m[4]) }]
				: [];
		}),
});
export function parseLinuxNetwork(output: string, iface: string): MetricValues {
	for (const line of output.split("\n")) {
		const split = line.indexOf(":");
		if (line.slice(0, split).trim() !== iface) continue;
		const fields = line
			.slice(split + 1)
			.trim()
			.split(/\s+/);
		const down = Number(fields[0]),
			up = Number(fields[8]);
		if (Number.isFinite(up) && Number.isFinite(down))
			return { iface, up, down };
	}
	return { iface };
}
export const sensorNumber = (
	value: string | undefined,
	scale = 1,
): number | undefined => {
	if (!value?.trim()) return;
	const number = Number(value.trim()) / scale;
	return Number.isFinite(number) ? number : undefined;
};
