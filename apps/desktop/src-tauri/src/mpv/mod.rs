//! The video player: one libmpv instance for the window, drawn under the page (see view.rs). The page's adapter (packages/platform/src/desktop/player.ts) turns these
//! events into the app's player states, as it does for ExoPlayer on Android.
//!
//! Stream addresses contain logins, so neither URLs nor mpv's own log lines ever leave this module:
//! log lines are only read here to tell an HTTP error or a failed connection apart.
pub mod ffi;
pub mod view;

use ffi::*;
use regex::Regex;
use serde_json::{json, Value};
use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::sync::{Mutex, OnceLock};
use tauri::ipc::Channel;
use tauri::{AppHandle, State};

pub struct Mpv {
    handle: *mut mpv_handle,
    view: Mutex<view::View>,
    sink: Mutex<Option<Channel<Value>>>,
    /** What mpv logged about the file being opened, for the next error. */
    problem: Mutex<(Option<u16>, bool)>,
}

// libmpv's client API is thread-safe; the view pointer is only used on the main thread.
unsafe impl Send for Mpv {}
unsafe impl Sync for Mpv {}

fn c(s: &str) -> CString {
    CString::new(s.replace('\0', "")).unwrap_or_default()
}

fn err(code: i32) -> String {
    unsafe {
        CStr::from_ptr(mpv_error_string(code))
            .to_string_lossy()
            .into_owned()
    }
}

/** Sent to the page whenever they change. */
const OBSERVED: &[(&str, i32)] = &[
    ("time-pos", MPV_FORMAT_DOUBLE),
    ("duration", MPV_FORMAT_DOUBLE),
    ("pause", MPV_FORMAT_FLAG),
    ("paused-for-cache", MPV_FORMAT_FLAG),
    ("seeking", MPV_FORMAT_FLAG),
    ("hwdec-current", MPV_FORMAT_STRING),
    ("demuxer-cache-duration", MPV_FORMAT_DOUBLE),
    ("frame-drop-count", MPV_FORMAT_INT64),
    ("decoder-frame-drop-count", MPV_FORMAT_INT64),
    ("video-params/w", MPV_FORMAT_INT64),
    ("video-params/h", MPV_FORMAT_INT64),
    ("video-bitrate", MPV_FORMAT_DOUBLE),
    ("track-list", MPV_FORMAT_STRING),
];

impl Mpv {
    /** `wid`: the window mpv draws into itself (Windows); none when the app draws it (macOS). */
    pub fn new(wid: Option<i64>) -> Result<Mpv, String> {
        load()?;
        unsafe {
            let handle = mpv_create();
            if handle.is_null() {
                return Err("mpv could not start".into());
            }
            // How the picture is drawn: by our view through the render API (macOS), or by mpv
            // itself into our child window with Direct3D 11 (Windows).
            #[cfg(target_os = "macos")]
            let video: Vec<(&str, String)> =
                vec![("vo", "libmpv".into()), ("hwdec", "videotoolbox".into())];
            #[cfg(windows)]
            let video: Vec<(&str, String)> = vec![
                ("vo", "gpu-next".into()),
                ("gpu-api", "d3d11".into()),
                ("hwdec", "d3d11va".into()),
                ("wid", wid.map(|w| w.to_string()).unwrap_or_default()),
            ];
            #[cfg(not(any(target_os = "macos", windows)))]
            let video: Vec<(&str, String)> = vec![("vo", "libmpv".into())];
            let _ = wid;
            for (k, v) in video {
                mpv_set_option_string(handle, c(k).as_ptr(), c(&v).as_ptr());
            }
            for (k, v) in [
                ("config", "no"),
                ("terminal", "no"),
                ("load-scripts", "no"),
                ("ytdl", "no"),
                ("osc", "no"),
                ("input-default-bindings", "no"),
                ("input-vo-keyboard", "no"),
                ("idle", "yes"),
                ("keep-open", "no"),
                ("tls-verify", "yes"),
                ("network-timeout", "15"),
                ("audio-display", "no"),
                ("sub-auto", "no"),
                ("cache", "yes"),
            ] {
                mpv_set_option_string(handle, c(k).as_ptr(), c(v).as_ptr());
            }
            let r = mpv_initialize(handle);
            if r < 0 {
                mpv_terminate_destroy(handle);
                return Err(format!("mpv could not start: {}", err(r)));
            }
            for (i, (name, format)) in OBSERVED.iter().enumerate() {
                mpv_observe_property(handle, i as u64 + 1, c(name).as_ptr(), *format);
            }
            mpv_request_log_messages(handle, c("warn").as_ptr());
            Ok(Mpv {
                handle,
                view: Mutex::new(view::View::default()),
                sink: Mutex::new(None),
                problem: Mutex::new((None, false)),
            })
        }
    }

    fn command(&self, args: &[&str]) -> Result<(), String> {
        let owned: Vec<CString> = args.iter().map(|a| c(a)).collect();
        let mut ptrs: Vec<*const c_char> = owned.iter().map(|a| a.as_ptr()).collect();
        ptrs.push(std::ptr::null());
        let r = unsafe { mpv_command_async(self.handle, 0, ptrs.as_mut_ptr()) };
        if r < 0 {
            Err(err(r))
        } else {
            Ok(())
        }
    }

    fn set(&self, name: &str, value: &str) -> Result<(), String> {
        let r =
            unsafe { mpv_set_property_string(self.handle, c(name).as_ptr(), c(value).as_ptr()) };
        if r < 0 {
            Err(format!("{name}: {}", err(r)))
        } else {
            Ok(())
        }
    }

    pub fn raw_handle(&self) -> *mut mpv_handle {
        self.handle
    }

    pub fn attach_view(&self, view: view::View) {
        *self.view.lock().unwrap() = view;
    }

    pub fn view(&self) -> view::View {
        *self.view.lock().unwrap()
    }

    fn send(&self, payload: Value) {
        if let Some(sink) = self.sink.lock().unwrap().as_ref() {
            let _ = sink.send(payload);
        }
    }
}

/** What an mpv log line says about a failed open, if anything. */
fn classify(text: &str) -> (Option<u16>, bool) {
    static HTTP: OnceLock<Regex> = OnceLock::new();
    static CONNECT: OnceLock<Regex> = OnceLock::new();
    let http = HTTP.get_or_init(|| Regex::new(r"(?i)\bHTTP(?:/[\d.]+)?\s*(?:error|status|code)?\s*:?\s*([45]\d\d)\b|\b([45]\d\d)\s+(?:Not Found|Forbidden|Unauthorized|Bad Request|Service Unavailable|Internal Server Error|Bad Gateway|Gateway Time-?out)").unwrap());
    let connect = CONNECT.get_or_init(|| {
        Regex::new(r"(?i)connection refused|could(?:n't| not) connect|failed to connect|could(?:n't| not) resolve|failed to resolve|no route to host|network is unreachable|timed out|connection reset").unwrap()
    });
    let status = http
        .captures(text)
        .and_then(|m| m.get(1).or(m.get(2)))
        .and_then(|m| m.as_str().parse().ok());
    (status, connect.is_match(text))
}

/** Reads mpv's events on a thread of their own and forwards them to the page. */
pub fn spawn_events(app: AppHandle, handle: usize) {
    std::thread::spawn(move || {
        let handle = handle as *mut mpv_handle;
        loop {
            let event = unsafe { &*mpv_wait_event(handle, 1.0) };
            let player = match tauri::Manager::try_state::<Mpv>(&app) {
                Some(p) => p,
                None => continue,
            };
            let payload: Value = match event.event_id {
                MPV_EVENT_NONE => continue,
                MPV_EVENT_SHUTDOWN => break,
                MPV_EVENT_PROPERTY_CHANGE => unsafe {
                    let p = &*(event.data as *const mpv_event_property);
                    let name = CStr::from_ptr(p.name).to_string_lossy().into_owned();
                    let value = match p.format {
                        MPV_FORMAT_DOUBLE => json!(*(p.data as *const f64)),
                        MPV_FORMAT_FLAG => json!(*(p.data as *const i32) != 0),
                        MPV_FORMAT_INT64 => json!(*(p.data as *const i64)),
                        MPV_FORMAT_STRING => {
                            let s = CStr::from_ptr(*(p.data as *const *const c_char))
                                .to_string_lossy()
                                .into_owned();
                            if name == "track-list" {
                                tracks_without_paths(&s)
                            } else {
                                json!(s)
                            }
                        }
                        _ => Value::Null,
                    };
                    json!({ "t": "prop", "name": name, "value": value })
                },
                MPV_EVENT_START_FILE => {
                    *player.problem.lock().unwrap() = (None, false);
                    json!({ "t": "start" })
                }
                MPV_EVENT_FILE_LOADED => json!({ "t": "loaded" }),
                MPV_EVENT_PLAYBACK_RESTART => json!({ "t": "restart" }),
                MPV_EVENT_END_FILE => unsafe {
                    let e = &*(event.data as *const mpv_event_end_file);
                    let (status, connect) = *player.problem.lock().unwrap();
                    json!({
                        "t": "end",
                        // 0 end of file, 2 stopped or replaced, 3 quit, 4 error, 5 redirect.
                        "reason": e.reason,
                        "error": if e.error < 0 { err(e.error) } else { String::new() },
                        "httpStatus": status,
                        "cannotConnect": connect,
                    })
                },
                MPV_EVENT_LOG_MESSAGE => unsafe {
                    let m = &*(event.data as *const mpv_event_log_message);
                    let text = CStr::from_ptr(m.text).to_string_lossy();
                    let (status, connect) = classify(&text);
                    let mut problem = player.problem.lock().unwrap();
                    if status.is_some() {
                        problem.0 = status;
                    }
                    problem.1 |= connect;
                    continue;
                },
                _ => continue,
            };
            player.send(payload);
        }
    });
}

/** The track list without file names or URLs (an external subtitle's path could carry a login). */
fn tracks_without_paths(raw: &str) -> Value {
    let list: Vec<Value> = serde_json::from_str(raw).unwrap_or_default();
    Value::Array(
        list.into_iter()
            .map(|t| {
                json!({
                    "id": t.get("id"),
                    "type": t.get("type"),
                    "lang": t.get("lang"),
                    "title": t.get("title"),
                    "codec": t.get("codec"),
                    "channels": t.get("demux-channel-count"),
                    "selected": t.get("selected"),
                })
            })
            .collect(),
    )
}

#[tauri::command]
pub fn mpv_events(player: State<'_, Mpv>, channel: Channel<Value>) {
    *player.sink.lock().unwrap() = Some(channel);
}

/** Buffer profiles (Settings → Playback → Buffering), matching ExoPlayer's 3 / 6 / 12 s. */
fn buffer_options(buffer: &str) -> [(&'static str, &'static str); 4] {
    match buffer {
        "low" => [
            ("cache-pause-initial", "no"),
            ("cache-pause-wait", "0.5"),
            ("demuxer-readahead-secs", "3"),
            ("demuxer-max-bytes", "32MiB"),
        ],
        "stable" => [
            ("cache-pause-initial", "yes"),
            ("cache-pause-wait", "4"),
            ("demuxer-readahead-secs", "12"),
            ("demuxer-max-bytes", "150MiB"),
        ],
        _ => [
            ("cache-pause-initial", "no"),
            ("cache-pause-wait", "1.5"),
            ("demuxer-readahead-secs", "6"),
            ("demuxer-max-bytes", "64MiB"),
        ],
    }
}

#[tauri::command]
pub fn mpv_load(
    player: State<'_, Mpv>,
    url: String,
    start_at: Option<f64>,
    buffer: String,
    user_agent: Option<String>,
    referrer: Option<String>,
) -> Result<(), String> {
    for (k, v) in buffer_options(&buffer) {
        player.set(k, v)?;
    }
    player.set("user-agent", user_agent.as_deref().unwrap_or("Ultra IPTV"))?;
    player.set("referrer", referrer.as_deref().unwrap_or(""))?;
    player.set(
        "start",
        &start_at
            .filter(|s| *s > 0.0)
            .map(|s| format!("{s:.3}"))
            .unwrap_or_else(|| "none".into()),
    )?;
    player.set("pause", "no")?;
    player.command(&["loadfile", &url, "replace"])
}

#[tauri::command]
pub fn mpv_pause(player: State<'_, Mpv>, paused: bool) -> Result<(), String> {
    player.set("pause", if paused { "yes" } else { "no" })
}

#[tauri::command]
pub fn mpv_stop(player: State<'_, Mpv>) -> Result<(), String> {
    player.command(&["stop"])
}

#[tauri::command]
pub fn mpv_seek(player: State<'_, Mpv>, seconds: f64) -> Result<(), String> {
    player.command(&["seek", &format!("{seconds:.3}"), "absolute"])
}

#[tauri::command]
pub fn mpv_select(player: State<'_, Mpv>, kind: String, id: Option<String>) -> Result<(), String> {
    let prop = if kind == "audio" { "aid" } else { "sid" };
    player.set(
        prop,
        id.as_deref()
            .filter(|v| v.chars().all(|c| c.is_ascii_digit()) && !v.is_empty())
            .unwrap_or("no"),
    )
}

/** Where the picture goes: hidden, the whole page, or a box in CSS pixels (the Live preview). */
#[tauri::command]
pub fn mpv_set_rect(
    app: AppHandle,
    player: State<'_, Mpv>,
    mode: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    view::set_frame(
        &app,
        player.view(),
        (x, y, w, h),
        mode == "behind",
        mode == "hidden",
    )
}

#[cfg(test)]
mod tests {
    use super::classify;

    #[test]
    fn tells_http_errors_and_failed_connections_apart() {
        assert_eq!(classify("HTTP error 404 Not Found"), (Some(404), false));
        assert_eq!(
            classify("Server returned 403 Forbidden (access denied)"),
            (Some(403), false)
        );
        assert_eq!(
            classify("Connection to tcp://x:5999 failed: Connection refused"),
            (None, true)
        );
        assert_eq!(classify("Failed to open stream"), (None, false));
    }
}
