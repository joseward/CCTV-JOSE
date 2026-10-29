# CCTV Unified Monitor 📹
**Visor unificado de escritorio para cámaras de seguridad CCTV (Windows)**

Desarrollado con **Tauri v2 + React 19 + TypeScript + Tailwind CSS v4** y alimentado por **go2rtc (WebRTC con decodificación acelerada por hardware GPU Direct3D 11 / DXVA)**.

---

## 🚀 Requisitos Cumplidos

| Requisito | Implementación |
| :--- | :--- |
| **1. Soporte Multi-DVR / NVR (JSON / SQLite)** | Configuración guardada en `cameras.json` en local y `%APPDATA%/cctv-viewer/`. Soporta plantillas automáticas para Hikvision, Dahua, Uniview y RTSP genérico, con exportación e importación de respaldo en un clic. |
| **2. Cuadrícula Ajustable (1x1, 2x2, 3x3, 4x4)** | Mosaico reactivo con selección dinámica de 1 a 16 canales por vista. En vista de cuadrícula reproduce el **Sub-Stream** para ahorrar ancho de banda y uso de CPU; al hacer doble clic o maximizar conmuta automáticamente al **Main-Stream** (1080p/4K). |
| **3. Aceleración por Hardware (WebRTC / go2rtc)** | Integración del motor de streaming `go2rtc` que remuxea flujos RTSP a WebRTC sin transcodificar en CPU. Decodificación Direct3D 11 / DXVA nativa en WebView2 / Chromium a 60 FPS con mínimo consumo de CPU. |
| **4. Reconexión con Backoff Exponencial** | Monitoreo del estado ICE/PeerConnection. En caso de corte de señal aplica la fórmula de backoff exponencial $t = \min(1.5 \times 2^{\text{intento}-1}, 30)\text{s} \pm \text{jitter}$, con indicador visual de cuenta regresiva e intento en pantalla, además de botón de reintento manual inmediato. |

---

## 📁 Estructura del Proyecto

```text
programa prueba/
├── bin/
│   └── go2rtc.exe              # Motor de remuxing RTSP -> WebRTC
├── cctv-ui/
│   ├── src/
│   │   ├── components/
│   │   │   ├── CctvPlayer.tsx    # Reproductor WebRTC con HW decode y backoff
│   │   │   ├── Header.tsx        # Barra de control (1x1, 2x2, 3x3, 4x4, Tour)
│   │   │   ├── CameraModal.tsx   # Modal para añadir/editar cámaras y presets
│   │   │   └── SettingsModal.tsx # Gestor de DVRs, backup JSON y diagnósticos
│   │   ├── services/
│   │   │   ├── go2rtc.ts         # Conexión y sincronización con el motor go2rtc
│   │   │   └── storage.ts        # Persistencia en JSON/Tauri/localStorage
│   │   ├── types/cctv.ts         # Interfaces de datos y tipos TypeScript
│   │   └── App.tsx               # Orquestador del mosaico CCTV
│   ├── src-tauri/                # Backend de escritorio nativo en Rust (Tauri v2)
│   └── package.json
├── launcher.py                 # Lanzador de escritorio rápido (Edge/Chrome app mode)
├── iniciar_cctv.bat            # Acceso directo para iniciar la app en 1 segundo
├── iniciar_tauri_dev.bat       # Iniciar en modo desarrollo con Tauri
├── compilar_instalador_tauri.bat # Compilar instalador ejecutable de Windows (.exe)
└── README.md
```

---

## ⚡ Cómo Ejecutar la Aplicación

Tienes dos formas de ejecutar el monitor:

### Opción 1: Ejecutable Nativo Directo (Recomendado)
Haz doble clic sobre:
```text
cctv-viewer.exe
```
*(O ejecuta `iniciar_cctv.bat`).*
Se abre de forma instantánea como aplicación de escritorio nativa de Windows (Tauri Release de 8.8 MB), con todo el frontend empaquetado adentro e iniciando el motor `go2rtc` en segundo plano automáticamente. No requiere servidores externos ni consolas abiertas.

### Opción 2: Lanzador Webview / Servidor Alternativo
Si prefieres correrlo mediante el script de Python:
```bat
python launcher.py
```

---

## 🛠️ Plantillas de Conexión DVR / NVR Incluidas

Al añadir una cámara en el botón **"Nueva Cámara"**, puedes ingresar los datos y el sistema auto-generará las URLs RTSP según el fabricante:

* **Hikvision / Hilook**:
  * Main: `rtsp://[usuario]:[password]@[ip]:554/Streaming/Channels/[canal]01`
  * Sub: `rtsp://[usuario]:[password]@[ip]:554/Streaming/Channels/[canal]02`
* **Dahua / Amcrest**:
  * Main: `rtsp://[usuario]:[password]@[ip]:554/cam/realmonitor?channel=[canal]&subtype=0`
  * Sub: `rtsp://[usuario]:[password]@[ip]:554/cam/realmonitor?channel=[canal]&subtype=1`
* **Uniview (UNV)**:
  * Main: `rtsp://[usuario]:[password]@[ip]:554/unicast/c[canal]/s0/live`
  * Sub: `rtsp://[usuario]:[password]@[ip]:554/unicast/c[canal]/s1/live`
* **RTSP Manual**:
  * Permite ingresar cualquier URL RTSP personalizada de ONVIF, DVR o cámara IP.

## 🖥️ Nuevo Diseño Tipo VMS (Video Management Software)

La interfaz ahora cuenta con un diseño profesional de centro de monitoreo (estilo SmartPSS / HikCentral):

1. **Panel Lateral de Dispositivos (Árbol de DVRs y NVRs):**
   * Agrupa automáticamente tus cámaras bajo su respectivo grabador.
   * Barra de búsqueda para filtrar rápidamente cualquier DVR o canal.
   * Puedes ocultar o mostrar el panel con el botón de la esquina superior izquierda para ganar todo el espacio de pantalla.
2. **Carga y Transmisión Selectiva (Ahorro Total de Red y CPU):**
   * Las cámaras inactivas en el árbol **no transmiten ni consumen ancho de banda**.
   * Solo transmiten las cámaras que tú decidas colocar en la cuadrícula (1x1, 2x2, 3x3 o 4x4).
   * **Para abrir un canal:** Haz un clic en la casilla del mosaico donde lo quieres ver y luego clic en la cámara del árbol (o haz doble clic sobre la cámara).
   * **Para abrir un DVR completo:** Haz clic en el botón de reproducción `▶` junto al nombre del DVR en el panel izquierdo.
   * **Para cerrar un canal:** Cada recuadro tiene su botón `✕` para cerrarlo y apagar su transmisión.
   * Botón **"Limpiar Mosaico"**: Cierra todas las transmisiones activas en un solo clic.
3. **Asistente para Agregar DVR Completo:**
   * Botón **"+ Agregar DVR / NVR Completo"**: Ingresas la IP, usuario, contraseña y seleccionas la cantidad de canales (4, 8, 16 o 32) para crearlos todos de un solo golpe.
   * Botón **"🔍 Auto-Detectar Marca"**: Prueba en vivo la conexión con el grabador y auto-configura si es Dahua, Hikvision o Uniview.

1. **Captura de Fotogramas Instantáneos (Snapshots)**:
   * Botón de cámara fotográfica en cada canal que captura el cuadro a resolución original, añade marca de agua OSD de seguridad con fecha y hora (`YYYY-MM-DD HH:MM:SS`), y descarga automáticamente un archivo `.png`.
2. **Modo Patrulla (Tour Automático)**:
   * Si tienes más cámaras que ranuras en el mosaico, activa el botón **TOUR** en la barra superior para rotar automáticamente de página cada 12 segundos.
3. **Control de Proporción de Aspecto**:
   * Alterna entre modo `contain` (proporción 16:9 con bandas) o modo `cover` (relleno completo del recuadro).
4. **Control de Audio**:
   * Botón para activar o silenciar el micrófono de las cámaras que cuenten con canal de audio AAC/G.711.
5. **Atajos de Teclado**:
   * `1`, `2`, `3`, `4`: Cambian instantáneamente la cuadrícula a 1x1, 2x2, 3x3 o 4x4.
   * `Escape`: Cierra la cámara maximizada o cualquier modal activo.
   * `F11`: Alterna pantalla completa.
   * `Flecha Izquierda` / `Flecha Derecha`: Cambia de página en la cuadrícula.
