import { Effect } from "effect";
import { expect, it } from "vitest";
import { mediaProcess } from "./process";
import { windowsMediaScript, windowsPositionScript } from "./windows";

// Exercise the exact production PowerShell seek branch against a synthetic session.
// Remote native execution on Windows is also recorded in the OpenSpec evidence.
it.skipIf(process.platform !== "win32")(
	"seeks from current timeline position with native PowerShell",
	async () => {
		const seek = windowsMediaScript.match(
			/ {2}\{\$_ -in @\('rewind','forward'\)\} \{\n([\s\S]*?)\n {2}\}/,
		)?.[1];
		expect(seek).toBeDefined();
		const script = `
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$testNow=[DateTimeOffset]::Parse('2026-10-25T22:00:00Z')
${windowsPositionScript.replaceAll("[DateTimeOffset]::UtcNow", "$testNow")}
$timeline=[pscustomobject]@{StartTime=[TimeSpan]::Zero;EndTime=[TimeSpan]::FromSeconds(120);Position=[TimeSpan]::FromSeconds(30);LastUpdatedTime=$testNow.AddSeconds(-40)}
$info=[pscustomobject]@{PlaybackStatus='Playing';PlaybackRate=1.0}
$session=[pscustomobject]@{}
$session | Add-Member ScriptMethod GetTimelineProperties {return $global:timeline}
$session | Add-Member ScriptMethod TryChangePlaybackPositionAsync {param($ticks) return $ticks}
function Seek($action) { $request=@{action=$action}
${seek}
 return $op/10000000
}
$values=@((Seek forward),(Seek rewind))
$info.PlaybackStatus='Paused'; $values+=Seek forward
$info.PlaybackStatus='Playing'; $info.PlaybackRate=2.0; $values+=Seek forward
$info.PlaybackRate=0.0; $values+=Seek forward
$info.PlaybackRate=$null; $values+=Seek forward
$timeline.LastUpdatedTime=$testNow.AddSeconds(40); $values+=Seek rewind
$timeline.Position=[TimeSpan]::FromSeconds(119); $values+=Seek forward
$timeline.Position=[TimeSpan]::FromSeconds(1); $values+=Seek rewind
$values | ConvertTo-Json -Compress
`;
		const raw = await Effect.runPromise(
			mediaProcess("powershell.exe", [
				"-NoProfile",
				"-NonInteractive",
				"-EncodedCommand",
				Buffer.from(script, "utf16le").toString("base64"),
			]),
		);
		expect(JSON.parse(raw)).toEqual([85, 55, 45, 120, 45, 85, 15, 120, 0]);
	},
	10000,
);
