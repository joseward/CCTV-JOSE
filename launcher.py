"""
CCTV Unified Monitor - Desktop Standalone Launcher
Inicia el motor de streaming go2rtc y abre la interfaz de monitoreo CCTV en modo ventana de escritorio nativa
con aceleración de decodificación por hardware GPU Direct3D 11.
"""

import os
import sys
import time
import socket
import subprocess
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import urllib.request
import webbrowser

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DIST_DIR = os.path.join(SCRIPT_DIR, "cctv-ui", "dist")
GO2RTC_BIN = os.path.join(SCRIPT_DIR, "bin", "go2rtc.exe")

class ThreadedCCTVHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIST_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def log_message(self, format, *args):
        # Silenciar logs para consola limpia
        pass

def find_available_port(start_port=18080):
    for port in range(start_port, start_port + 50):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('127.0.0.1', port))
                return port
            except OSError:
                continue
    # Fallback to system assigned port
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0

def start_go2rtc():
    if is_port_in_use(1984):
        print("[go2rtc] El servicio ya está activo en el puerto 1984.")
        return None

    if not os.path.exists(GO2RTC_BIN):
        print(f"[go2rtc] ERROR: No se encontró el binario en: {GO2RTC_BIN}")
        return None

    print("[go2rtc] Iniciando motor de streaming WebRTC...")
    creationflags = 0
    if sys.platform == "win32":
        creationflags = subprocess.CREATE_NO_WINDOW

    config_path = os.path.join(SCRIPT_DIR, "go2rtc.yaml")
    cmd = [GO2RTC_BIN]
    if os.path.exists(config_path):
        cmd.extend(["-config", config_path])

    proc = subprocess.Popen(
        cmd,
        cwd=SCRIPT_DIR,
        creationflags=creationflags
    )
    
    # Esperar hasta que responda en el puerto 1984
    for _ in range(15):
        if is_port_in_use(1984):
            print("[go2rtc] Motor en línea y respondiendo en http://127.0.0.1:1984")
            break
        time.sleep(0.2)

    return proc

def launch_desktop_window(url):
    """
    Inicia la ventana en modo aplicación nativa sin barra de direcciones usando Edge o Chrome.
    """
    edge_paths = [
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
    ]
    chrome_paths = [
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
    ]

    user_data_dir = os.path.join(os.environ.get("TEMP", SCRIPT_DIR), "cctv_monitor_profile")

    for exe in edge_paths + chrome_paths:
        if os.path.exists(exe):
            print(f"[Desktop] Abriendo ventana acelerada con: {os.path.basename(exe)}")
            return subprocess.Popen([
                exe,
                f"--app={url}",
                f"--user-data-dir={user_data_dir}",
                "--window-size=1280,820",
                "--enable-features=VaapiVideoDecoder,D3D11VideoDecoder",
                "--ignore-gpu-blocklist",
                "--enable-gpu-rasterization",
                "--no-first-run",
                "--no-default-browser-check"
            ])

    print("[Desktop] Abriendo en el navegador...")
    webbrowser.open(url)
    return None

def main():
    print("=" * 65)
    print("  CCTV UNIFIED MONITOR - SECURITY OPERATIONS DESKTOP")
    print("  Decodificación WebRTC Direct3D 11 | Reconexión con Backoff")
    print("=" * 65)

    # 1. Asegurar frontend compilado
    index_html = os.path.join(DIST_DIR, "index.html")
    if not os.path.exists(index_html):
        print("[Build] Compilando frontend React/Vite...")
        subprocess.run(["npm", "run", "build"], cwd=os.path.join(SCRIPT_DIR, "cctv-ui"), shell=True)

    # 2. Iniciar motor go2rtc
    go2rtc_proc = start_go2rtc()

    # 3. Buscar puerto libre garantizado
    server_port = find_available_port(18080)
    httpd = ThreadingHTTPServer(("127.0.0.1", server_port), ThreadedCCTVHandler)
    server_thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    server_thread.start()
    print(f"[HTTP] Servidor listo en: http://127.0.0.1:{server_port}")

    time.sleep(0.3)

    # 4. Lanzar ventana nativa
    app_url = f"http://127.0.0.1:{server_port}/index.html"
    app_window = launch_desktop_window(app_url)

    print("\n[OK] Monitor CCTV operativo.")
    print("Cierra la ventana o presiona Ctrl+C en esta consola para salir.\n")

    try:
        if app_window:
            time.sleep(2)
            if app_window.poll() is None:
                app_window.wait()
            else:
                print("[INFO] Ventana de escritorio activa. Mantén esta consola abierta.")
                print("Para detener el monitor CCTV, presiona Ctrl+C aquí o cierra la consola.")
                while True:
                    time.sleep(1)
        else:
            while True:
                time.sleep(1)
    except KeyboardInterrupt:
        print("\n[CCTV] Cerrando monitor...")
    finally:
        httpd.shutdown()
        if go2rtc_proc:
            try:
                go2rtc_proc.terminate()
                go2rtc_proc.wait(timeout=2)
            except Exception:
                go2rtc_proc.kill()
        print("[CCTV] Finalizado correctamente.")

if __name__ == "__main__":
    main()
