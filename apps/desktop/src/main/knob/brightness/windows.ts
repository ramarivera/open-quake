import { Effect } from "effect";
import { KnobDispatchFailed } from "../../../../../../packages/device/src/knob/knob-errors.js";
import type { BrightnessAdapter } from "./controller";
import { type BrightnessProcess, brightnessProcess } from "./native-process";
import { decodeBrightness } from "./native-response";

/** All caller data is JSON/base64 inside a fixed PowerShell program. No SendInput. */
export const windowsBrightnessScript = (data?: {
	target: string;
	percent: number;
}): string => `
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
try { $items=@(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness | Where-Object {$_.Active}) }
catch [Microsoft.Management.Infrastructure.CimException] {
 if ($_.Exception.StatusCode -in @('InvalidClass','InvalidNamespace','NotSupported')) { '{"supported":false}'; exit 0 }
 throw
}
if ($items.Count -ne 1) { '{"supported":false}'; exit 0 }
$monitor=$items[0]
${
	data
		? `$data=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(JSON.stringify(data)).toString("base64")}')) | ConvertFrom-Json
if ($monitor.InstanceName -cne $data.target) { throw 'Brightness target changed' }
if ($data.percent -lt 0 -or $data.percent -gt 100) { throw 'Invalid brightness' }
$methods=@(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Where-Object {$_.InstanceName -ceq $data.target})
if ($methods.Count -ne 1) { throw 'Brightness method unavailable' }
# WMI brightness methods may return no status field. The controller requires readback.
Invoke-CimMethod -InputObject $methods[0] -MethodName WmiSetBrightness -Arguments @{Timeout=[UInt32]0;Brightness=[byte][Math]::Round($data.percent)} | Out-Null
$items=@(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness | Where-Object {$_.Active})
if ($items.Count -ne 1 -or $items[0].InstanceName -cne $data.target) { throw 'Brightness target changed' }
$monitor=$items[0]`
		: ""
}
@{supported=$true;target=[string]$monitor.InstanceName;percent=[double]$monitor.CurrentBrightness;quantum=1} | ConvertTo-Json -Compress
`;
export function windowsBrightness(
	run: BrightnessProcess = brightnessProcess,
): BrightnessAdapter {
	const call = (data?: { target: string; percent: number }) =>
		run("powershell.exe", [
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-EncodedCommand",
			Buffer.from(windowsBrightnessScript(data), "utf16le").toString("base64"),
		]).pipe(Effect.flatMap(decodeBrightness));
	return {
		read: Effect.fn("DesktopBrightness.windowsRead")(() => call())(),
		write: Effect.fn("DesktopBrightness.windowsWrite")((before, percent) =>
			call({ target: before.target, percent }).pipe(
				Effect.flatMap((after) =>
					after.target === before.target
						? Effect.void
						: Effect.fail(
								KnobDispatchFailed.fromCause(
									new RangeError("Brightness target changed"),
								),
							),
				),
			),
		),
	};
}
