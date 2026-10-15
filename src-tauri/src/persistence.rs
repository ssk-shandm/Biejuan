use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::Mutex;

pub static DATA_LOCK: Mutex<()> = Mutex::new(());

fn replace(source: &Path, target: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        let from: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let to: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        // Both buffers are null terminated and remain live for the call.
        if unsafe {
            MoveFileExW(
                from.as_ptr(),
                to.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            return Err(std::io::Error::last_os_error());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    fs::rename(source, target)
}

fn commit(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid storage path")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temporary = path.with_file_name(format!(
        "{}.pending",
        path.file_name().unwrap().to_string_lossy()
    ));
    let result = (|| -> std::io::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        replace(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|e| format!("保存失败，原文件保留：{e}"))
}

/// Call under DATA_LOCK. The old file is never removed before replacement succeeds.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    match fs::read(path) {
        Ok(old) => commit(
            &path.with_file_name(format!(
                "{}.bak",
                path.file_name().unwrap().to_string_lossy()
            )),
            &old,
        )?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
        Err(e) => return Err(format!("无法读取原文件，已停止保存：{e}")),
    }
    commit(path, bytes)
}

/// Credentials must not leave a historical plaintext key in a rotating backup.
pub fn atomic_write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let backup = path.with_file_name(format!(
        "{}.bak",
        path.file_name().unwrap().to_string_lossy()
    ));
    match fs::remove_file(backup) {
        Ok(()) => (),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
        Err(error) => return Err(format!("无法清理旧凭据副本，已停止保存：{error}")),
    }
    commit(path, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replacement_keeps_previous_snapshot_and_failure_keeps_original() {
        let root = std::env::temp_dir().join(format!("exam-atomic-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("state.json");
        atomic_write(&path, b"old").unwrap();
        atomic_write(&path, b"new").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"new");
        assert_eq!(
            fs::read(path.with_file_name(format!(
                "{}.bak",
                path.file_name().unwrap().to_string_lossy()
            )))
            .unwrap(),
            b"old"
        );
        fs::create_dir(path.with_file_name(format!(
            "{}.pending",
            path.file_name().unwrap().to_string_lossy()
        )))
        .unwrap();
        assert!(atomic_write(&path, b"broken").is_err());
        assert_eq!(fs::read(&path).unwrap(), b"new");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn private_writes_do_not_keep_old_credentials_after_clear() {
        let root = std::env::temp_dir().join(format!("exam-private-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("llm-config.txt");
        fs::write(&path, b"old secret").unwrap();
        fs::write(root.join("llm-config.txt.bak"), b"older secret").unwrap();
        atomic_write_private(&path, b"cleared").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"cleared");
        assert!(!root.join("llm-config.txt.bak").exists());
        assert!(!root.join("llm-config.txt.pending").exists());
        fs::remove_dir_all(root).unwrap();
    }
}
