//! Small native helpers: app and Mac details, memory, speed test, saving a file, full screen.
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, WebviewWindow};

fn sysctl(name: &str) -> Option<String> {
    let out = std::process::Command::new("/usr/sbin/sysctl")
        .args(["-n", name])
        .output()
        .ok()?;
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    version: String,
    os_version: Option<String>,
    model: Option<String>,
    arch: &'static str,
}

#[tauri::command]
pub fn app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        os_version: sysctl("kern.osproductversion").map(|v| format!("macOS {v}")),
        model: sysctl("hw.model"),
        arch: std::env::consts::ARCH,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    ram_used: u64,
    ram_total: u64,
    app_used: u64,
}

#[tauri::command]
pub fn system_usage() -> Usage {
    use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};
    let mut sys = System::new();
    sys.refresh_memory();
    let pid = Pid::from_u32(std::process::id());
    sys.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[pid]),
        true,
        ProcessRefreshKind::nothing().with_memory(),
    );
    Usage {
        ram_used: sys.used_memory(),
        ram_total: sys.total_memory(),
        app_used: sys.process(pid).map(|p| p.memory()).unwrap_or(0),
    }
}

static CANCEL_DOWNLOAD: AtomicBool = AtomicBool::new(false);

#[derive(Serialize, Clone)]
pub struct Progress {
    bytes: u64,
    ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Download {
    status: u16,
    ttfb_ms: u64,
    bytes: u64,
    ms: u64,
}

/** Reads a stream for `seconds` and throws the data away: the speed test (Settings). */
#[tauri::command]
pub async fn measure_download(
    url: String,
    seconds: f64,
    on_progress: Channel<Progress>,
) -> Result<Download, String> {
    CANCEL_DOWNLOAD.store(false, Ordering::SeqCst);
    let mut headers = HashMap::new();
    // Uncompressed, so the count is what really crossed the network.
    headers.insert("Accept-Encoding".to_string(), "identity".to_string());
    let started = Instant::now();
    let mut res = crate::http::build_get(&url, &headers, 20_000)
        .send()
        .await
        .map_err(crate::http::describe)?;
    let status = res.status().as_u16();
    let ttfb_ms = started.elapsed().as_millis() as u64;
    let mut bytes = 0u64;
    let body_started = Instant::now();
    let mut last_report = 0u64;
    if seconds > 0.0 {
        while let Some(chunk) = res.chunk().await.map_err(crate::http::describe)? {
            bytes += chunk.len() as u64;
            let ms = body_started.elapsed().as_millis() as u64;
            if ms - last_report >= 200 {
                last_report = ms;
                let _ = on_progress.send(Progress { bytes, ms });
            }
            if CANCEL_DOWNLOAD.load(Ordering::SeqCst) || ms as f64 >= seconds * 1000.0 {
                break;
            }
        }
    }
    Ok(Download {
        status,
        ttfb_ms,
        bytes,
        ms: body_started.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
pub fn cancel_download() {
    CANCEL_DOWNLOAD.store(true, Ordering::SeqCst);
}

/** Saves text to Downloads (a log or a backup) and shows it in Finder. */
#[tauri::command]
pub fn export_text(app: AppHandle, filename: String, text: String) -> Result<(), String> {
    let name: String = filename
        .chars()
        .map(|c| {
            if c == '/' || c == ':' || c == '\\' {
                '_'
            } else {
                c
            }
        })
        .collect();
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let file = dir.join(if name.is_empty() {
        "UltraIPTV.txt".to_string()
    } else {
        name
    });
    std::fs::write(&file, text).map_err(|e| e.to_string())?;
    let _ = std::process::Command::new("/usr/bin/open")
        .arg("-R")
        .arg(&file)
        .spawn();
    Ok(())
}

#[tauri::command]
pub fn set_fullscreen(window: WebviewWindow, on: bool) -> Result<(), String> {
    window.set_fullscreen(on).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn is_fullscreen(window: WebviewWindow) -> bool {
    window.is_fullscreen().unwrap_or(false)
}

/**
 * The key that encrypts saved logins: 32 random bytes in a file only this user can read, made on
 * first use. Kept here rather than as a CryptoKey in the web database, which WebKit protects with
 * the login keychain and so asks for its password whenever an unsigned app's signature changes.
 */
#[tauri::command]
pub fn secret_key(app: AppHandle) -> Result<Vec<u8>, String> {
    use std::io::Read;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join("secret.key");
    if let Ok(bytes) = std::fs::read(&file) {
        if bytes.len() == 32 {
            return Ok(bytes);
        }
    }
    let mut key = vec![0u8; 32];
    std::fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut key))
        .map_err(|e| e.to_string())?;
    let mut out = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&file)
        .map_err(|e| e.to_string())?;
    std::io::Write::write_all(&mut out, &key).map_err(|e| e.to_string())?;
    let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600));
    Ok(key)
}
