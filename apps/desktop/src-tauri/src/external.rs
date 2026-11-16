//! "Open in another player": hands what's playing to a player installed on this computer (VLC
//! first), as Android's "Open with" does. The address carries the login, so it is only ever passed
//! to that player as one argument: never logged, never through a shell.
use std::path::PathBuf;
use std::process::Command;

/** A player found on this computer. */
struct Player {
    name: &'static str,
    path: PathBuf,
}

/** Players this app knows how to start, in order of preference, that are installed here. */
fn installed() -> Vec<Player> {
    let mut found = Vec::new();
    for (name, path) in candidates() {
        if path.exists() {
            found.push(Player { name, path });
        }
    }
    found
}

#[cfg(target_os = "macos")]
fn candidates() -> Vec<(&'static str, PathBuf)> {
    let mut dirs = vec![PathBuf::from("/Applications")];
    if let Some(home) = std::env::var_os("HOME") {
        dirs.push(PathBuf::from(home).join("Applications"));
    }
    let mut list = Vec::new();
    for (name, bundle) in [("VLC", "VLC.app"), ("IINA", "IINA.app"), ("mpv", "mpv.app")] {
        for dir in &dirs {
            list.push((name, dir.join(bundle)));
        }
    }
    list
}

#[cfg(windows)]
fn candidates() -> Vec<(&'static str, PathBuf)> {
    let roots: Vec<PathBuf> = ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"]
        .iter()
        .filter_map(|v| std::env::var_os(v).map(PathBuf::from))
        .collect();
    let mut list = Vec::new();
    for (name, file) in [
        ("VLC", r"VideoLAN\VLC\vlc.exe"),
        ("PotPlayer", r"DAUM\PotPlayer\PotPlayerMini64.exe"),
        ("PotPlayer", r"DAUM\PotPlayer\PotPlayerMini.exe"),
        ("MPC-HC", r"MPC-HC\mpc-hc64.exe"),
        ("MPC-HC", r"MPC-HC\mpc-hc.exe"),
    ] {
        for root in &roots {
            list.push((name, root.join(file)));
        }
    }
    list
}

#[cfg(not(any(target_os = "macos", windows)))]
fn candidates() -> Vec<(&'static str, PathBuf)> {
    Vec::new()
}

/** Only stream addresses, so nothing that looks like an option or a file reaches the player. */
fn is_stream_address(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    ["http://", "https://", "rtmp://", "rtsp://"]
        .iter()
        .any(|scheme| lower.starts_with(scheme))
        && !url.chars().any(|c| c.is_control())
}

fn launch(player: &Player, url: &str, title: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let _ = title;
        Command::new("open")
            .arg("-a")
            .arg(&player.path)
            .arg(url)
            .spawn()
            .map(|_| ())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let mut cmd = Command::new(&player.path);
        // VLC shows this instead of the address (which has the login in it).
        if player.name == "VLC" && !title.is_empty() {
            cmd.arg(format!("--meta-title={title}"));
        }
        cmd.arg(url).spawn().map(|_| ())
    }
}

/** Opens the stream in the first installed player; returns its name, or "none" if there is none. */
#[tauri::command]
pub fn open_external(url: String, title: String) -> Result<String, String> {
    if !is_stream_address(&url) {
        return Err("not a stream address".into());
    }
    let player = installed().into_iter().next().ok_or("none")?;
    launch(&player, &url, &title)
        .map_err(|e| format!("could not start {}: {:?}", player.name, e.kind()))?;
    Ok(player.name.into())
}

#[cfg(test)]
mod tests {
    use super::is_stream_address;

    #[test]
    fn only_passes_stream_addresses() {
        assert!(is_stream_address("http://host.test/live/a/b/1.ts"));
        assert!(is_stream_address("HTTPS://host.test/x.m3u8"));
        assert!(!is_stream_address("--extraintf=http"));
        assert!(!is_stream_address("file:///etc/passwd"));
        assert!(!is_stream_address("http://host.test/\nx"));
    }
}
