use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::io::Write;
use std::collections::BTreeSet;
use tauri_plugin_updater::UpdaterExt;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State,
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

struct AppState {
    go2rtc_process: Mutex<Option<Child>>,
    whatsapp_process: Mutex<Option<Child>>,
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
fn fetch_dvr_api(
    url: String,
    method: String,
    auth: Option<String>,
    body: Option<String>,
    content_type: Option<String>,
) -> Result<String, String> {
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let mut cmd = Command::new("curl.exe");
        cmd.args(["-s", "-k", "-L", "--location-trusted", "--max-time", "6"]);

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
                let xml = format!(
                    r#"<?xml version="1.0" encoding="utf-8"?><CMSearchDescription><searchID>C92DC285-8F30-0001-40C6-F0EFA8FB18B5</searchID><trackList><trackID>{}01</trackID></trackList><timeSpanList><timeSpan><startTime>{}-{:02}-01T00:00:00Z</startTime><endTime>{}-{:02}-{:02}T23:59:59Z</endTime></timeSpan></timeSpanList><maxResults>100</maxResults><searchResultPostion>0</searchResultPostion><metadataList><metadataDescriptor>//recordType.meta.std-cgi.com</metadataDescriptor></metadataList></CMSearchDescription>"#,
                    channel, year, month, year, month, last_day
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
