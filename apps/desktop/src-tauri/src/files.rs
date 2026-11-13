//! The catalogue's files for Fast loading (packages/core/src/catalog/fileStore.ts), in the app's data
//! folder: the operations Samsung's file API gives the TV build (see sliceLikeTv in core/catalog/files.ts).
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("catalog"))
}

/** A relative path of plain names only, so nothing can reach outside the catalogue folder. */
pub fn safe_join(root: &Path, path: &str) -> Result<PathBuf, String> {
    if path.is_empty() {
        return Err("Bad catalogue path".into());
    }
    let mut out = root.to_path_buf();
    for part in path.split('/') {
        let ok = !part.is_empty()
            && part != "."
            && part != ".."
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || "_.-|~".contains(c));
        if !ok {
            return Err(format!("Bad catalogue path: {path}"));
        }
        out.push(part);
    }
    Ok(out)
}

fn write_text(file: &Path, text: &str, append: bool) -> Result<(), String> {
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut f = OpenOptions::new()
        .create(true)
        .write(true)
        .append(append)
        .truncate(!append)
        .open(file)
        .map_err(|e| e.to_string())?;
    f.write_all(text.as_bytes()).map_err(|e| e.to_string())
}

/** `count` code points starting `offset` UTF-8 bytes into the file. */
pub fn read_slice_at(file: &Path, offset: u64, count: usize) -> Result<Option<String>, String> {
    if !file.is_file() {
        return Ok(None);
    }
    let mut f = File::open(file).map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut out = String::new();
    let mut points = 0usize;
    let mut pending: Vec<u8> = Vec::new();
    let mut buf = vec![0u8; 64 * 1024];
    while points < count {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        pending.extend_from_slice(&buf[..n]);
        // Decode what is complete; an unfinished multibyte character waits for the next read.
        let valid = match std::str::from_utf8(&pending) {
            Ok(s) => s.len(),
            Err(e) if e.error_len().is_none() => e.valid_up_to(),
            Err(e) => e.valid_up_to() + e.error_len().unwrap_or(1),
        };
        let text = String::from_utf8_lossy(&pending[..valid]).into_owned();
        for ch in text.chars() {
            if points == count {
                break;
            }
            out.push(ch);
            points += 1;
        }
        pending.drain(..valid);
    }
    Ok(Some(out))
}

#[tauri::command]
pub fn files_write(app: AppHandle, path: String, text: String) -> Result<(), String> {
    write_text(&safe_join(&root(&app)?, &path)?, &text, false)
}

#[tauri::command]
pub fn files_append(app: AppHandle, path: String, text: String, start: bool) -> Result<(), String> {
    write_text(&safe_join(&root(&app)?, &path)?, &text, !start)
}

#[tauri::command]
pub fn files_read_slice(
    app: AppHandle,
    path: String,
    offset: u64,
    count: u64,
) -> Result<Option<String>, String> {
    read_slice_at(&safe_join(&root(&app)?, &path)?, offset, count as usize)
}

#[tauri::command]
pub fn files_read(app: AppHandle, path: String) -> Result<Option<String>, String> {
    let file = safe_join(&root(&app)?, &path)?;
    if !file.is_file() {
        return Ok(None);
    }
    fs::read_to_string(file)
        .map(Some)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn files_remove_dir(app: AppHandle, path: String) -> Result<(), String> {
    let dir = safe_join(&root(&app)?, &path)?;
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn files_free_bytes(app: AppHandle) -> Option<u64> {
    let dir = app.path().app_data_dir().ok()?;
    fs::create_dir_all(&dir).ok()?;
    free_space(&dir)
}

#[cfg(unix)]
fn free_space(dir: &Path) -> Option<u64> {
    let c = std::ffi::CString::new(dir.to_string_lossy().as_bytes()).ok()?;
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::statvfs(c.as_ptr(), &mut st) } != 0 {
        return None;
    }
    Some(st.f_bavail as u64 * st.f_frsize as u64)
}

#[cfg(windows)]
fn free_space(dir: &Path) -> Option<u64> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    let wide: Vec<u16> = dir
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut free = 0u64;
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut free,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        None
    } else {
        Some(free)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str, text: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ultra-files-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join(name);
        fs::write(&file, text).unwrap();
        file
    }

    #[test]
    fn reads_code_points_from_a_byte_offset() {
        let text = "ab[{\"n\":\"قناة 😀\"}]zz";
        let file = temp("slice.json", text);
        let start = text.find('[').unwrap() as u64;
        let want: String = text[start as usize..].chars().take(16).collect();
        assert_eq!(read_slice_at(&file, start, 16).unwrap().unwrap(), want);
        assert_eq!(want, "[{\"n\":\"قناة 😀\"}]");
    }

    #[test]
    fn stops_at_the_end_and_misses_missing_files() {
        let file = temp("end.json", "héllo");
        assert_eq!(read_slice_at(&file, 1, 99).unwrap().unwrap(), "éllo");
        assert_eq!(read_slice_at(&file, 6, 5).unwrap().unwrap(), "");
        assert_eq!(
            read_slice_at(&file.with_extension("none"), 0, 5).unwrap(),
            None
        );
    }

    #[test]
    fn keeps_paths_inside_the_folder() {
        let root = Path::new("/tmp/x");
        assert!(safe_join(root, "pl_1/live-ab/data.json").is_ok());
        for bad in ["", "../a", "a//b", "/abs", "a/./b", "a b", "a\\b"] {
            assert!(safe_join(root, bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn reads_across_chunk_boundaries() {
        let text: String = "ع".repeat(70_000);
        let file = temp("big.json", &text);
        let got = read_slice_at(&file, 2, 50_000).unwrap().unwrap();
        assert_eq!(got.chars().count(), 50_000);
        assert!(got.chars().all(|c| c == 'ع'));
    }
}
