@echo off
title CCTV Unified Monitor - Tauri Dev
echo Iniciando en modo Tauri Dev...
cd "%~dp0cctv-ui"
npm run tauri:dev
pause
