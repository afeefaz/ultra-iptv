//! Check for updates on the Mac (Settings → System), only when pressed: Tauri's updater downloads
//! the new app from our GitHub releases, checks its signature (our updater key), and replaces this
//! one; then the app restarts into it.
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

/** Tauri's release file on our website (the relay's static page), written by release-manifest.mjs. */
const UPDATE_URL: &str = "https://ultra-iptv-relay.afeef-az11.workers.dev/desktop/update.json";
/** Nothing is installed from anywhere else. */
const ALLOWED_PREFIX: &str = "https://github.com/afeefaz/ultra-iptv/releases/download/";

/** Debug builds can test against a local server (ULTRA_UPDATE_URL, ULTRA_UPDATE_PREFIX); release builds can't. */
fn endpoint() -> (String, String) {
    #[cfg(debug_assertions)]
    if let (Ok(url), Ok(prefix)) = (
        std::env::var("ULTRA_UPDATE_URL"),
        std::env::var("ULTRA_UPDATE_PREFIX"),
    ) {
        return (url, prefix);
    }
    (UPDATE_URL.to_string(), ALLOWED_PREFIX.to_string())
}

/** Our versions as one number: 0.8.1 → 8001, comparable with the website's `versionCode`. */
pub fn version_code(version: &str) -> u32 {
    let mut parts = version
        .split(['.', '-', '+'])
        .map(|p| p.parse::<u32>().unwrap_or(0));
    let (major, minor, patch) = (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    );
    major * 1_000_000 + minor * 1000 + patch
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    version_code: u32,
    can_install: bool,
    /** Why not: the app runs from somewhere it can't replace itself (the DMG, or Downloads). */
    blocker: Option<&'static str>,
}

#[tauri::command]
pub fn update_info(app: AppHandle) -> Info {
    let version = app.package_info().version.to_string();
    let exe = std::env::current_exe().ok();
    let bundle = exe
        .as_ref()
        .and_then(|e| e.ancestors().nth(3).map(|p| p.to_path_buf()));
    let movable = bundle.as_ref().is_some_and(|b| {
        let path = b.to_string_lossy();
        let writable = b
            .parent()
            .is_some_and(|dir| std::fs::metadata(dir).is_ok_and(|m| !m.permissions().readonly()));
        !path.contains("/AppTranslocation/") && !path.starts_with("/Volumes/") && writable
    });
    Info {
        version_code: version_code(&version),
        can_install: movable,
        blocker: if movable { None } else { Some("location") },
    }
}

fn problem(e: tauri_plugin_updater::Error) -> String {
    use tauri_plugin_updater::Error as E;
    match e {
        E::Minisign(_) | E::Base64(_) | E::SignatureUtf8(_) => "corrupt",
        E::Reqwest(_) => "network",
        E::Io(ref io) if io.raw_os_error() == Some(28) => "storage",
        _ => "install",
    }
    .into()
}

/** Installs `expected_version` (what the app showed), reporting progress in percent. */
#[tauri::command]
pub async fn update_install(
    app: AppHandle,
    expected_version: String,
    on_progress: Channel<u32>,
) -> Result<(), String> {
    let (endpoint, allowed) = endpoint();
    let url = endpoint.parse().map_err(|_| "install".to_string())?;
    let updater = app
        .updater_builder()
        .endpoints(vec![url])
        .map_err(problem)?
        .build()
        .map_err(problem)?;
    let Some(update) = updater.check().await.map_err(problem)? else {
        return Err("install".into());
    };
    if update.version != expected_version || !update.download_url.as_str().starts_with(&allowed) {
        return Err("install".into());
    }
    let mut received = 0u64;
    let mut last = 0u32;
    update
        .download_and_install(
            |chunk, total| {
                received += chunk as u64;
                if let Some(total) = total.filter(|t| *t > 0) {
                    let percent = (received * 100 / total).min(100) as u32;
                    if percent != last {
                        last = percent;
                        let _ = on_progress.send(percent);
                    }
                }
            },
            || {},
        )
        .await
        .map_err(problem)?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::version_code;

    #[test]
    fn turns_versions_into_comparable_numbers() {
        assert_eq!(version_code("0.8.0"), 8000);
        assert_eq!(version_code("0.8.12"), 8012);
        assert_eq!(version_code("1.0.0"), 1_000_000);
        assert!(version_code("0.10.0") > version_code("0.9.9"));
    }
}
