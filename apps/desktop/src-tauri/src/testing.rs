//! Debug builds only: runs a test script in the page (ULTRA_TEST_SCRIPT=path.js) and lets it print
//! results and screenshot this window. Never compiled into a release build.
use tauri::WebviewWindow;

#[tauri::command]
pub fn test_report(line: String) {
    println!("TEST {line}");
}

#[tauri::command]
pub fn test_shot(window: WebviewWindow, path: String) -> Result<(), String> {
    let id = unsafe {
        crate::mpv::ffi::ump_window_number(window.ns_window().map_err(|e| e.to_string())?)
    };
    let ok = std::process::Command::new("/usr/sbin/screencapture")
        .args(["-x", "-o", &format!("-l{id}"), &path])
        .status()
        .map_err(|e| e.to_string())?;
    if ok.success() {
        Ok(())
    } else {
        Err("screencapture failed".into())
    }
}

pub fn start(window: WebviewWindow) {
    let Ok(path) = std::env::var("ULTRA_TEST_SCRIPT") else {
        return;
    };
    let Ok(script) = std::fs::read_to_string(&path) else {
        eprintln!("TEST could not read {path}");
        return;
    };
    // Injected a few times (a page still loading drops it), but run once: the flag guards it.
    let guarded =
        format!("if (!window.__ultraTestRan) {{ window.__ultraTestRan = true; {script}\n}}");
    std::thread::spawn(move || {
        for delay in [3, 2, 2, 2, 3, 3, 4, 5, 6, 8] {
            std::thread::sleep(std::time::Duration::from_secs(delay));
            let _ = window.eval(&guarded);
        }
    });
}
