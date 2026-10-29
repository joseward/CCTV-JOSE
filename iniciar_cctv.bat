@echo off
title CCTV Unified Monitor
echo Iniciando CCTV Unified Monitor...
powershell -Command "Get-CimInstance Win32_Process -Filter \"Name = 'msedgewebview2.exe'\" | Where-Object { $_.CommandLine -like '*cctv*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" >nul 2>&1
start "" "%~dp0cctv-viewer.exe"
exit
