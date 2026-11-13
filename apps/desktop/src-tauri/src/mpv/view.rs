//! Where the picture is drawn, under the window's transparent page:
//! - macOS: a layer-backed view drawn by libmpv's render API (native/mpv_view.m), added after mpv starts.
//! - Windows: mpv draws into the app's window itself (its `wid` option, Direct3D 11), under
//!   WebView2, and the picture is placed with its video margins.
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
    use crate::mpv::{ffi, Mpv};
    use tauri::Manager;

    /**
     * mpv draws into the app's own window: it makes its surface there, under WebView2 (a child
     * window of ours was never drawn, the transparent window has no surface for it). The picture
     * is placed with mpv's video margins, as fractions of the window.
     */
    pub fn prepare(window: &WebviewWindow) -> Result<Prepared, String> {
        Ok(Prepared {
            hwnd: window.hwnd().map_err(|e| e.to_string())?.0 as isize,
        })
    }

    pub fn attach(
        _window: &WebviewWindow,
        prepared: Prepared,
        _mpv: *mut ffi::mpv_handle,
    ) -> Result<View, String> {
        Ok(View(prepared.hwnd as usize))
    }

    pub fn set_frame(
        app: &AppHandle,
        _view: View,
        rect: (f64, f64, f64, f64),
        fill: bool,
        hidden: bool,
    ) -> Result<(), String> {
        let window = app.get_webview_window("main").ok_or("no main window")?;
        let player = app.state::<Mpv>();
        // The page's size in CSS pixels: the rect comes in the same units.
        let scale = window.scale_factor().unwrap_or(1.0);
        let size = window.inner_size().map_err(|e| e.to_string())?;
        let (w, h) = (
            (size.width as f64 / scale).max(1.0),
            (size.height as f64 / scale).max(1.0),
        );
        let (left, top, right, bottom) = if hidden {
            // Nothing visible: all the picture squeezed out.
            (0.5, 0.5, 0.5, 0.5)
        } else if fill {
            (0.0, 0.0, 0.0, 0.0)
        } else {
            let clamp = |v: f64| v.clamp(0.0, 1.0);
            (
                clamp(rect.0 / w),
                clamp(rect.1 / h),
                clamp((w - rect.0 - rect.2) / w),
                clamp((h - rect.1 - rect.3) / h),
            )
        };
        for (name, value) in [
            ("video-margin-ratio-left", left),
            ("video-margin-ratio-top", top),
            ("video-margin-ratio-right", right),
            ("video-margin-ratio-bottom", bottom),
        ] {
            player.set(name, &format!("{value:.5}"))?;
        }
        Ok(())
    }

    /** Margins are fractions of the window, and the page sends a new rect when it resizes. */
    pub fn window_resized(_window: &WebviewWindow, _view: View) {}
}

pub use imp::{attach, prepare, set_frame, window_resized};
