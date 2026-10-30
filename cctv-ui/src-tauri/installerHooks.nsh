!macro NSIS_HOOK_PREINSTALL
  ; Terminate any running go2rtc, app.exe or cctv-viewer.exe so files can be written cleanly
  DetailPrint "Deteniendo procesos anteriores para actualizacion limpia..."
  ExecWait 'cmd /c taskkill /F /IM go2rtc.exe /T'
  ExecWait 'cmd /c taskkill /F /IM app.exe /T'
  ExecWait 'cmd /c taskkill /F /IM cctv-viewer.exe /T'
  Sleep 1000
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Register app in Windows Startup folder so it opens with Windows automatically
  DetailPrint "Registrando CCTV Unified Monitor en Inicio de Windows..."
  CreateDirectory "$SMSTARTUP"
  CreateShortCut "$SMSTARTUP\CCTV Unified Monitor.lnk" "$INSTDIR\app.exe" "" "$INSTDIR\app.exe" 0
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ExecWait 'cmd /c taskkill /F /IM go2rtc.exe /T'
  ExecWait 'cmd /c taskkill /F /IM app.exe /T'
  ExecWait 'cmd /c taskkill /F /IM cctv-viewer.exe /T'
  Delete "$SMSTARTUP\CCTV Unified Monitor.lnk"
!macroend
