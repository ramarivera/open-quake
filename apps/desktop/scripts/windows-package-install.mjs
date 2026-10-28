import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const literal = (value) => `'${value.replaceAll("'", "''")}'`;

// NSIS can leave an old-uninstaller.exe child alive after its parent exits.
// Wait rather than racing it or killing another installation's process.
export function installerWaitScript(installer, installed) {
	return `$ErrorActionPreference = 'Stop'
$installer = ${literal(installer)}
$installed = ${literal(installed)}
$deadline = [DateTime]::UtcNow.AddSeconds(120)
do {
  $rows = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ProcessId -ne $PID -and (
      $_.ExecutablePath -eq $installer -or
      $_.Name -match '^(open-quake-.*-win-(arm64|x64)|Uninstall open-quake|old-uninstaller)\\.exe$' -or
      ($_.Name -match '\\.exe$' -and $_.Name -notmatch '^(pwsh|powershell)\\.exe$' -and $_.CommandLine -and $_.CommandLine.Contains('_?=') -and $_.CommandLine.IndexOf($installed, [StringComparison]::OrdinalIgnoreCase) -ge 0)
    )
  })
  if ($rows.Count -eq 0) { break }
  if ([DateTime]::UtcNow -ge $deadline) {
    $rows | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath | ConvertTo-Json -Compress
    throw 'Prior open-quake installer or uninstaller did not exit within 120 seconds'
  }
  Start-Sleep -Milliseconds 500
} while ($true)`;
}

export async function waitForWindowsPackage(
	installer,
	installed,
	command = promisify(execFile),
) {
	await command(
		"pwsh.exe",
		[
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			installerWaitScript(installer, installed),
		],
		{ timeout: 135_000 },
	);
}

export async function installWindowsPackage({
	installer,
	installed,
	command = promisify(execFile),
	pause = () => delay(2000),
	log = console,
}) {
	const diagnostics = async () => {
		try {
			const { stdout } = await command("tasklist.exe", ["/V", "/FO", "CSV"], {
				timeout: 15_000,
			});
			log.info(
				"Windows installer processes",
				stdout
					.split(/\r?\n/)
					.filter((line) =>
						/open-quake|uninstaller|powershell|pwsh|conhost/i.test(line),
					)
					.join("\n"),
			);
			// Native PowerShell exposes NSIS child processes and blocked thread states.
			const { stdout: processes } = await command(
				"pwsh.exe",
				[
					"-NoLogo",
					"-NoProfile",
					"-NonInteractive",
					"-Command",
					"$rows = Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'open-quake|uninstaller|powershell|pwsh|conhost' }; $rows | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath | ConvertTo-Json -Compress; foreach ($row in $rows) { $p = Get-Process -Id $row.ProcessId -ErrorAction SilentlyContinue; if ($p) { $p.Threads | Select-Object Id, ThreadState, WaitReason | ConvertTo-Json -Compress } }",
				],
				{ timeout: 15_000 },
			);
			log.info("Installer process tree and thread states", processes);
			log.info(
				"Installed directory entries",
				await readdir(installed).catch(() => []),
			);
		} catch (error) {
			log.error("Installer diagnostics failed", error.message);
		}
	};
	for (let attempt = 1; attempt <= 3; attempt++) {
		// Failure to establish that the prior install finished aborts the smoke.
		await waitForWindowsPackage(installer, installed, command);
		log.info(`Windows silent install attempt ${attempt}/3`);
		let diagnosticRun;
		const timer = setTimeout(() => {
			diagnosticRun = diagnostics();
		}, 60_000);
		try {
			await command(installer, ["/S", "/currentuser", `/D=${installed}`], {
				timeout: 300_000,
			});
			// NSIS may return before a helper exits. Don't smoke or remove files yet.
			await waitForWindowsPackage(installer, installed, command);
			return;
		} catch (error) {
			log.error(`Windows install attempt ${attempt}/3 failed`, {
				code: error.code,
				signal: error.signal,
				killed: error.killed,
				message: error.message,
				stdout: String(error.stdout ?? "").slice(-8192),
				stderr: String(error.stderr ?? "").slice(-8192),
			});
			await diagnostics();
			if (attempt === 3) throw error;
			await pause();
		} finally {
			clearTimeout(timer);
			await diagnosticRun;
		}
	}
}
