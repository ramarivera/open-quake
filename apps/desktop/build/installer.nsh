; electron-builder 26.18.0 omits these declarations when overriding its check.
!include "getProcessInfo.nsh"
Var pid

!macro customCheckAppRunning
  ; NSIS is x86. On ARM Windows, SYSDIR redirects PowerShell to the emulated
  ; SysWOW64 build, which can stall before extraction. Sysnative reaches the
  ; OS-native executable without changing filesystem redirection globally.
  ${If} ${IsNativeARM64}
    ${If} ${FileExists} "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
      StrCpy $PowerShellPath "$WINDIR\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
    ${EndIf}
  ${EndIf}

  ; Preserve the pinned builder's policy/availability fallback and complete
  ; running-app protection for both installation and uninstallation.
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
!macroend
