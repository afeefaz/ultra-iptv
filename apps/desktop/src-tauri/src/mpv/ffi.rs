//! The few libmpv functions the app uses (client.h), declared by hand.
#![allow(non_camel_case_types, dead_code)]

use std::os::raw::{c_char, c_double, c_int, c_void};

#[repr(C)]
pub struct mpv_handle {
    _private: [u8; 0],
}

pub const MPV_FORMAT_NONE: c_int = 0;
pub const MPV_FORMAT_STRING: c_int = 1;
pub const MPV_FORMAT_FLAG: c_int = 3;
pub const MPV_FORMAT_INT64: c_int = 4;
pub const MPV_FORMAT_DOUBLE: c_int = 5;

pub const MPV_EVENT_NONE: c_int = 0;
pub const MPV_EVENT_SHUTDOWN: c_int = 1;
pub const MPV_EVENT_LOG_MESSAGE: c_int = 2;
pub const MPV_EVENT_START_FILE: c_int = 6;
pub const MPV_EVENT_END_FILE: c_int = 7;
pub const MPV_EVENT_FILE_LOADED: c_int = 8;
pub const MPV_EVENT_PLAYBACK_RESTART: c_int = 21;
pub const MPV_EVENT_PROPERTY_CHANGE: c_int = 22;

#[repr(C)]
pub struct mpv_event {
    pub event_id: c_int,
    pub error: c_int,
    pub reply_userdata: u64,
    pub data: *mut c_void,
}

#[repr(C)]
pub struct mpv_event_property {
    pub name: *const c_char,
    pub format: c_int,
    pub data: *mut c_void,
}

#[repr(C)]
pub struct mpv_event_end_file {
    pub reason: c_int,
    pub error: c_int,
    pub playlist_entry_id: i64,
    pub playlist_insert_id: i64,
    pub playlist_insert_num_entries: c_int,
}

#[repr(C)]
pub struct mpv_event_start_file {
    pub playlist_entry_id: i64,
}

#[repr(C)]
pub struct mpv_event_log_message {
    pub prefix: *const c_char,
    pub level: *const c_char,
    pub text: *const c_char,
    pub log_level: c_int,
}

/**
 * The libmpv functions the app uses (client.h). Linked at build time on the Mac; on Windows,
 * resolved from libmpv-2.dll next to the app when it starts (there is no MSVC import library).
 */
macro_rules! mpv_api {
    ($(fn $name:ident($($arg:ident: $ty:ty),*) $(-> $ret:ty)?;)*) => {
        #[cfg(not(windows))]
        extern "C" {
            $(pub fn $name($($arg: $ty),*) $(-> $ret)?;)*
        }

        #[cfg(windows)]
        #[allow(non_snake_case)]
        struct Api {
            $($name: unsafe extern "C" fn($($ty),*) $(-> $ret)?,)*
        }

        #[cfg(windows)]
        static API: std::sync::OnceLock<Api> = std::sync::OnceLock::new();

        /** Finds libmpv-2.dll beside the app and its functions; an error says what is missing. */
        #[cfg(windows)]
        pub fn load() -> Result<(), String> {
            if API.get().is_some() {
                return Ok(());
            }
            let dir = std::env::current_exe().map_err(|e| e.to_string())?.parent().map(|p| p.to_path_buf()).unwrap_or_default();
            let lib = unsafe { libloading::Library::new(dir.join("libmpv-2.dll")) }.map_err(|e| format!("libmpv-2.dll: {e}"))?;
            let api = unsafe {
                Api {
                    $($name: *lib.get(concat!(stringify!($name), "\0").as_bytes()).map_err(|e| format!("{}: {e}", stringify!($name)))?,)*
                }
            };
            // Kept for the life of the app: the functions above point into it.
            std::mem::forget(lib);
            let _ = API.set(api);
            Ok(())
        }

        #[cfg(not(windows))]
        pub fn load() -> Result<(), String> {
            Ok(())
        }

        $(
            #[cfg(windows)]
            pub unsafe fn $name($($arg: $ty),*) $(-> $ret)? {
                (API.get().expect("libmpv not loaded").$name)($($arg),*)
            }
        )*
    };
}

mpv_api! {
    fn mpv_create() -> *mut mpv_handle;
    fn mpv_initialize(ctx: *mut mpv_handle) -> c_int;
    fn mpv_terminate_destroy(ctx: *mut mpv_handle);
    fn mpv_set_option_string(ctx: *mut mpv_handle, name: *const c_char, data: *const c_char) -> c_int;
    fn mpv_set_property_string(ctx: *mut mpv_handle, name: *const c_char, data: *const c_char) -> c_int;
    fn mpv_get_property_string(ctx: *mut mpv_handle, name: *const c_char) -> *mut c_char;
    fn mpv_free(data: *mut c_void);
    fn mpv_command(ctx: *mut mpv_handle, args: *mut *const c_char) -> c_int;
    fn mpv_command_async(ctx: *mut mpv_handle, reply_userdata: u64, args: *mut *const c_char) -> c_int;
    fn mpv_observe_property(ctx: *mut mpv_handle, reply_userdata: u64, name: *const c_char, format: c_int) -> c_int;
    fn mpv_request_log_messages(ctx: *mut mpv_handle, min_level: *const c_char) -> c_int;
    fn mpv_wait_event(ctx: *mut mpv_handle, timeout: c_double) -> *mut mpv_event;
    fn mpv_wakeup(ctx: *mut mpv_handle);
    fn mpv_error_string(error: c_int) -> *const c_char;
}

#[cfg(target_os = "macos")]
extern "C" {
    // native/mpv_view.m
    pub fn ump_view_create(ns_window: *mut c_void, mpv: *mut mpv_handle) -> *mut c_void;
    pub fn ump_view_set_frame(
        view: *mut c_void,
        x: f64,
        y: f64,
        w: f64,
        h: f64,
        fill: c_int,
        hidden: c_int,
    );
    pub fn ump_view_destroy(view: *mut c_void);
    pub fn ump_window_number(ns_window: *mut c_void) -> std::os::raw::c_long;
}
