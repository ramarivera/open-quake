import { execFile } from "node:child_process";

function powershell(script: string): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			"powershell.exe",
			["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
			{ timeout: 1000, windowsHide: true, shell: false },
			(error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
		);
	});
}

/** UTC creation ticks identify the process object, independently of PID reuse. */
export async function windowsProcessIdentity(
	pid: number,
): Promise<string | undefined> {
	const output = await powershell(`
$ErrorActionPreference = 'Stop'
try { $process = [System.Diagnostics.Process]::GetProcessById(${pid}) }
catch [System.ArgumentException] { return }
try {
  $null = $process.Handle
  $process.StartTime.ToUniversalTime().Ticks.ToString([System.Globalization.CultureInfo]::InvariantCulture)
} finally { $process.Dispose() }
`);
	if (!output) return;
	if (!/^[0-9]{1,19}$/.test(output))
		throw new Error("Invalid process identity");
	return output;
}

/** Pin the verified process object until taskkill returns, preventing PID reuse
 * between the final identity check and termination. Never invokes taskkill on a
 * process that has already exited or whose creation identity differs.
 */
export async function terminateWindowsTree(
	pid: number,
	identity: string,
): Promise<void> {
	if (!/^[0-9]{1,19}$/.test(identity))
		throw new Error("Invalid process identity");
	await powershell(`
$ErrorActionPreference = 'Stop'
$process = [System.Diagnostics.Process]::GetProcessById(${pid})
try {
  $null = $process.Handle
  $created = $process.StartTime.ToUniversalTime().Ticks.ToString([System.Globalization.CultureInfo]::InvariantCulture)
  if ($process.HasExited -or $created -cne '${identity}') { throw 'Process identity could not be verified' }
  & (Join-Path $env:SystemRoot 'System32/taskkill.exe') /PID ${pid} /T /F
  if ($LASTEXITCODE -ne 0) { throw 'Owned tree termination failed' }
} finally { $process.Dispose() }
`);
}

export async function windowsTreeExists(pid: number): Promise<boolean> {
	const output = await powershell(`
$ErrorActionPreference = 'Stop'
$processes = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId)
$owned = @(${pid})
do {
  $next = @($processes | Where-Object { $owned -contains $_.ParentProcessId -and $owned -notcontains $_.ProcessId } | ForEach-Object { $_.ProcessId })
  $owned += $next
} while ($next.Count -gt 0)
(@($processes | Where-Object { $owned -contains $_.ProcessId }).Count -gt 0) | ConvertTo-Json -Compress
`);
	// Unexpected output fails closed and keeps the cleanup target retryable.
	return output !== "false";
}
