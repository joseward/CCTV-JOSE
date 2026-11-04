use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::io::Write;
use std::collections::{BTreeSet, HashMap};
use tauri_plugin_updater::UpdaterExt;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State,
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

struct AppState {
    go2rtc_process: Mutex<Option<Child>>,
    whatsapp_process: Mutex<Option<Child>>,
    active_downloads: Arc<Mutex<HashMap<String, u32>>>,
    active_dahua_downloads: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

fn get_whatsapp_gateway_dir() -> Option<PathBuf> {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidate1 = exe_dir.join("whatsapp-gateway");
            if candidate1.exists() {
                return Some(candidate1);
            }
        }
    }

    let cwd_candidates = [
        PathBuf::from("whatsapp-gateway"),
        PathBuf::from("../whatsapp-gateway"),
    ];
    for p in &cwd_candidates {
        if p.exists() {
            if let Ok(abs) = fs::canonicalize(p) {
                return Some(abs);
            }
            return Some(p.clone());
        }
    }

    None
}

fn get_go2rtc_path() -> Option<PathBuf> {
    // 1. Check relative to current exe
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidate1 = exe_dir.join("bin").join("go2rtc.exe");
            if candidate1.exists() {
                return Some(candidate1);
            }
            let candidate2 = exe_dir.join("go2rtc.exe");
            if candidate2.exists() {
                return Some(candidate2);
            }
            let candidate3 = exe_dir.join("resources").join("bin").join("go2rtc.exe");
            if candidate3.exists() {
                return Some(candidate3);
            }
            let candidate4 = exe_dir.join("resources").join("go2rtc.exe");
            if candidate4.exists() {
                return Some(candidate4);
            }
        }
    }

    // 2. Check APPDATA
    if let Ok(appdata) = std::env::var("APPDATA") {
        let app_dir = PathBuf::from(appdata).join("cctv-viewer");
        let candidate = app_dir.join("bin").join("go2rtc.exe");
        if candidate.exists() {
            return Some(candidate);
        }
    }

    // 3. Check current working dir
    let cwd_candidates = [
        PathBuf::from("bin/go2rtc.exe"),
        PathBuf::from("go2rtc.exe"),
        PathBuf::from("../bin/go2rtc.exe"),
        PathBuf::from("src-tauri/bin/go2rtc.exe"),
        PathBuf::from("../src-tauri/bin/go2rtc.exe"),
    ];
    for p in &cwd_candidates {
        if p.exists() {
            if let Ok(abs) = fs::canonicalize(p) {
                return Some(abs);
            }
            return Some(p.clone());
        }
    }

    None
}

fn get_dhnetsdk_path() -> Option<PathBuf> {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidate1 = exe_dir.join("bin").join("dhnetsdk.dll");
            if candidate1.exists() {
                return Some(candidate1);
            }
            let candidate2 = exe_dir.join("dhnetsdk.dll");
            if candidate2.exists() {
                return Some(candidate2);
            }
            let candidate3 = exe_dir.join("resources").join("bin").join("dhnetsdk.dll");
            if candidate3.exists() {
                return Some(candidate3);
            }
            let candidate4 = exe_dir.join("resources").join("dhnetsdk.dll");
            if candidate4.exists() {
                return Some(candidate4);
            }
        }
    }

    let cwd_candidates = [
        PathBuf::from("bin/dhnetsdk.dll"),
        PathBuf::from("dhnetsdk.dll"),
        PathBuf::from("src-tauri/bin/dhnetsdk.dll"),
        PathBuf::from("../src-tauri/bin/dhnetsdk.dll"),
        PathBuf::from(r"C:\Program Files\SmartPSSLite\dhnetsdk.dll"),
        PathBuf::from(r"C:\Program Files\SmartPSS\dhnetsdk.dll"),
    ];
    for p in &cwd_candidates {
        if p.exists() {
            if let Ok(abs) = fs::canonicalize(p) {
                return Some(abs);
            }
            return Some(p.clone());
        }
    }

    None
}

fn get_or_create_go2rtc_config() -> PathBuf {
    let app_dir = if let Ok(appdata) = std::env::var("APPDATA") {
        PathBuf::from(appdata).join("cctv-viewer")
    } else {
        PathBuf::from(".")
    };
    let _ = fs::create_dir_all(&app_dir);
    let cfg_path = app_dir.join("go2rtc.yaml");

    // Always ensure go2rtc.yaml exists and has API + CORS origin: "*"
    if !cfg_path.exists() {
        let default_config = "api:\n  listen: \":1984\"\n  origin: \"*\"\n\nrtsp:\n  listen: \":8554\"\n\nwebrtc:\n  listen: \":8555\"\n";
        let _ = fs::write(&cfg_path, default_config);
    }
    cfg_path
}

fn get_primary_config_path() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        let app_dir = PathBuf::from(appdata).join("cctv-viewer");
        let _ = fs::create_dir_all(&app_dir);
        return app_dir.join("cameras.json");
    }
    PathBuf::from("cameras.json")
}

fn get_config_path() -> PathBuf {
    get_primary_config_path()
}

fn get_settings_path() -> PathBuf {
    let mut path = get_primary_config_path();
    path.set_file_name("settings.json");
    path
}

#[tauri::command]
fn check_go2rtc_running() -> bool {
    let client = std::net::TcpStream::connect_timeout(
        &"127.0.0.1:1984".parse().unwrap(),
        std::time::Duration::from_millis(500),
    );
    client.is_ok()
}

fn is_port_in_use(port: u16) -> bool {
    let addr = format!("127.0.0.1:{}", port);
    if let Ok(socket) = std::net::TcpListener::bind(&addr) {
        drop(socket);
        false
    } else {
        true
    }
}

#[tauri::command]
fn start_go2rtc(state: State<AppState>) -> Result<String, String> {
    if check_go2rtc_running() {
        return Ok("go2rtc ya está en ejecución".to_string());
    }

    let bin_path = get_go2rtc_path()
        .ok_or_else(|| "No se encontró el ejecutable go2rtc.exe en las rutas de búsqueda".to_string())?;

    let cfg_path = get_or_create_go2rtc_config();

    let mut cmd = Command::new(&bin_path);
    cmd.arg("-c");
    cmd.arg(&cfg_path);

    if let Some(parent) = cfg_path.parent() {
        cmd.current_dir(parent);
    }
    cmd.stdout(std::process::Stdio::null());
    cmd.stderr(std::process::Stdio::null());

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Error al iniciar go2rtc: {}", e))?;

    let mut proc_guard = state.go2rtc_process.lock().map_err(|e| e.to_string())?;
    *proc_guard = Some(child);

    // Wait up to 1.5 seconds for port 1984 to be active
    for _ in 0..15 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        if check_go2rtc_running() {
            break;
        }
    }

    Ok(format!("go2rtc iniciado desde {:?}", bin_path))
}

#[tauri::command]
fn stop_go2rtc(state: State<AppState>) -> Result<String, String> {
    let mut proc_guard = state.go2rtc_process.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = proc_guard.take() {
        let _ = child.kill();
        let _ = child.wait();
        return Ok("go2rtc detenido".to_string());
    }
    Ok("go2rtc no estaba en ejecución por esta app".to_string())
}

#[tauri::command]
fn start_whatsapp_gateway(state: State<AppState>) -> Result<String, String> {
    if is_port_in_use(8120) {
        return Ok("WhatsApp Gateway ya está en ejecución".to_string());
    }

    let gw_dir = match get_whatsapp_gateway_dir() {
        Some(d) => d,
        None => return Err("No se encontró la carpeta whatsapp-gateway".to_string()),
    };

    let server_script = gw_dir.join("server.js");
    if !server_script.exists() {
        return Err("No se encontró server.js en whatsapp-gateway".to_string());
    }

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = Command::new("cmd");
        cmd.args(["/c", "node", "server.js"]);
        cmd.current_dir(&gw_dir);
        cmd.creation_flags(CREATE_NO_WINDOW);

        let child = cmd
            .spawn()
            .map_err(|e| format!("Error al iniciar WhatsApp Gateway: {}", e))?;

        let mut proc_guard = state.whatsapp_process.lock().map_err(|e| e.to_string())?;
        *proc_guard = Some(child);

        Ok("WhatsApp Gateway iniciado".to_string())
    }
    #[cfg(not(windows))]
    {
        Err("Unsupported OS".to_string())
    }
}

#[tauri::command]
fn stop_whatsapp_gateway(state: State<AppState>) -> Result<String, String> {
    let mut proc_guard = state.whatsapp_process.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = proc_guard.take() {
        #[cfg(windows)]
        {
            let pid = child.id();
            let _ = Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .output();
        }
        let _ = child.kill();
        let _ = child.wait();
        return Ok("WhatsApp Gateway detenido".to_string());
    }
    Ok("WhatsApp Gateway no estaba en ejecución por esta app".to_string())
}

#[tauri::command]
fn load_cameras() -> Result<String, String> {
    let primary = get_primary_config_path();

    // Collect all candidate locations where user's cameras could be stored
    let mut candidates = Vec::new();
    candidates.push(primary.clone());

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("cameras.json"));
            if let Some(grandparent) = exe_dir.parent() {
                candidates.push(grandparent.join("cameras.json"));
            }
        }
    }

    if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
        candidates.push(PathBuf::from(&localappdata).join("cctv-viewer").join("cameras.json"));
        candidates.push(PathBuf::from(&localappdata).join("Programs").join("cctv-viewer").join("cameras.json"));
    }

    candidates.push(PathBuf::from("cameras.json"));
    candidates.push(PathBuf::from("../cameras.json"));

    // Find candidate with the highest number of configured cameras
    let mut best_content = String::new();
    let mut best_camera_count = 0;

    for path in &candidates {
        if path.exists() {
            if let Ok(content) = fs::read_to_string(path) {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(arr) = val.as_array() {
                        if arr.len() > best_camera_count {
                            best_camera_count = arr.len();
                            best_content = content;
                        }
                    }
                }
            }
        }
    }

    if best_camera_count > 0 {
        // Ensure primary persistent storage is updated
        let _ = fs::write(&primary, &best_content);
        return Ok(best_content);
    }

    if primary.exists() {
        if let Ok(c) = fs::read_to_string(&primary) {
            return Ok(c);
        }
    }

    Ok("[]".to_string())
}

#[tauri::command]
fn save_cameras(cameras_json: String) -> Result<String, String> {
    let primary = get_primary_config_path();
    if let Some(parent) = primary.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&primary, &cameras_json).map_err(|e| format!("Error al guardar configuración: {}", e))?;

    // Mirror to exe_dir if possible
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let mirror = exe_dir.join("cameras.json");
            let _ = fs::write(mirror, &cameras_json);
        }
    }

    Ok(format!("Configuración guardada en {:?}", primary))
}

#[tauri::command]
fn load_settings() -> Result<String, String> {
    let path = get_settings_path();
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| format!("Error al leer ajustes: {}", e))
    } else {
        Ok("{}".to_string())
    }
}

#[tauri::command]
fn save_settings(settings_json: String) -> Result<String, String> {
    let path = get_settings_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(&path, settings_json).map_err(|e| format!("Error al guardar ajustes: {}", e))?;
    Ok("Ajustes guardados".to_string())
}

#[tauri::command]
fn get_config_file_path() -> String {
    get_config_path().to_string_lossy().to_string()
}

#[tauri::command]
fn open_dvr_web(url: String, force_edge: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = Command::new("cmd");
        if force_edge {
            cmd.args(["/c", "start", "msedge.exe", &url]);
        } else {
            cmd.args(["/c", "start", "", &url]);
        }
        cmd.creation_flags(CREATE_NO_WINDOW);
        let _ = cmd.spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn fetch_dvr_api(
    url: String,
    method: String,
    auth: Option<String>,
    body: Option<String>,
    content_type: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let mut cmd = Command::new("curl.exe");
            cmd.args(["-s", "-k", "-L", "--location-trusted", "--connect-timeout", "2", "--max-time", "4"]);

            if let Some(ref a) = auth {
                if !a.is_empty() {
                    cmd.args(["--anyauth", "-u", a]);
                }
            }

            if method == "PUT" || method == "POST" {
                cmd.args(["-X", &method]);
                if let Some(ref ct) = content_type {
                    cmd.args(["-H", &format!("Content-Type: {}", ct)]);
                }
                if let Some(ref b) = body {
                    cmd.args(["-d", b]);
                }
            }

            cmd.arg(&url);
            cmd.creation_flags(CREATE_NO_WINDOW);

            let output = cmd.output().map_err(|e| format!("Error ejecutando curl: {}", e))?;
            if output.status.success() {
                let res = String::from_utf8_lossy(&output.stdout).to_string();
                Ok(res)
            } else {
                let err = String::from_utf8_lossy(&output.stderr).to_string();
                Err(if err.is_empty() { format!("Error status: {}", output.status) } else { err })
            }
        }
        #[cfg(not(windows))]
        {
            Err("Unsupported OS".to_string())
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn set_autostart(enable: bool) -> Result<bool, String> {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe_str = exe_path.to_string_lossy().to_string();

        // 1. Registry Run Key
        let mut cmd = Command::new("reg");
        if enable {
            cmd.args([
                "add",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                "CCTVUnifiedMonitor",
                "/t",
                "REG_SZ",
                "/d",
                &exe_str,
                "/f",
            ]);
        } else {
            cmd.args([
                "delete",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
                "/v",
                "CCTVUnifiedMonitor",
                "/f",
            ]);
        }
        cmd.creation_flags(CREATE_NO_WINDOW);
        let _ = cmd.output();

        // 2. Startup Folder Shortcut (so it shows in Task Manager -> Inicio!)
        if let Ok(appdata) = std::env::var("APPDATA") {
            let startup_dir = PathBuf::from(appdata)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs")
                .join("Startup");
            let _ = fs::create_dir_all(&startup_dir);
            let shortcut_path = startup_dir.join("CCTV Unified Monitor.lnk");

            if enable {
                let ps_script = format!(
                    "$s=(New-Object -COM WScript.Shell).CreateShortcut('{}');$s.TargetPath='{}';$s.WorkingDirectory='{}';$s.Save()",
                    shortcut_path.to_string_lossy().replace('\'', "''"),
                    exe_str.replace('\'', "''"),
                    exe_path.parent().unwrap_or(&exe_path).to_string_lossy().replace('\'', "''")
                );
                let mut ps_cmd = Command::new("powershell");
                ps_cmd.args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", &ps_script]);
                ps_cmd.creation_flags(CREATE_NO_WINDOW);
                let _ = ps_cmd.output();
            } else {
                let _ = fs::remove_file(&shortcut_path);
            }
        }

        Ok(enable)
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

#[tauri::command]
fn get_autostart() -> Result<bool, String> {
    #[cfg(windows)]
    {
        // 1. Check Startup Folder shortcut
        if let Ok(appdata) = std::env::var("APPDATA") {
            let shortcut_path = PathBuf::from(appdata)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs")
                .join("Startup")
                .join("CCTV Unified Monitor.lnk");
            if shortcut_path.exists() {
                return Ok(true);
            }
        }

        // 2. Check Registry
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = Command::new("reg");
        cmd.args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run",
            "/v",
            "CCTVUnifiedMonitor",
        ]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        if let Ok(out) = cmd.output() {
            Ok(out.status.success())
        } else {
            Ok(false)
        }
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

#[tauri::command]
fn close_app_completely(app_handle: tauri::AppHandle, state: State<AppState>) -> Result<(), String> {
    let _ = stop_go2rtc(state.clone());
    let _ = stop_whatsapp_gateway(state);

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = Command::new("cmd");
        cmd.args(["/c", "for /f \"tokens=5\" %a in ('netstat -aon ^| findstr \":8120\" ^| findstr \"LISTENING\"') do taskkill /F /PID %a"]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        let _ = cmd.output();
    }

    app_handle.exit(0);
    Ok(())
}

#[tauri::command]
fn prompt_save_file(default_name: String, filter: String) -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let script = format!(
            "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; $d = New-Object System.Windows.Forms.SaveFileDialog; $d.Title = 'Guardar Evidencia CCTV'; $d.FileName = '{}'; $d.Filter = '{}'; $d.RestoreDirectory = $true; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{ [Console]::Out.Write($d.FileName) }}",
            default_name.replace("'", "''"),
            filter.replace("'", "''")
        );

        let mut child = Command::new("powershell")
            .args(["-STA", "-NoProfile", "-Command", "-"])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Error iniciando selector: {}", e))?;

        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(script.as_bytes());
        }

        let output = child.wait_with_output().map_err(|e| e.to_string())?;
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if path.is_empty() {
            Ok(None)
        } else {
            Ok(Some(path))
        }
    }
    #[cfg(not(windows))]
    {
        Ok(None)
    }
}

#[tauri::command]
fn save_binary_file(file_path: String, bytes: Vec<u8>) -> Result<String, String> {
    fs::write(&file_path, bytes).map_err(|e| format!("No se pudo guardar el archivo: {}", e))?;
    Ok(file_path)
}

#[derive(serde::Serialize, Clone)]
pub struct DownloadProgressPayload {
    pub id: String,
    pub status: String,
    pub bytes_downloaded: u64,
    pub speed_bps: f64,
    pub percentage: u32,
    pub error: Option<String>,
}

#[tauri::command]
async fn start_video_download(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    download_id: String,
    url: String,
    destination_file_path: String,
    auth: Option<String>,
    duration_seconds: Option<u64>,
) -> Result<String, String> {
    let dest_path = PathBuf::from(&destination_file_path);
    if let Some(parent) = dest_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = Command::new("curl.exe");
        cmd.args(["-s", "-k", "-L", "--location-trusted", "-g", "--no-styled-output", "-o", &destination_file_path]);

        if let Some(ref a) = auth {
            if !a.is_empty() {
                cmd.args(["--anyauth", "-u", a]);
            }
        }
        cmd.arg(&url);
        cmd.creation_flags(CREATE_NO_WINDOW);

        let mut child = cmd.spawn().map_err(|e| format!("No se pudo iniciar el proceso de descarga: {}", e))?;
        let pid = child.id();

        // Register active download PID
        {
            let mut map = state.active_downloads.lock().unwrap();
            map.insert(download_id.clone(), pid);
        }

        let dur = duration_seconds.unwrap_or(300);
        let estimated_bytes = (2.5 * 1024.0 * 1024.0 / 8.0 * dur as f64) as u64;

        let dl_id = download_id.clone();
        let app_clone = app.clone();
        let state_downloads = state.active_downloads.clone();
        let file_path_clone = destination_file_path.clone();

        let result = tauri::async_runtime::spawn_blocking(move || {
            let start_time = std::time::Instant::now();
            let mut last_bytes = 0u64;
            let mut last_time = start_time;

            loop {
                std::thread::sleep(std::time::Duration::from_millis(200));

                // Check if cancelled
                let is_registered = {
                    let map = state_downloads.lock().unwrap();
                    map.contains_key(&dl_id)
                };
                if !is_registered {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = fs::remove_file(&file_path_clone);
                    let _ = app_clone.emit("download-progress", DownloadProgressPayload {
                        id: dl_id.clone(),
                        status: "cancelled".to_string(),
                        bytes_downloaded: 0,
                        speed_bps: 0.0,
                        percentage: 0,
                        error: Some("Descarga cancelada por el usuario.".to_string()),
                    });
                    return Err("Descarga cancelada.".to_string());
                }

                // Check if child exited
                match child.try_wait() {
                    Ok(Some(status)) => {
                        {
                            let mut map = state_downloads.lock().unwrap();
                            map.remove(&dl_id);
                        }

                        let file_size = fs::metadata(&file_path_clone).map(|m| m.len()).unwrap_or(0);
                        // If status is success OR if we collected substantial video data (> 50 KB), preserve the video!
                        if (status.success() || file_size > 50_000) && file_size > 0 {
                            let _ = app_clone.emit("download-progress", DownloadProgressPayload {
                                id: dl_id.clone(),
                                status: "completed".to_string(),
                                bytes_downloaded: file_size,
                                speed_bps: 0.0,
                                percentage: 100,
                                error: None,
                            });
                            return Ok(file_path_clone);
                        } else {
                            let _ = fs::remove_file(&file_path_clone);
                            let err_msg = if file_size == 0 {
                                "El archivo descargado está vacío o el grabador no envió datos.".to_string()
                            } else {
                                format!("Error en el proceso de descarga: {:?}", status)
                            };
                            let _ = app_clone.emit("download-progress", DownloadProgressPayload {
                                id: dl_id.clone(),
                                status: "error".to_string(),
                                bytes_downloaded: file_size,
                                speed_bps: 0.0,
                                percentage: 0,
                                error: Some(err_msg.clone()),
                            });
                            return Err(err_msg);
                        }
                    }
                    Ok(None) => {
                        let current_bytes = fs::metadata(&file_path_clone).map(|m| m.len()).unwrap_or(0);
                        let now = std::time::Instant::now();
                        let dt = (now - last_time).as_secs_f64();
                        let speed_bps = if dt > 0.0 {
                            (current_bytes.saturating_sub(last_bytes)) as f64 / dt
                        } else {
                            0.0
                        };
                        last_bytes = current_bytes;
                        last_time = now;

                        let elapsed_sec = (now - start_time).as_secs_f64();
                        let time_pct = ((elapsed_sec / dur as f64) * 100.0).min(99.0) as u32;
                        let size_pct = if estimated_bytes > 0 {
                            ((current_bytes as f64 / estimated_bytes as f64) * 100.0).min(99.0) as u32
                        } else {
                            0
                        };
                        let percentage = time_pct.max(size_pct);

                        let _ = app_clone.emit("download-progress", DownloadProgressPayload {
                            id: dl_id.clone(),
                            status: "downloading".to_string(),
                            bytes_downloaded: current_bytes,
                            speed_bps,
                            percentage,
                            error: None,
                        });
                    }
                    Err(e) => {
                        let _ = fs::remove_file(&file_path_clone);
                        let _ = app_clone.emit("download-progress", DownloadProgressPayload {
                            id: dl_id.clone(),
                            status: "error".to_string(),
                            bytes_downloaded: 0,
                            speed_bps: 0.0,
                            percentage: 0,
                            error: Some(e.to_string()),
                        });
                        return Err(e.to_string());
                    }
                }
            }
        })
        .await
        .map_err(|e| e.to_string())?;

        result
    }
    #[cfg(not(windows))]
    {
        Err("Unsupported OS".to_string())
    }
}

#[cfg(windows)]
unsafe extern "system" {
    fn LoadLibraryW(lpLibFileName: *const u16) -> *mut std::ffi::c_void;
    fn GetProcAddress(hModule: *mut std::ffi::c_void, lpProcName: *const u8) -> *mut std::ffi::c_void;
    fn SetDllDirectoryW(lpPathName: *const u16) -> i32;
}

#[cfg(windows)]
fn to_wide_null(os_str: &std::ffi::OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    os_str.encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn copy_str_to_buf(src: &str, buf: &mut [u8]) {
    let bytes = src.as_bytes();
    let len = bytes.len().min(buf.len() - 1);
    buf[..len].copy_from_slice(&bytes[..len]);
    buf[len] = 0;
}

#[cfg(windows)]
#[repr(C)]
struct NetInLoginWithHighLevelSecurity {
    dw_size: u32,
    sz_ip: [u8; 64],
    n_port: i32,
    sz_user_name: [u8; 64],
    sz_password: [u8; 64],
    em_spec_cap: i32,
    p_cap_param: *mut std::ffi::c_void,
}

#[cfg(windows)]
#[repr(C)]
struct NetDeviceInfoEx {
    s_serial_number: [u8; 48],
    by_alarm_in_port_num: u8,
    by_alarm_out_port_num: u8,
    by_disk_num: u8,
    by_dvr_type: u8,
    by_chan_num: u8,
    by_limit_login_time: u8,
    by_left_log_times: u8,
    b_reserved: u8,
    by_lock_left_time: i32,
    reserved: [u8; 24],
}

#[cfg(windows)]
#[repr(C)]
struct NetOutLoginWithHighLevelSecurity {
    dw_size: u32,
    stu_device_info: NetDeviceInfoEx,
    n_error: i32,
    reserved: [u8; 132],
}

#[cfg(windows)]
#[repr(C)]
#[derive(Clone, Copy, Default, Debug)]
struct NetTime {
    dw_year: u32,
    dw_month: u32,
    dw_day: u32,
    dw_hour: u32,
    dw_minute: u32,
    dw_second: u32,
}

#[cfg(windows)]
struct DahuaSdkContext {
    finished: AtomicBool,
    total_bytes: AtomicU64,
    downloaded_bytes: AtomicU64,
}

#[cfg(windows)]
unsafe extern "system" fn dahua_download_cb(
    _handle: i64,
    total_size: u32,
    download_size: u32,
    userdata: usize,
) {
    if userdata != 0 {
        let ctx = unsafe { &*(userdata as *const DahuaSdkContext) };
        if total_size > 0 {
            ctx.total_bytes.store(total_size as u64, Ordering::Relaxed);
        }
        if download_size != 0xFFFFFFFF {
            ctx.downloaded_bytes.store(download_size as u64, Ordering::Relaxed);
        }
        if download_size == 0xFFFFFFFF || (download_size == total_size && total_size > 0) {
            ctx.finished.store(true, Ordering::SeqCst);
        }
    }
}

#[cfg(windows)]
fn parse_iso_to_net_time(iso: &str) -> Option<NetTime> {
    let clean = iso.replace('T', " ").replace('Z', "");
    let mut parts = clean.split_whitespace();
    let date_str = parts.next()?;
    let time_str = parts.next()?;
    let mut d_iter = date_str.split('-');
    let year: u32 = d_iter.next()?.parse().ok()?;
    let month: u32 = d_iter.next()?.parse().ok()?;
    let day: u32 = d_iter.next()?.parse().ok()?;

    let time_clean = time_str.split('.').next()?;
    let mut t_iter = time_clean.split(':');
    let hour: u32 = t_iter.next()?.parse().ok()?;
    let minute: u32 = t_iter.next()?.parse().ok()?;
    let second: u32 = t_iter.next()?.parse().ok()?;

    Some(NetTime {
        dw_year: year,
        dw_month: month,
        dw_day: day,
        dw_hour: hour,
        dw_minute: minute,
        dw_second: second,
    })
}

#[tauri::command]
async fn start_hikvision_direct_download(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    download_id: String,
    ip: String,
    port: u16,
    user: String,
    pass: String,
    channel: u32,
    start_time_iso: String,
    end_time_iso: String,
    destination_file_path: String,
    duration_seconds: Option<u64>,
) -> Result<String, String> {
    let dest_path = PathBuf::from(&destination_file_path);
    if let Some(parent) = dest_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let auth = format!("{}:{}", user, pass);
        let http_port = if port == 0 || port == 554 { 80 } else { port };

        // 1. Query segments on Hikvision hard disk via ISAPI search
        let search_xml = format!(
            r#"<?xml version="1.0" encoding="utf-8"?><CMSearchDescription><searchID>C92DC285-8F30-0001-40C6-F0EFA8FB18B5</searchID><trackList><trackID>{}01</trackID></trackList><timeSpanList><timeSpan><startTime>{}</startTime><endTime>{}</endTime></timeSpan></timeSpanList><maxResults>20</maxResults><searchResultPostion>0</searchResultPostion><metadataList><metadataDescriptor>//recordType.meta.std-cgi.com</metadataDescriptor></metadataList></CMSearchDescription>"#,
            channel, start_time_iso, end_time_iso
        );

        let mut search_cmd = Command::new("curl.exe");
        search_cmd.args([
            "-s", "-k", "-L", "--location-trusted", "--connect-timeout", "3", "--max-time", "8",
            "--anyauth", "-u", &auth,
            "-X", "POST",
            "-H", "Content-Type: text/xml",
            "-d", &search_xml,
            &format!("http://{}:{}/ISAPI/ContentMgmt/search", ip, http_port),
        ]);
        search_cmd.creation_flags(CREATE_NO_WINDOW);
        let search_res = search_cmd.output().map_err(|e| format!("Error en búsqueda ISAPI Hikvision: {}", e))?;
        let search_text = String::from_utf8_lossy(&search_res.stdout);

        let mut target_uri = None;
        for part in search_text.split("<playbackURI>").skip(1) {
            if let Some(end) = part.find("</playbackURI>") {
                let raw_uri = &part[..end];
                let clean_uri = raw_uri.replace("&amp;", "&");
                target_uri = Some(clean_uri);
                break;
            }
        }

        let playback_uri = target_uri.ok_or_else(|| {
            "No se encontraron segmentos grabados en el disco Hikvision para el intervalo solicitado".to_string()
        })?;

        // 2. Direct HTTP disk extraction via ISAPI downloadRequest
        let dl_body = format!(
            r#"<downloadRequest><playbackURI>{}</playbackURI></downloadRequest>"#,
            playback_uri
        );

        let mut cmd = Command::new("curl.exe");
        cmd.args([
            "-s", "-k", "-L", "--location-trusted", "-g", "--no-styled-output",
            "--anyauth", "-u", &auth,
            "-X", "POST",
            "-H", "Content-Type: text/xml",
            "-d", &dl_body,
            "-o", &destination_file_path,
            &format!("http://{}:{}/ISAPI/ContentMgmt/download", ip, http_port),
        ]);
        cmd.creation_flags(CREATE_NO_WINDOW);

        let mut child = cmd.spawn().map_err(|e| format!("No se pudo iniciar la descarga Hikvision: {}", e))?;
        let pid = child.id();

        {
            let mut map = state.active_downloads.lock().unwrap();
            map.insert(download_id.clone(), pid);
        }

        let dur = duration_seconds.unwrap_or(300);
        let estimated_bytes = (2.5 * 1024.0 * 1024.0 / 8.0 * dur as f64) as u64;

        let dl_id = download_id.clone();
        let app_clone = app.clone();
        let state_downloads = state.active_downloads.clone();
        let file_path_clone = destination_file_path.clone();

        let result = tauri::async_runtime::spawn_blocking(move || {
            let start_time = std::time::Instant::now();
            let mut last_bytes = 0u64;
            let mut last_time = start_time;

            loop {
                std::thread::sleep(std::time::Duration::from_millis(200));

                let is_registered = {
                    let map = state_downloads.lock().unwrap();
                    map.contains_key(&dl_id)
                };
                if !is_registered {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = fs::remove_file(&file_path_clone);
                    let _ = app_clone.emit("download-progress", DownloadProgressPayload {
                        id: dl_id.clone(),
                        status: "cancelled".to_string(),
                        bytes_downloaded: 0,
                        speed_bps: 0.0,
                        percentage: 0,
                        error: Some("Descarga cancelada por el usuario.".to_string()),
                    });
                    return Err("Descarga cancelada.".to_string());
                }

                match child.try_wait() {
                    Ok(Some(status)) => {
                        {
                            let mut map = state_downloads.lock().unwrap();
                            map.remove(&dl_id);
                        }

                        let file_size = fs::metadata(&file_path_clone).map(|m| m.len()).unwrap_or(0);
                        if (status.success() || file_size > 50_000) && file_size > 0 {
                            let _ = app_clone.emit("download-progress", DownloadProgressPayload {
                                id: dl_id.clone(),
                                status: "completed".to_string(),
                                bytes_downloaded: file_size,
                                speed_bps: 0.0,
                                percentage: 100,
                                error: None,
                            });
                            return Ok(file_path_clone);
                        } else {
                            let _ = fs::remove_file(&file_path_clone);
                            let err_msg = "El grabador Hikvision no envió datos de video para este segmento.".to_string();
                            let _ = app_clone.emit("download-progress", DownloadProgressPayload {
                                id: dl_id.clone(),
                                status: "error".to_string(),
                                bytes_downloaded: file_size,
                                speed_bps: 0.0,
                                percentage: 0,
                                error: Some(err_msg.clone()),
                            });
                            return Err(err_msg);
                        }
                    }
                    Ok(None) => {
                        let current_bytes = fs::metadata(&file_path_clone).map(|m| m.len()).unwrap_or(0);
                        let now = std::time::Instant::now();
                        let dt = (now - last_time).as_secs_f64();
                        let speed_bps = if dt > 0.0 {
                            (current_bytes.saturating_sub(last_bytes)) as f64 / dt
                        } else {
                            0.0
                        };
                        last_bytes = current_bytes;
                        last_time = now;

                        let percentage = if estimated_bytes > 0 {
                            ((current_bytes as f64 / estimated_bytes as f64) * 100.0).min(99.0) as u32
                        } else {
                            50
                        };

                        let _ = app_clone.emit("download-progress", DownloadProgressPayload {
                            id: dl_id.clone(),
                            status: "downloading".to_string(),
                            bytes_downloaded: current_bytes,
                            speed_bps,
                            percentage,
                            error: None,
                        });
                    }
                    Err(e) => {
                        let _ = fs::remove_file(&file_path_clone);
                        let _ = app_clone.emit("download-progress", DownloadProgressPayload {
                            id: dl_id.clone(),
                            status: "error".to_string(),
                            bytes_downloaded: 0,
                            speed_bps: 0.0,
                            percentage: 0,
                            error: Some(e.to_string()),
                        });
                        return Err(e.to_string());
                    }
                }
            }
        })
        .await
        .map_err(|e| e.to_string())?;

        result
    }
    #[cfg(not(windows))]
    {
        Err("Unsupported OS".to_string())
    }
}

#[tauri::command]
async fn start_dahua_direct_download(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    download_id: String,
    ip: String,
    port: Option<u16>,
    user: String,
    pass: String,
    channel: u32,
    start_time: String,
    end_time: String,
    destination_file_path: String,
    duration_seconds: Option<u64>,
) -> Result<String, String> {
    let dest_path = PathBuf::from(&destination_file_path);
    if let Some(parent) = dest_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    #[cfg(windows)]
    {
        let dl_id = download_id.clone();
        let app_clone = app.clone();
        let state_dahua = state.active_dahua_downloads.clone();
        let file_path_clone = destination_file_path.clone();

        let result = tauri::async_runtime::spawn_blocking(move || {
            let sdk_path = get_dhnetsdk_path()
                .ok_or_else(|| "No se encontró dhnetsdk.dll en las rutas del sistema".to_string())?;

            if let Some(parent) = sdk_path.parent() {
                let wide_dir = to_wide_null(parent.as_os_str());
                unsafe { SetDllDirectoryW(wide_dir.as_ptr()); }
            }

            let wide_sdk = to_wide_null(sdk_path.as_os_str());
            let h_mod = unsafe { LoadLibraryW(wide_sdk.as_ptr()) };
            if h_mod.is_null() {
                return Err(format!("No se pudo cargar dhnetsdk.dll desde {:?}", sdk_path));
            }

            let fn_init = unsafe {
                let p = GetProcAddress(h_mod, b"CLIENT_Init\0".as_ptr());
                if p.is_null() { return Err("Función CLIENT_Init no encontrada".to_string()); }
                std::mem::transmute::<*mut std::ffi::c_void, unsafe extern "system" fn(usize, usize) -> bool>(p)
            };
            let fn_login = unsafe {
                let p = GetProcAddress(h_mod, b"CLIENT_LoginWithHighLevelSecurity\0".as_ptr());
                if p.is_null() { return Err("Función CLIENT_LoginWithHighLevelSecurity no encontrada".to_string()); }
                std::mem::transmute::<*mut std::ffi::c_void, unsafe extern "system" fn(*const NetInLoginWithHighLevelSecurity, *mut NetOutLoginWithHighLevelSecurity) -> i64>(p)
            };
            let fn_download = unsafe {
                let p = GetProcAddress(h_mod, b"CLIENT_DownloadByTimeEx\0".as_ptr());
                if p.is_null() { return Err("Función CLIENT_DownloadByTimeEx no encontrada".to_string()); }
                std::mem::transmute::<*mut std::ffi::c_void, unsafe extern "system" fn(i64, i32, i32, *const NetTime, *const NetTime, *const i8, Option<unsafe extern "system" fn(i64, u32, u32, usize)>, usize, usize, usize, usize) -> i64>(p)
            };
            let fn_stop = unsafe {
                let p = GetProcAddress(h_mod, b"CLIENT_StopDownload\0".as_ptr());
                if p.is_null() { return Err("Función CLIENT_StopDownload no encontrada".to_string()); }
                std::mem::transmute::<*mut std::ffi::c_void, unsafe extern "system" fn(i64) -> bool>(p)
            };
            let fn_logout = unsafe {
                let p = GetProcAddress(h_mod, b"CLIENT_Logout\0".as_ptr());
                if p.is_null() { return Err("Función CLIENT_Logout no encontrada".to_string()); }
                std::mem::transmute::<*mut std::ffi::c_void, unsafe extern "system" fn(i64) -> bool>(p)
            };

            unsafe { fn_init(0, 0); }

            let n_port = match port {
                Some(p) if p != 0 && p != 554 && p != 80 => p as i32,
                _ => 37777,
            };

            let mut in_param = NetInLoginWithHighLevelSecurity {
                dw_size: std::mem::size_of::<NetInLoginWithHighLevelSecurity>() as u32,
                sz_ip: [0; 64],
                n_port,
                sz_user_name: [0; 64],
                sz_password: [0; 64],
                em_spec_cap: 0,
                p_cap_param: std::ptr::null_mut(),
            };
            copy_str_to_buf(&ip, &mut in_param.sz_ip);
            copy_str_to_buf(&user, &mut in_param.sz_user_name);
            copy_str_to_buf(&pass, &mut in_param.sz_password);

            let mut out_param = NetOutLoginWithHighLevelSecurity {
                dw_size: std::mem::size_of::<NetOutLoginWithHighLevelSecurity>() as u32,
                stu_device_info: unsafe { std::mem::zeroed() },
                n_error: 0,
                reserved: [0; 132],
            };

            let login_id = unsafe { fn_login(&in_param, &mut out_param) };
            if login_id == 0 {
                return Err(format!(
                    "Error al conectar con Dahua {}:{} (Código de error: {})",
                    ip, n_port, out_param.n_error
                ));
            }

            let tm_start = parse_iso_to_net_time(&start_time)
                .ok_or_else(|| "Formato de hora de inicio inválido para Dahua".to_string())?;
            let tm_end = parse_iso_to_net_time(&end_time)
                .ok_or_else(|| "Formato de hora de fin inválido para Dahua".to_string())?;

            let path_cstr = std::ffi::CString::new(file_path_clone.clone())
                .map_err(|e| e.to_string())?;

            let ctx = Arc::new(DahuaSdkContext {
                finished: AtomicBool::new(false),
                total_bytes: AtomicU64::new(0),
                downloaded_bytes: AtomicU64::new(0),
            });
            let ctx_ptr = Arc::as_ptr(&ctx) as usize;

            let cancel_flag = Arc::new(AtomicBool::new(false));
            {
                let mut map = state_dahua.lock().unwrap();
                map.insert(dl_id.clone(), cancel_flag.clone());
            }

            let ch_idx = (channel.saturating_sub(1)) as i32;
            let dl_handle = unsafe {
                fn_download(
                    login_id,
                    ch_idx,
                    0,
                    &tm_start,
                    &tm_end,
                    path_cstr.as_ptr(),
                    Some(dahua_download_cb),
                    ctx_ptr,
                    0,
                    0,
                    0,
                )
            };

            if dl_handle == 0 {
                unsafe { fn_logout(login_id); }
                {
                    let mut map = state_dahua.lock().unwrap();
                    map.remove(&dl_id);
                }
                return Err(format!("Dahua no pudo iniciar la extracción de disco para el canal {}", channel));
            }

            let dur = duration_seconds.unwrap_or(300);
            let estimated_bytes = (2.5 * 1024.0 * 1024.0 / 8.0 * dur as f64) as u64;

            let mut last_bytes = 0u64;
            let mut last_time = std::time::Instant::now();
            let mut no_growth_ticks = 0;

            loop {
                std::thread::sleep(std::time::Duration::from_millis(200));

                if cancel_flag.load(Ordering::SeqCst) {
                    unsafe {
                        fn_stop(dl_handle);
                        fn_logout(login_id);
                    }
                    {
                        let mut map = state_dahua.lock().unwrap();
                        map.remove(&dl_id);
                    }
                    let _ = fs::remove_file(&file_path_clone);
                    let _ = app_clone.emit("download-progress", DownloadProgressPayload {
                        id: dl_id.clone(),
                        status: "cancelled".to_string(),
                        bytes_downloaded: 0,
                        speed_bps: 0.0,
                        percentage: 0,
                        error: Some("Descarga cancelada por el usuario.".to_string()),
                    });
                    return Err("Descarga cancelada.".to_string());
                }

                let current_bytes = fs::metadata(&file_path_clone).map(|m| m.len()).unwrap_or(0);
                let now = std::time::Instant::now();
                let dt = (now - last_time).as_secs_f64();
                let speed_bps = if dt > 0.0 {
                    (current_bytes.saturating_sub(last_bytes)) as f64 / dt
                } else {
                    0.0
                };
                last_bytes = current_bytes;
                last_time = now;

                let is_finished = ctx.finished.load(Ordering::SeqCst);
                let total = ctx.total_bytes.load(Ordering::Relaxed);

                if current_bytes > 0 && speed_bps < 1000.0 {
                    no_growth_ticks += 1;
                } else {
                    no_growth_ticks = 0;
                }

                let percentage = if total > 0 {
                    ((current_bytes as f64 / total as f64) * 100.0).min(99.0) as u32
                } else if estimated_bytes > 0 {
                    ((current_bytes as f64 / estimated_bytes as f64) * 100.0).min(99.0) as u32
                } else {
                    50
                };

                if is_finished || (no_growth_ticks >= 25 && current_bytes > 50_000) {
                    unsafe {
                        fn_stop(dl_handle);
                        fn_logout(login_id);
                    }
                    {
                        let mut map = state_dahua.lock().unwrap();
                        map.remove(&dl_id);
                    }

                    let file_size = fs::metadata(&file_path_clone).map(|m| m.len()).unwrap_or(0);
                    if file_size > 50_000 {
                        let _ = app_clone.emit("download-progress", DownloadProgressPayload {
                            id: dl_id.clone(),
                            status: "completed".to_string(),
                            bytes_downloaded: file_size,
                            speed_bps: 0.0,
                            percentage: 100,
                            error: None,
                        });
                        return Ok(file_path_clone);
                    } else {
                        let _ = fs::remove_file(&file_path_clone);
                        let err_msg = "Archivo vacío recibido del grabador Dahua.".to_string();
                        let _ = app_clone.emit("download-progress", DownloadProgressPayload {
                            id: dl_id.clone(),
                            status: "error".to_string(),
                            bytes_downloaded: 0,
                            speed_bps: 0.0,
                            percentage: 0,
                            error: Some(err_msg.clone()),
                        });
                        return Err(err_msg);
                    }
                }

                let _ = app_clone.emit("download-progress", DownloadProgressPayload {
                    id: dl_id.clone(),
                    status: "downloading".to_string(),
                    bytes_downloaded: current_bytes,
                    speed_bps,
                    percentage,
                    error: None,
                });
            }
        })
        .await
        .map_err(|e| e.to_string())?;

        result
    }
    #[cfg(not(windows))]
    {
        Err("Unsupported OS".to_string())
    }
}

#[tauri::command]
fn cancel_video_download(state: State<'_, AppState>, download_id: String) -> Result<(), String> {
    let mut map = state.active_downloads.lock().unwrap();
    if let Some(pid) = map.remove(&download_id) {
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let mut cmd = Command::new("taskkill");
            cmd.args(["/F", "/T", "/PID", &pid.to_string()]);
            cmd.creation_flags(CREATE_NO_WINDOW);
            let _ = cmd.output();
        }
    }
    let mut dahua_map = state.active_dahua_downloads.lock().unwrap();
    if let Some(stop_flag) = dahua_map.remove(&download_id) {
        stop_flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}

#[tauri::command]
fn open_folder_and_select(file_path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = Command::new("explorer.exe");
        cmd.args(["/select,", &file_path]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        let _ = cmd.spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn query_recorded_days(
    vendor: String,
    ip: String,
    _port: Option<u16>,
    user: String,
    pass: Option<String>,
    channel: u32,
    year: u32,
    month: u32,
) -> Result<Vec<u32>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let password = pass.unwrap_or_default();
            let auth = format!("{}:{}", user, password);

            // Days in month: 28 to 31
            let last_day = match month {
                4 | 6 | 9 | 11 => 30,
                2 => if (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0) { 29 } else { 28 },
                _ => 31,
            };

            let mut days = BTreeSet::new();

            if vendor.to_lowercase() == "hikvision" {
                let mut position = 0;
                let mut has_more = true;
                let target_prefix = format!("{}-{:02}-", year, month);

                while has_more && position <= 500 {
                    let xml = format!(
                        r#"<?xml version="1.0" encoding="utf-8"?><CMSearchDescription><searchID>C92DC285-8F30-0001-40C6-F0EFA8FB18B5</searchID><trackList><trackID>{}01</trackID></trackList><timeSpanList><timeSpan><startTime>{}-{:02}-01T00:00:00Z</startTime><endTime>{}-{:02}-{:02}T23:59:59Z</endTime></timeSpan></timeSpanList><maxResults>100</maxResults><searchResultPostion>{}</searchResultPostion><metadataList><metadataDescriptor>//recordType.meta.std-cgi.com</metadataDescriptor></metadataList></CMSearchDescription>"#,
                        channel, year, month, year, month, last_day, position
                    );

                    let mut cmd = Command::new("curl.exe");
                    cmd.args([
                        "-s", "-k", "-L", "--location-trusted", "--connect-timeout", "2", "--max-time", "6",
                        "--anyauth", "-u", &auth,
                        "-X", "POST",
                        "-H", "Content-Type: text/xml",
                        "-d", &xml,
                        &format!("http://{}/ISAPI/ContentMgmt/search", ip),
                    ]);
                    cmd.creation_flags(CREATE_NO_WINDOW);

                    if let Ok(out) = cmd.output() {
                        let text = String::from_utf8_lossy(&out.stdout);
                        let mut found_in_page = 0;
                        for part in text.split(&target_prefix).skip(1) {
                            if part.len() >= 2 {
                                if let Ok(d) = part[..2].parse::<u32>() {
                                    if d >= 1 && d <= 31 {
                                        days.insert(d);
                                        found_in_page += 1;
                                    }
                                }
                            }
                        }

                        if text.contains("MORE") && found_in_page > 0 {
                            position += 64;
                        } else {
                            has_more = false;
                        }
                    } else {
                        has_more = false;
                    }
                }
            } else if vendor.to_lowercase() == "juan" {
                // Juan / EseeCloud: Query R.SearchRecord
                let ch_idx = (channel.saturating_sub(1)) as usize;
                let mut ch_bools = vec!["False"; 10];
                if ch_idx < ch_bools.len() {
                    ch_bools[ch_idx] = "True";
                } else {
                    ch_bools[0] = "True";
                }
                let ch_json = format!(r#"["{}"]"#, ch_bools.join(r#"",""#));

                for d in 1..=last_day {
                    let date_str = format!("{}-{:02}-{:02}", year, month, d);
                    let body = format!(
                        r#"{{"DEV":"XVR","VER":"1.0","API":"R.SearchRecord","Parameter":{{"Channel":{},"Type":["True","True","True"],"Date":"{}","BeginTime":"00:00:00","EndTime":"23:59:59","PageSize":1,"CurrentPage":"1","Reload":"True"}}}}"#,
                        ch_json, date_str
                    );

                    let mut cmd = Command::new("curl.exe");
                    cmd.args([
                        "-s", "-k", "--connect-timeout", "1", "--max-time", "2",
                        "-u", &auth,
                        "-X", "POST",
                        "-H", "Content-Type: application/json",
                        "-d", &body,
                        &format!("http://{}/netsdk/R.SearchRecord", ip),
                    ]);
                    cmd.creation_flags(CREATE_NO_WINDOW);

                    if let Ok(out) = cmd.output() {
                        let text = String::from_utf8_lossy(&out.stdout);
                        if let Some(pos) = text.find(r#""SearchCnt""#) {
                            let rest = &text[pos..];
                            if let Some(val_start) = rest.find(':') {
                                let val_str = rest[val_start + 1..].trim_start().trim_matches(|c| c == '"' || c == ' ' || c == '\r' || c == '\n');
                                let num_str: String = val_str.chars().take_while(|c| c.is_ascii_digit()).collect();
                                if let Ok(cnt) = num_str.parse::<u32>() {
                                    if cnt > 0 {
                                        days.insert(d);
                                    }
                                }
                            }
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_millis(15));
                }
            } else {
                // Dahua protocol
                let start_time = format!("{}-{:02}-01%2000:00:00", year, month);
                let end_time = format!("{}-{:02}-{:02}%2023:59:59", year, month, last_day);

                // Determine protocol: try https first, then http
                let base_urls = [
                    format!("https://{}", ip),
                    format!("http://{}", ip),
                ];

                for base_url in &base_urls {
                    // 1. Create factory
                    let mut cmd = Command::new("curl.exe");
                    cmd.args([
                        "-s", "-k", "--digest", "-u", &auth, "--connect-timeout", "2", "--max-time", "3",
                        &format!("{}/cgi-bin/mediaFileFind.cgi?action=factory.create", base_url),
                    ]);
                    cmd.creation_flags(CREATE_NO_WINDOW);

                    let obj_id = if let Ok(out) = cmd.output() {
                        let text = String::from_utf8_lossy(&out.stdout);
                        if let Some(pos) = text.find("result=") {
                            text[pos + 7..].trim().lines().next().unwrap_or("").to_string()
                        } else {
                            String::new()
                        }
                    } else {
                        String::new()
                    };

                    if !obj_id.is_empty() {
                        // 2. Find file
                        let mut cmd_find = Command::new("curl.exe");
                        cmd_find.args([
                            "-s", "-k", "--digest", "-u", &auth, "--connect-timeout", "2", "--max-time", "4",
                            &format!(
                                "{}/cgi-bin/mediaFileFind.cgi?action=findFile&object={}&condition.Channel={}&condition.StartTime={}&condition.EndTime={}",
                                base_url, obj_id, channel, start_time, end_time
                            ),
                        ]);
                        cmd_find.creation_flags(CREATE_NO_WINDOW);
                        let _ = cmd_find.output();

                        // 3. Loop findNextFile batches to collect all days in month
                        for _ in 0..15 {
                            let mut cmd_next = Command::new("curl.exe");
                            cmd_next.args([
                                "-s", "-k", "--digest", "-u", &auth, "--connect-timeout", "2", "--max-time", "4",
                                &format!(
                                    "{}/cgi-bin/mediaFileFind.cgi?action=findNextFile&object={}&count=100",
                                    base_url, obj_id
                                ),
                            ]);
                            cmd_next.creation_flags(CREATE_NO_WINDOW);

                            if let Ok(out) = cmd_next.output() {
                                let text = String::from_utf8_lossy(&out.stdout);
                                if text.contains("found=0") {
                                    break;
                                }
                                let target_prefix = format!("{}-{:02}-", year, month);
                                for part in text.split(&target_prefix).skip(1) {
                                    if part.len() >= 2 {
                                        if let Ok(d) = part[..2].parse::<u32>() {
                                            if d >= 1 && d <= 31 {
                                                days.insert(d);
                                            }
                                        }
                                    }
                                }
                            } else {
                                break;
                            }
                        }

                        // 4. Destroy object
                        let mut cmd_destroy = Command::new("curl.exe");
                        cmd_destroy.args([
                            "-s", "-k", "--digest", "-u", &auth, "--connect-timeout", "2", "--max-time", "2",
                            &format!(
                                "{}/cgi-bin/mediaFileFind.cgi?action=destroy&object={}",
                                base_url, obj_id
                            ),
                        ]);
                        cmd_destroy.creation_flags(CREATE_NO_WINDOW);
                        let _ = cmd_destroy.output();

                        // If we found the object and scanned, no need to try http
                        break;
                    }
                }
            }

            Ok(days.into_iter().collect())
        }
        #[cfg(not(windows))]
        {
            Ok(vec![])
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
struct UpdateInfo {
    available: bool,
    version: Option<String>,
    current_version: String,
    body: Option<String>,
}

#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let current_version = app.package_info().version.to_string();
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => return Err(e.to_string()),
    };
    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateInfo {
            available: true,
            version: Some(update.version),
            current_version,
            body: update.body,
        }),
        Ok(None) => Ok(UpdateInfo {
            available: false,
            version: None,
            current_version,
            body: None,
        }),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn install_update(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    // Stop all background engines to release file locks
    let _ = stop_go2rtc(state.clone());
    let _ = stop_whatsapp_gateway(state);

    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = Command::new("cmd");
        cmd.args(["/c", "taskkill /F /IM go2rtc.exe /T"]);
        cmd.creation_flags(CREATE_NO_WINDOW);
        let _ = cmd.output();
    }

    let updater = app.updater().map_err(|e| e.to_string())?;
    if let Some(update) = updater.check().await.map_err(|e| e.to_string())? {
        update.download_and_install(|_chunk, _total| {}, || {}).await.map_err(|e| e.to_string())?;
        app.restart();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            for (_, window) in app.webview_windows() {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            go2rtc_process: Mutex::new(None),
            whatsapp_process: Mutex::new(None),
            active_downloads: Arc::new(Mutex::new(HashMap::new())),
            active_dahua_downloads: Arc::new(Mutex::new(HashMap::new())),
        })
        .invoke_handler(tauri::generate_handler![
            check_go2rtc_running,
            start_go2rtc,
            stop_go2rtc,
            start_whatsapp_gateway,
            stop_whatsapp_gateway,
            load_cameras,
            save_cameras,
            load_settings,
            save_settings,
            get_config_file_path,
            open_dvr_web,
            fetch_dvr_api,
            set_autostart,
            get_autostart,
            close_app_completely,
            prompt_save_file,
            save_binary_file,
            start_video_download,
            start_hikvision_direct_download,
            start_dahua_direct_download,
            cancel_video_download,
            open_folder_and_select,
            query_recorded_days,
            check_update,
            install_update
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Auto-start background engines (go2rtc and WhatsApp gateway)
            let state: State<AppState> = app.state();
            let _ = start_go2rtc(state.clone());
            let _ = start_whatsapp_gateway(state);

            // Ensure startup registration is active on Windows
            let _ = set_autostart(true);

            // System Tray
            let show_i = MenuItem::with_id(app, "show", "Mostrar Monitor CCTV", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Salir completamente (Cerrar procesos)", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("Monitor CCTV - Vigilancia 24/7")
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            for (_, window) in app.webview_windows() {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            let state: State<AppState> = app.state();
                            let _ = stop_go2rtc(state.clone());
                            let _ = stop_whatsapp_gateway(state);

                            #[cfg(windows)]
                            {
                                const CREATE_NO_WINDOW: u32 = 0x08000000;
                                let mut cmd = Command::new("cmd");
                                cmd.args(["/c", "for /f \"tokens=5\" %a in ('netstat -aon ^| findstr \":8120\" ^| findstr \"LISTENING\"') do taskkill /F /PID %a"]);
                                cmd.creation_flags(CREATE_NO_WINDOW);
                                let _ = cmd.output();
                            }

                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        for (_, window) in app.webview_windows() {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                });

            let icon = app.default_window_icon().cloned()
                .or_else(|| tauri::image::Image::from_app_icon_resource(32).ok());
            if let Some(icon) = icon {
                tray_builder = tray_builder.icon(icon);
            }

            let _ = tray_builder.build(app);

            // Ensure main window is shown and focused
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // Minimize/hide to system tray so monitoring keeps running!
                    api.prevent_close();
                    let _ = window.hide();
                }
                tauri::WindowEvent::Destroyed => {
                    let state: State<AppState> = window.state();
                    let _ = stop_go2rtc(state.clone());
                    let _ = stop_whatsapp_gateway(state);
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
