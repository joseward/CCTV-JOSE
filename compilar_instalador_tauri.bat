@echo off
title CCTV Unified Monitor - Compilar Instalador
echo Compilando ejecutable de produccion para Windows...
cd "%~dp0cctv-ui"
npm run tauri:build
echo.
echo Compilacion finalizada. Revisa la carpeta src-tauri/target/release/
pause
