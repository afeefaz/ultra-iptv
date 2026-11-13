//! Ultra IPTV for macOS and Windows: the shared web app in a Tauri window, with native networking, files and
//! an mpv video player underneath the page (docs/spec.md §3).
mod files;
mod http;
mod mpv;
mod power;
mod system;
#[cfg(debug_assertions)]
mod testing;
mod updater;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let window = app.get_webview_window("main").ok_or("no main window")?;
            let prepared = mpv::view::prepare(&window)?;
            let player = mpv::Mpv::new(prepared.wid())?;
            let handle = player_handle(&player);
            let view = mpv::view::attach(&window, prepared, handle as *mut _)?;
            player.attach_view(view);
            app.manage(player);
            let resized = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::Resized(_) = event {
                    if let Some(player) = resized.try_state::<mpv::Mpv>() {
                        mpv::view::window_resized(&resized, player.view());
                    }
                }
            });
            mpv::spawn_events(app.handle().clone(), handle);
            #[cfg(debug_assertions)]
            testing::start(window.clone());
            Ok(())
        })
        .invoke_handler(handlers())
        .run(tauri::generate_context!())
        .expect("error while running the app");
}

fn handlers() -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    macro_rules! commands {
        ($($extra:path),*) => {
            tauri::generate_handler![
            http::http_get,
            files::files_write,
            files::files_append,
            files::files_read_slice,
            files::files_read,
            files::files_remove_dir,
            files::files_free_bytes,
            system::app_info,
            system::system_usage,
            system::measure_download,
            system::cancel_download,
            system::export_text,
            system::secret_key,
            system::set_fullscreen,
            system::is_fullscreen,
            mpv::mpv_events,
            mpv::mpv_load,
            mpv::mpv_pause,
            mpv::mpv_stop,
            mpv::mpv_seek,
            mpv::mpv_select,
            mpv::mpv_set_rect,
            power::keep_awake,
            updater::update_info,
            updater::update_install,
            $($extra),*
            ]
        };
    }
    #[cfg(debug_assertions)]
    return commands!(testing::test_report, testing::test_shot);
    #[cfg(not(debug_assertions))]
    return commands!();
}

fn player_handle(player: &mpv::Mpv) -> usize {
    player.raw_handle() as usize
}
