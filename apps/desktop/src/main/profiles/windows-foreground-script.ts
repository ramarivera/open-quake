/** Fixed stdin/stdout protocol. Add-Type executes once before the request loop. */
export const windowsForegroundScript = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class OQForeground { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }'
while ($null -ne ($line = [Console]::ReadLine())) {
  if ($line -notmatch '^[0-9]{1,16}$') { exit 2 }
  $reply = @{ requestId = $line; status = 'none' }
  $owner = $null
  try {
    $window = [OQForeground]::GetForegroundWindow()
    if ($window -ne [IntPtr]::Zero) {
      [uint32]$ownerId = 0
      [void][OQForeground]::GetWindowThreadProcessId($window, [ref]$ownerId)
      $owner = Get-Process -Id $ownerId -ErrorAction Stop
      if ($owner.Path) {
        $reply = @{ requestId = $line; status = 'foreground'; id = $window.ToInt64().ToString(); path = $owner.Path }
      }
    }
  } catch {
    $reply = @{ requestId = $line; status = 'error' }
  } finally {
    if ($null -ne $owner) { $owner.Dispose() }
  }
  [Console]::WriteLine(($reply | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}
`;
