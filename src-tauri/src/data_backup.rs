use crate::{
    development_content_root,
    persistence::{atomic_write, DATA_LOCK},
    user_content_root,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};
use tauri::Manager as _;

const MAX_BYTES: usize = 256 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone)]
pub struct DataFile {
    pub path: String,
    pub data: String,
}

fn app_document(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    if !["quiz-data.json", "learning-state.json"].contains(&name) {
        return Err("不支持的数据文件".into());
    }
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(name))
}

/// Defensive compatibility for files in alternate application-data roots.
/// Only fall back when the canonical file is absent; preserve the source.
fn app_document_candidates(app: &tauri::AppHandle, name: &str) -> Result<Vec<PathBuf>, String> {
    if !["quiz-data.json", "learning-state.json"].contains(&name) {
        return Err("不支持的数据文件".into());
    }
    let mut paths = vec![app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(name)];
    for root in [app.path().app_local_data_dir(), app.path().app_config_dir()] {
        let path = root.map_err(|e| e.to_string())?.join(name);
        if !paths.contains(&path) {
            paths.push(path);
        }
    }
    Ok(paths)
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpgradeManifest {
    app_version: String,
    documents: Vec<String>,
    browser: String,
}

fn prepare_upgrade_snapshot(
    root: &Path,
    version: &str,
    documents: &[(String, Vec<u8>)],
    browser_values: &str,
) -> Result<PathBuf, String> {
    let destination = root.join("upgrade-backups").join(version);
    let manifest = destination.join("complete.json");
    if manifest.is_file() {
        let completed: UpgradeManifest =
            serde_json::from_slice(&fs::read(&manifest).map_err(|e| e.to_string())?)
                .map_err(|e| format!("升级保护清单无法读取：{e}"))?;
        if completed.app_version != version
            || completed.browser != "browser-learning.json"
            || completed.documents.iter().any(|name| {
                !["root-0-", "root-1-", "root-2-"].iter().any(|prefix| {
                    name.strip_prefix(prefix).is_some_and(|suffix| {
                        [
                            "quiz-data.json",
                            "quiz-data.json.bak",
                            "learning-state.json",
                            "learning-state.json.bak",
                        ]
                        .contains(&suffix)
                    })
                }) || !destination.join(name).is_file()
            })
            || !destination.join(&completed.browser).is_file()
        {
            return Err("升级保护副本不完整，已停止启动，请保留现有数据和保护目录".into());
        }
        return Ok(destination);
    }
    fs::create_dir_all(&destination).map_err(|e| e.to_string())?;
    // A previous interrupted attempt is kept, never overwritten. A retry is
    // allowed only while it still describes exactly the same originals.
    let preserve = |name: &str, data: &[u8]| -> Result<(), String> {
        let target = destination.join(name);
        match fs::read(&target) {
            Ok(existing) if existing == data => Ok(()),
            Ok(_) => Err("升级保护副本与当前数据不同，已停止启动，原件均保留".into()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => atomic_write(&target, data),
            Err(e) => Err(e.to_string()),
        }
    };
    for (name, data) in documents {
        preserve(name, data)?;
    }
    preserve("browser-learning.json", browser_values.as_bytes())?;
    atomic_write(
        &manifest,
        &serde_json::to_vec(&UpgradeManifest {
            app_version: version.into(),
            documents: documents.iter().map(|(name, _)| name.clone()).collect(),
            browser: "browser-learning.json".into(),
        })
        .map_err(|e| e.to_string())?,
    )?;
    Ok(destination)
}

/// Runs before frontend migrations or snapshot hydration. Upgrade copies never
/// rotate with ordinary saves and contain no LLM config or API credentials.
#[tauri::command]
pub fn prepare_learning_upgrade(
    app: tauri::AppHandle,
    browser_values: String,
) -> Result<String, String> {
    let _guard = DATA_LOCK.lock().map_err(|e| e.to_string())?;
    if browser_values.len() > MAX_BYTES {
        return Err("升级保护数据过大".into());
    }
    let values: serde_json::Value =
        serde_json::from_str(&browser_values).map_err(|e| e.to_string())?;
    let values = values.as_object().ok_or("升级保护数据必须是对象")?;
    if values.iter().any(|(key, value)| {
        !value.is_string()
            || ![
                "wrongNotebookData_v2",
                "wrongNotebookData_v2.previous",
                "wrongNotebookData_v2.damaged",
                "wrongQuestionsDB",
                "wrongEntriesDB",
                "wrongNotebooksDB",
                "guessedRightDB",
                "activeWrongNotebook",
                "exam-data-version",
                "lastBank",
            ]
            .contains(&key.as_str())
    }) {
        return Err("升级保护包含不支持的字段".into());
    }
    let mut documents = Vec::new();
    for name in ["quiz-data.json", "learning-state.json"] {
        for (index, candidate) in app_document_candidates(&app, name)?.iter().enumerate() {
            for suffix in ["", ".bak"] {
                let path = candidate.with_file_name(format!("{name}{suffix}"));
                match fs::read(path) {
                    Ok(bytes) => documents.push((format!("root-{index}-{name}{suffix}"), bytes)),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                    Err(e) => return Err(format!("升级前原数据无法读取，已停止启动：{e}")),
                }
            }
        }
    }
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let snapshot = prepare_upgrade_snapshot(
        &root,
        &app.package_info().version.to_string(),
        &documents,
        &browser_values,
    )?;
    Ok(snapshot.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn read_app_document(
    app: tauri::AppHandle,
    name: String,
    previous: Option<bool>,
) -> Result<Option<String>, String> {
    let _guard = DATA_LOCK.lock().map_err(|e| e.to_string())?;
    let candidates = app_document_candidates(&app, &name)?;
    read_document_candidates(&candidates, previous.unwrap_or(false))
}

fn read_document_candidates(
    candidates: &[PathBuf],
    previous: bool,
) -> Result<Option<String>, String> {
    let primary = candidates[0].clone();
    for candidate in candidates {
        let path = if previous {
            candidate.with_file_name(format!(
                "{}.bak",
                candidate.file_name().unwrap().to_string_lossy()
            ))
        } else {
            candidate.clone()
        };
        match fs::read_to_string(&path) {
            Ok(text) => {
                // Preserve the old file in the canonical location before the
                // frontend can initialize or write a new v0.2 snapshot.
                if !previous && path != primary && !primary.exists() {
                    if let Some(parent) = primary.parent() {
                        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                    }
                    atomic_write(&primary, text.as_bytes())?;
                }
                return Ok(Some(text));
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(None)
}

#[tauri::command]
pub fn write_app_document(
    app: tauri::AppHandle,
    name: String,
    content: String,
) -> Result<(), String> {
    let _guard = DATA_LOCK.lock().map_err(|e| e.to_string())?;
    if content.len() > MAX_BYTES {
        return Err("数据文件过大".into());
    }
    serde_json::from_str::<serde_json::Value>(&content).map_err(|e| e.to_string())?;
    let path = app_document(&app, &name)?;
    if name == "quiz-data.json" {
        if let Ok(old) = fs::read_to_string(&path) {
            if let (Ok(mut before), Ok(mut after)) = (
                serde_json::from_str::<serde_json::Value>(&old),
                serde_json::from_str::<serde_json::Value>(&content),
            ) {
                if let (Some(before), Some(after)) = (before.as_object_mut(), after.as_object_mut())
                {
                    before.remove("savedAt");
                    after.remove("savedAt");
                    if before == after {
                        return Ok(());
                    }
                }
            }
        }
    }
    atomic_write(&path, content.as_bytes())
}

#[tauri::command]
pub fn data_storage_info(app: tauri::AppHandle) -> Result<String, String> {
    Ok(format!(
        "学习记录：{}；题库与图片：{}",
        app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .display(),
        crate::writable_content_root(&app)?.display()
    ))
}

fn safe_target(app: &tauri::AppHandle, relative: &str) -> Result<PathBuf, String> {
    let parts: Vec<_> = relative.split('/').collect();
    if parts.iter().any(|p| {
        p.is_empty()
            || *p == "."
            || *p == ".."
            || p.ends_with(['.', ' '])
            || p.chars().any(|c| c < ' ' || "\\:*?\"<>|".contains(c))
            || [
                "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
                "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8",
                "LPT9",
            ]
            .contains(&p.split('.').next().unwrap_or("").to_uppercase().as_str())
    }) {
        return Err(format!("备份包含不安全路径：{relative}"));
    }
    let (root, rest) = match parts.as_slice() {
        ["documents", name] => return app_document(app, name),
        ["user", directory, rest @ ..]
            if ["subjects", "images"].contains(directory) && !rest.is_empty() =>
        {
            (user_content_root(app)?, &parts[1..])
        }
        ["development", directory, rest @ ..]
            if ["subjects", "images"].contains(directory) && !rest.is_empty() =>
        {
            (
                development_content_root().ok_or("正式版不能恢复开发目录")?,
                &parts[1..],
            )
        }
        _ => return Err(format!("不支持的备份路径：{relative}")),
    };
    let mut path = root;
    for part in rest {
        path.push(part);
        if let Ok(metadata) = fs::symlink_metadata(&path) {
            if metadata.file_type().is_symlink() {
                return Err("不能恢复到符号链接".into());
            }
        }
    }
    Ok(path)
}

fn collect(
    root: &Path,
    directory: &Path,
    prefix: &str,
    files: &mut Vec<DataFile>,
    size: &mut usize,
) -> Result<(), String> {
    if !directory.exists() {
        return Ok(());
    }
    for item in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let kind = item.file_type().map_err(|e| e.to_string())?;
        if kind.is_symlink() {
            return Err("数据目录中存在符号链接，请移出后备份".into());
        }
        if kind.is_dir() {
            collect(root, &item.path(), prefix, files, size)?;
        } else if kind.is_file() {
            let path = item.path();
            let relative = path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            if [".gitkeep", "README.md"].contains(&item.file_name().to_string_lossy().as_ref()) {
                continue;
            }
            if relative.ends_with(".bak")
                || relative.ends_with(".pending")
                || relative == "subjects/banks.json"
                || (relative.starts_with("subjects/")
                    && path
                        .extension()
                        .and_then(|value| value.to_str())
                        .map(|value| !value.eq_ignore_ascii_case("json"))
                        .unwrap_or(true))
            {
                continue;
            }
            let length = item.metadata().map_err(|e| e.to_string())?.len() as usize;
            *size += length;
            if *size > MAX_BYTES || files.len() >= 20000 {
                return Err("备份超过 256 MB 或 20000 个文件的限制".into());
            }
            files.push(DataFile {
                path: format!("{prefix}/{relative}"),
                data: STANDARD.encode(fs::read(path).map_err(|e| e.to_string())?),
            });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn export_content_data(app: tauri::AppHandle) -> Result<Vec<DataFile>, String> {
    let _guard = DATA_LOCK.lock().map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    let mut size = 0;
    let mut roots = vec![("user", user_content_root(&app)?)];
    if let Some(root) = development_content_root() {
        roots.push(("development", root));
    }
    for (prefix, root) in roots {
        for folder in ["subjects", "images"] {
            collect(&root, &root.join(folder), prefix, &mut files, &mut size)?;
        }
    }
    Ok(files)
}

#[derive(Serialize, Deserialize)]
struct UndoFile {
    path: String,
    data: Option<String>,
}

fn journal_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("restore-journal.json"))
}

pub fn recover_pending_restore(app: &tauri::AppHandle) -> Result<(), String> {
    recover_journal(&journal_path(app)?, &|path| safe_target(app, path))
}

fn recover_journal(
    journal: &Path,
    resolve: &impl Fn(&str) -> Result<PathBuf, String>,
) -> Result<(), String> {
    if !journal.exists() {
        return Ok(());
    }
    let entries: Vec<UndoFile> =
        serde_json::from_slice(&fs::read(&journal).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    for entry in entries {
        let target = resolve(&entry.path)?;
        if let Some(data) = entry.data {
            let bytes = STANDARD.decode(data).map_err(|e| e.to_string())?;
            if fs::read(&target).ok().as_deref() != Some(bytes.as_slice()) {
                atomic_write(&target, &bytes)?;
            }
        } else if target.exists() {
            fs::remove_file(target).map_err(|e| e.to_string())?;
        }
    }
    fs::remove_file(journal).map_err(|e| e.to_string())
}

/// Durable undo journal makes interrupted, multi-file restores recoverable at startup.
#[tauri::command]
pub fn restore_content_data(
    app: tauri::AppHandle,
    files: Vec<DataFile>,
    remove_paths: Option<Vec<String>>,
) -> Result<(), String> {
    let _guard = DATA_LOCK.lock().map_err(|e| e.to_string())?;
    recover_pending_restore(&app)?;
    if files.len() > 20000 {
        return Err("备份文件数量过多".into());
    }
    let mut seen = HashSet::new();
    let mut size = 0;
    let mut planned = Vec::new();
    let mut undo = Vec::new();
    for file in files {
        if !seen.insert(file.path.to_lowercase()) {
            return Err("备份路径重复".into());
        }
        let target = safe_target(&app, &file.path)?;
        let bytes = STANDARD.decode(&file.data).map_err(|e| e.to_string())?;
        size += bytes.len();
        if size > MAX_BYTES {
            return Err("备份超过 256 MB 限制".into());
        }
        let old = match fs::read(&target) {
            Ok(data) => Some(STANDARD.encode(data)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.to_string()),
        };
        undo.push(UndoFile {
            path: file.path,
            data: old,
        });
        planned.push((target, Some(bytes)));
    }
    for path in remove_paths.unwrap_or_default() {
        if !seen.insert(path.to_lowercase()) {
            return Err("恢复和删除路径重复".into());
        }
        let target = safe_target(&app, &path)?;
        match fs::read(&target) {
            Ok(data) => {
                undo.push(UndoFile {
                    path,
                    data: Some(STANDARD.encode(data)),
                });
                planned.push((target, None));
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.to_string()),
        }
    }
    run_transaction(&journal_path(&app)?, planned, &undo, &|path| {
        safe_target(&app, path)
    })
}

fn run_transaction(
    journal: &Path,
    planned: Vec<(PathBuf, Option<Vec<u8>>)>,
    undo: &[UndoFile],
    resolve: &impl Fn(&str) -> Result<PathBuf, String>,
) -> Result<(), String> {
    atomic_write(
        journal,
        &serde_json::to_vec(undo).map_err(|e| e.to_string())?,
    )?;
    for (target, bytes) in planned {
        if let Err(error) = match bytes {
            Some(bytes) => atomic_write(&target, &bytes),
            None => fs::remove_file(&target).map_err(|e| e.to_string()),
        } {
            recover_journal(journal, resolve)
                .map_err(|rollback| format!("{error}；回滚未完成，重启后重试：{rollback}"))?;
            return Err(error);
        }
    }
    fs::remove_file(journal).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn upgrade_snapshot_is_immutable_and_retains_native_browser_and_legacy_originals() {
        let root = std::env::temp_dir().join(format!("exam-upgrade-{}", std::process::id()));
        let documents = vec![
            ("root-0-quiz-data.json".into(), b"v0.1.6 original".to_vec()),
            (
                "root-1-quiz-data.json".into(),
                b"legacy local original".to_vec(),
            ),
        ];
        let path =
            prepare_upgrade_snapshot(&root, "0.2.0", &documents, "browser-original").unwrap();
        prepare_upgrade_snapshot(&root, "0.2.0", &[], "changed after restart").unwrap();
        assert_eq!(
            fs::read(path.join("root-0-quiz-data.json")).unwrap(),
            b"v0.1.6 original"
        );
        assert_eq!(
            fs::read(path.join("root-1-quiz-data.json")).unwrap(),
            b"legacy local original"
        );
        assert_eq!(
            fs::read(path.join("browser-learning.json")).unwrap(),
            b"browser-original"
        );
        let next = root.join("upgrade-backups/0.2.1");
        fs::create_dir_all(next.join("browser-learning.json.pending")).unwrap();
        assert!(prepare_upgrade_snapshot(&root, "0.2.1", &documents, "browser-original").is_err());
        assert!(!next.join("complete.json").exists());
        assert_eq!(
            fs::read(next.join("root-0-quiz-data.json")).unwrap(),
            b"v0.1.6 original"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn legacy_file_migration_preserves_original_and_never_overrides_current_or_corrupt_data() {
        let root = std::env::temp_dir().join(format!("exam-path-migration-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let primary = root.join("roaming/quiz-data.json");
        let legacy = root.join("local/quiz-data.json");
        fs::create_dir_all(legacy.parent().unwrap()).unwrap();
        fs::write(&legacy, "legacy-original").unwrap();
        let paths = [primary.clone(), legacy.clone()];
        assert_eq!(
            read_document_candidates(&paths, false).unwrap().unwrap(),
            "legacy-original"
        );
        assert_eq!(fs::read(&primary).unwrap(), fs::read(&legacy).unwrap());
        fs::write(&primary, "{corrupt").unwrap();
        assert_eq!(
            read_document_candidates(&paths, false).unwrap().unwrap(),
            "{corrupt"
        );
        fs::write(legacy.with_file_name("quiz-data.json.bak"), "legacy-backup").unwrap();
        assert_eq!(
            read_document_candidates(&paths, true).unwrap().unwrap(),
            "legacy-backup"
        );
        assert_eq!(fs::read(&primary).unwrap(), b"{corrupt");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn incomplete_upgrade_backup_cannot_be_treated_as_protected() {
        let root =
            std::env::temp_dir().join(format!("exam-upgrade-incomplete-{}", std::process::id()));
        let documents = vec![("root-0-quiz-data.json".into(), b"original".to_vec())];
        let path = prepare_upgrade_snapshot(&root, "0.2.0", &documents, "{}").unwrap();
        fs::remove_file(path.join("root-0-quiz-data.json")).unwrap();
        assert!(prepare_upgrade_snapshot(&root, "0.2.0", &documents, "{}").is_err());
        assert!(!path.join("root-0-quiz-data.json").exists());
        assert_eq!(fs::read(path.join("browser-learning.json")).unwrap(), b"{}");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_second_file_rolls_first_file_back_and_startup_replays_interrupted_journal() {
        let root = std::env::temp_dir().join(format!("exam-restore-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let first = root.join("first.json");
        let second = root.join("second.json");
        fs::write(&first, b"original one").unwrap();
        fs::write(&second, b"original two").unwrap();
        let undo = vec![
            UndoFile {
                path: "first.json".into(),
                data: Some(STANDARD.encode(b"original one")),
            },
            UndoFile {
                path: "second.json".into(),
                data: Some(STANDARD.encode(b"original two")),
            },
        ];
        let journal = root.join("journal.json");
        fs::create_dir(root.join("second.json.pending")).unwrap();
        let resolver = |name: &str| Ok(root.join(name));
        assert!(run_transaction(
            &journal,
            vec![
                (first.clone(), Some(b"changed one".to_vec())),
                (second.clone(), Some(b"changed two".to_vec()))
            ],
            &undo,
            &resolver
        )
        .is_err());
        assert_eq!(fs::read(&first).unwrap(), b"original one");
        assert_eq!(fs::read(&second).unwrap(), b"original two");
        assert!(!journal.exists());
        atomic_write(&journal, &serde_json::to_vec(&undo).unwrap()).unwrap();
        atomic_write(&first, b"interrupted").unwrap();
        recover_journal(&journal, &resolver).unwrap();
        assert_eq!(fs::read(&first).unwrap(), b"original one");
        assert!(!journal.exists());
        fs::remove_dir_all(root).unwrap();
    }
}
