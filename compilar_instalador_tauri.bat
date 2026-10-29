@echo off
title CCTV Unified Monitor - Compilador y Firmador de Actualizaciones
color 0b
echo ====================================================================
echo        CCTV UNIFIED MONITOR - COMPILADOR Y AUTO-UPDATER
echo ====================================================================
echo.

set "KEY_FILE=%USERPROFILE%\.tauri\cctv-viewer.key"

if not exist "%KEY_FILE%" (
    echo [ADVERTENCIA] No se encontro la llave privada en:
    echo %KEY_FILE%
    echo No se podran firmar los paquetes de actualizacion.
    pause
    exit /b 1
)

echo [OK] Llave privada detectada en: %KEY_FILE%
echo.

rem Leer la llave privada en la variable de entorno TAURI_SIGNING_PRIVATE_KEY
set /p TAURI_SIGNING_PRIVATE_KEY=<"%KEY_FILE%"

echo Compilando aplicacion e instalador con firma digital Ed25519...
cd "%~dp0cctv-ui"
call npx @tauri-apps/cli build --bundles nsis

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Hubo un problema durante la compilacion.
    pause
    exit /b %ERRORLEVEL%
)

echo Generando manifiesto de actualizacion latest.json...
node generate-updater-manifest.js

echo.
echo ====================================================================
echo                 COMPILACION COMPLETADA CON EXITO
echo ====================================================================
echo Los 3 archivos listos para subir a GitHub Releases estan en:
echo cctv-ui\src-tauri\target\release\bundle\nsis\
echo.
echo Archivos generados:
echo  1. Instalador (.exe)
echo  2. Firma criptografica (.sig)
echo  3. Manifiesto (latest.json)
echo.
echo Abriendo la carpeta contenedora en el Explorador de Windows...
explorer "%~dp0cctv-ui\src-tauri\target\release\bundle\nsis"
echo.
echo Para publicar la actualizacion en todas las demas PCs:
echo Abre: https://github.com/joseward/CCTV-JOSE/releases/new
echo y arrastra los 3 archivos anteriores.
echo ====================================================================
echo.
pause
