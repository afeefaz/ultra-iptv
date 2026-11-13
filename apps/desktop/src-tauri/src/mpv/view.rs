//! Where the picture is drawn, under the window's transparent page:
//! - macOS: a layer-backed view drawn by libmpv's render API (native/mpv_view.m), added after mpv starts.
//! - Windows: a child window mpv draws into itself (its `wid` option, Direct3D 11), made before mpv
//!   starts and kept at the bottom of the window's children, under WebView2.
//!
//! Rects come in CSS pixels from the page's top left; `fill` follows the window's size.
use tauri::{AppHandle, WebviewWindow};

/** What mpv needs before it starts: on Windows, the window to draw into. */
pub struct Prepared {
    #[cfg(windows)]
    hwnd: isize,
}

impl Prepared {
    /** The `wid` option for mpv, where it draws into a window of ours. */
    pub fn wid(&self) -> Option<i64> {
        #[cfg(windows)]
        return Some(self.hwnd as i64);
        #[cfg(not(windows))]
        return None;
    }
}

/** A view, as a plain number so it can cross threads (only the main thread touches it). */
#[derive(Clone, Copy, Default)]
pub struct View(usize);

#[cfg(target_os = "macos")]
mod imp {
    use super::*;
    use crate::mpv::ffi;

    pub fn prepare(_window: &WebviewWindow) -> Result<Prepared, String> {
        Ok(Prepared {})
    }

    pub fn attach(
        window: &WebviewWindow,
        _prepared: Prepared,
        mpv: *mut ffi::mpv_handle,
    ) -> Result<View, String> {
        let ns_window = window.ns_window().map_err(|e| e.to_string())?;
        Ok(View(
            unsafe { ffi::ump_view_create(ns_window, mpv) } as usize
        ))
    }

    pub fn set_frame(
        app: &AppHandle,
        view: View,
        rect: (f64, f64, f64, f64),
        fill: bool,
        hidden: bool,
    ) -> Result<(), String> {
        app.run_on_main_thread(move || unsafe {
            ffi::ump_view_set_frame(
                view.0 as *mut _,
                rect.0,
                rect.1,
                rect.2,
                rect.3,
                fill as i32,
                hidden as i32,
            );
        })
        .map_err(|e| e.to_string())
    }

    /** The view follows the window by itself (autoresizing). */
    pub fn window_resized(_window: &WebviewWindow, _view: View) {}
}

#[cfg(windows)]
mod imp {
    use super::*;
    use crate::mpv::ffi;
    use std::sync::Mutex;
    use windows_sys::Win32::Foundation::{HWND, RECT};
    use windows_sys::Win32::Graphics::Gdi::{GetStockObject, BLACK_BRUSH, HBRUSH};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, GetClientRect, RegisterClassW, SetWindowPos, ShowWindow,
        HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SW_HIDE, SW_SHOWNOACTIVATE, WNDCLASSW,
        WS_CHILD, WS_CLIPSIBLINGS, WS_DISABLED,
    };

    /** Whether the picture fills the window, so a resize keeps it filling it. */
    static FILLING: Mutex<bool> = Mutex::new(false);

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    pub fn prepare(window: &WebviewWindow) -> Result<Prepared, String> {
        let parent = window.hwnd().map_err(|e| e.to_string())?.0 as HWND;
        let class = wide("UltraIptvVideo");
        unsafe {
            let instance = GetModuleHandleW(std::ptr::null());
            let wc = WNDCLASSW {
                style: 0,
                lpfnWndProc: Some(DefWindowProcW),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: instance,
                hIcon: std::ptr::null_mut(),
                hCursor: std::ptr::null_mut(),
                hbrBackground: GetStockObject(BLACK_BRUSH) as HBRUSH,
                lpszMenuName: std::ptr::null(),
                lpszClassName: class.as_ptr(),
            };
            RegisterClassW(&wc);
            // Disabled: clicks and keys go to the page above it, never to the video.
            let hwnd = CreateWindowExW(
                0,
                class.as_ptr(),
                std::ptr::null(),
                WS_CHILD | WS_CLIPSIBLINGS | WS_DISABLED,
                0,
                0,
                16,
                16,
                parent,
                std::ptr::null_mut(),
                instance,
                std::ptr::null(),
            );
            if hwnd.is_null() {
                return Err("the video window could not be made".into());
            }
            SetWindowPos(
                hwnd,
                HWND_BOTTOM,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
            Ok(Prepared {
                hwnd: hwnd as isize,
            })
        }
    }

    pub fn attach(
        _window: &WebviewWindow,
        prepared: Prepared,
        _mpv: *mut ffi::mpv_handle,
    ) -> Result<View, String> {
        Ok(View(prepared.hwnd as usize))
    }

    fn place(parent: HWND, hwnd: HWND, rect: (i32, i32, i32, i32)) {
        let _ = parent;
        unsafe {
            SetWindowPos(
                hwnd,
                HWND_BOTTOM,
                rect.0,
                rect.1,
                rect.2.max(1),
                rect.3.max(1),
                SWP_NOACTIVATE,
            );
        }
    }

    fn client(parent: HWND) -> (i32, i32, i32, i32) {
        let mut r = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        unsafe { GetClientRect(parent, &mut r) };
        (0, 0, r.right - r.left, r.bottom - r.top)
    }

    pub fn set_frame(
        app: &AppHandle,
        view: View,
        rect: (f64, f64, f64, f64),
        fill: bool,
        hidden: bool,
    ) -> Result<(), String> {
        use tauri::Manager;
        let window = app.get_webview_window("main").ok_or("no main window")?;
        let parent = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        // CSS pixels to the window's physical pixels.
        let scale = window.scale_factor().unwrap_or(1.0);
        let px = |v: f64| (v * scale).round() as i32;
        let physical = (px(rect.0), px(rect.1), px(rect.2), px(rect.3));
        *FILLING.lock().unwrap() = fill && !hidden;
        app.run_on_main_thread(move || unsafe {
            let (parent, hwnd) = (parent as HWND, view.0 as HWND);
            if hidden {
                ShowWindow(hwnd, SW_HIDE);
                return;
            }
            place(parent, hwnd, if fill { client(parent) } else { physical });
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        })
        .map_err(|e| e.to_string())
    }

    /** Full-screen video follows the window when it is resized. */
    pub fn window_resized(window: &WebviewWindow, view: View) {
        if !*FILLING.lock().unwrap() {
            return;
        }
        if let Ok(parent) = window.hwnd() {
            let parent = parent.0 as HWND;
            place(parent, view.0 as HWND, client(parent));
        }
    }
}

pub use imp::{attach, prepare, set_frame, window_resized};
