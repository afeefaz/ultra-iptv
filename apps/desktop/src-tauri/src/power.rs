//! Keeps the display awake while a video plays (Android's keepScreenOn): an IOKit power assertion
//! on the Mac, the thread's execution state on Windows.

/** Always on the main thread: on Windows the state belongs to the thread that sets it. */
#[tauri::command]
pub fn keep_awake(app: tauri::AppHandle, on: bool) {
    let _ = app.run_on_main_thread(move || imp::keep_awake(on));
}

#[cfg(target_os = "macos")]
mod imp {
    use std::ffi::{c_void, CString};
    use std::sync::Mutex;

    type CFStringRef = *const c_void;

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOPMAssertionCreateWithName(
            kind: CFStringRef,
            level: u32,
            name: CFStringRef,
            id: *mut u32,
        ) -> i32;
        fn IOPMAssertionRelease(id: u32) -> i32;
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithCString(
            alloc: *const c_void,
            s: *const std::os::raw::c_char,
            encoding: u32,
        ) -> CFStringRef;
        fn CFRelease(cf: *const c_void);
    }

    const UTF8: u32 = 0x0800_0100;
    const LEVEL_ON: u32 = 255;

    static ASSERTION: Mutex<Option<u32>> = Mutex::new(None);

    fn cf(s: &str) -> CFStringRef {
        let c = CString::new(s).unwrap();
        unsafe { CFStringCreateWithCString(std::ptr::null(), c.as_ptr(), UTF8) }
    }

    pub fn keep_awake(on: bool) {
        let mut held = ASSERTION.lock().unwrap();
        match (on, *held) {
            (true, None) => {
                let (kind, name) = (
                    cf("NoDisplaySleepAssertion"),
                    cf("Ultra IPTV is playing a video"),
                );
                let mut id = 0u32;
                if unsafe { IOPMAssertionCreateWithName(kind, LEVEL_ON, name, &mut id) } == 0 {
                    *held = Some(id);
                }
                unsafe {
                    CFRelease(kind);
                    CFRelease(name);
                }
            }
            (false, Some(id)) => {
                unsafe { IOPMAssertionRelease(id) };
                *held = None;
            }
            _ => {}
        }
    }
}

#[cfg(windows)]
mod imp {
    use windows_sys::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    };

    pub fn keep_awake(on: bool) {
        let flags = if on {
            ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED
        } else {
            ES_CONTINUOUS
        };
        unsafe { SetThreadExecutionState(flags) };
    }
}
