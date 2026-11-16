//! Test builds only (the `windows-diagnostics` branch): mpv's detailed log in a file in Downloads,
//! for a computer we can't reach. mpv's lines carry stream addresses with the login in them, so
//! every address and IP number is replaced before a line is written.
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

const MAX_BYTES: u64 = 20 * 1024 * 1024;

static FILE: Mutex<Option<(File, u64)>> = Mutex::new(None);

fn downloads() -> Option<PathBuf> {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })?;
    Some(PathBuf::from(home).join("Downloads"))
}

/** Starts the file; returns where it is. */
pub fn open() -> Option<PathBuf> {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let path = downloads()?.join(format!("ultra-iptv-player-log-{stamp}.txt"));
    let mut file = File::create(&path).ok()?;
    let head = format!(
        "Ultra IPTV {} player log ({} {}). Addresses and IP numbers are replaced with ***.\n",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    let _ = file.write_all(head.as_bytes());
    *FILE.lock().unwrap() = Some((file, head.len() as u64));
    Some(path)
}

pub fn is_open() -> bool {
    FILE.lock().unwrap().is_some()
}

/** One line from mpv, without addresses. */
pub fn write(level: &str, prefix: &str, text: &str) {
    let mut guard = FILE.lock().unwrap();
    let Some((file, size)) = guard.as_mut() else {
        return;
    };
    if *size > MAX_BYTES {
        return;
    }
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() % 86_400_000)
        .unwrap_or(0);
    let line = format!(
        "{:02}:{:02}:{:02}.{:03} {level:<5} [{prefix}] {}\n",
        ms / 3_600_000,
        ms / 60_000 % 60,
        ms / 1000 % 60,
        ms % 1000,
        redact(text.trim_end())
    );
    if file.write_all(line.as_bytes()).is_ok() {
        *size += line.len() as u64;
        let _ = file.flush();
    }
}

/// Every `scheme://...` up to a space or quote becomes `scheme://` and three stars, and every
/// IPv4 number three stars.
pub fn redact(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find("://") {
        out.push_str(&rest[..at]);
        out.push_str("://***");
        let after = &rest[at + 3..];
        let end = after
            .find(|c: char| c.is_whitespace() || c == '\'' || c == '"' || c == '>' || c == ')')
            .unwrap_or(after.len());
        rest = &after[end..];
    }
    out.push_str(rest);
    redact_ipv4(&out)
}

fn redact_ipv4(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_ascii_digit() && (i == 0 || !chars[i - 1].is_alphanumeric()) {
            // Four groups of one to three digits separated by dots.
            let mut j = i;
            let mut groups = 0;
            loop {
                let from = j;
                while j < chars.len() && chars[j].is_ascii_digit() && j - from < 3 {
                    j += 1;
                }
                if j == from {
                    break;
                }
                groups += 1;
                if groups == 4 || j >= chars.len() || chars[j] != '.' {
                    break;
                }
                j += 1;
            }
            if groups == 4 && (j >= chars.len() || !chars[j].is_alphanumeric()) {
                out.push_str("***");
                i = j;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::redact;

    #[test]
    fn hides_addresses_and_ip_numbers() {
        let line = "Opening 'http://host.test:8080/live/user/secret/1.ts' failed, 10.1.2.3 port 80";
        let r = redact(line);
        assert!(!r.contains("secret") && !r.contains("host.test") && !r.contains("10.1.2.3"));
        assert_eq!(r, "Opening 'http://***' failed, *** port 80");
        assert_eq!(
            redact("Selected adapter: AMD Radeon RX 9070 XT"),
            "Selected adapter: AMD Radeon RX 9070 XT"
        );
        assert_eq!(redact("mpv 0.42.0 Copyright"), "mpv 0.42.0 Copyright");
        assert_eq!(redact("قناة 192.168.1.5:80 تعمل"), "قناة ***:80 تعمل");
    }
}
