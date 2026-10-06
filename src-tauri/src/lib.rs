use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
#[cfg(not(target_os = "android"))]
use std::process::Command;
use tauri::{Emitter, Manager as _};
mod public_banks;

const DEFAULT_LLM_CONFIG: &str = include_str!("../../public/config/examples/llm-user-config.example.json");

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LlmConfigPayload {
    content: String,
    location: String,
}

fn app_config_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|error| format!("无法获取应用配置目录：{error}"))
}

fn llm_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app_config_directory(app).map(|directory| directory.join("llm-config.txt"))
}

fn legacy_llm_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app_config_directory(app).map(|directory| directory.join("llm-config.json"))
}

fn ensure_llm_config_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = llm_config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建配置目录：{error}"))?;
    }

    if !path.exists() {
        let legacy_path = legacy_llm_config_path(app)?;
        if legacy_path.is_file() {
            fs::copy(&legacy_path, &path)
                .map_err(|error| format!("无法迁移旧版 LLM 配置：{error}"))?;
        } else {
            fs::write(&path, DEFAULT_LLM_CONFIG)
                .map_err(|error| format!("无法创建默认 LLM 配置：{error}"))?;
        }
    }

    Ok(path)
}

#[tauri::command]
fn read_llm_config(app: tauri::AppHandle) -> Result<LlmConfigPayload, String> {
    let path = ensure_llm_config_file(&app)?;
    let raw = fs::read_to_string(&path).map_err(|error| format!("无法读取 LLM 配置：{error}"))?;
    let content = raw.strip_prefix('\u{feff}').unwrap_or(&raw).to_owned();
    Ok(LlmConfigPayload {
        content,
        location: path.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
fn write_llm_config(app: tauri::AppHandle, content: String) -> Result<LlmConfigPayload, String> {
    if content.len() > 256 * 1024 {
        return Err("LLM 配置文件不能超过 256 KB".to_string());
    }
    let parsed: serde_json::Value = serde_json::from_str(&content)
        .map_err(|error| format!("LLM 配置不是有效 JSON：{error}"))?;
    let pretty = serde_json::to_string_pretty(&parsed)
        .map_err(|error| format!("无法序列化 LLM 配置：{error}"))?;
    let path = llm_config_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建配置目录：{error}"))?;
    }
    fs::write(&path, format!("{pretty}\n"))
        .map_err(|error| format!("无法保存 LLM 配置：{error}"))?;
    Ok(LlmConfigPayload {
        content: pretty,
        location: path.to_string_lossy().into_owned(),
    })
}

fn open_text_file(path: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "android")]
    {
        let _ = path;
        return Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "Android 不支持通过外部文本编辑器打开应用配置",
        ));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("notepad.exe").arg(path).spawn()?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg("-e").arg(path).spawn()?;
    }

    #[cfg(all(unix, not(any(target_os = "macos", target_os = "android"))))]
    {
        Command::new("xdg-open").arg(path).spawn()?;
    }

    Ok(())
}

#[tauri::command]
fn open_llm_config_file(app: tauri::AppHandle) -> Result<String, String> {
    let path = ensure_llm_config_file(&app)?;
    open_text_file(&path).map_err(|error| format!("无法用文本编辑器打开 LLM 配置：{error}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Return the current app version for the "about/update" UI.
#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

fn open_directory(path: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "android")]
    {
        let _ = path;
        return Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "Android 不支持打开应用资源目录",
        ));
    }

    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe").arg(path).spawn()?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open").arg(path).spawn()?;
    }

    #[cfg(all(unix, not(any(target_os = "macos", target_os = "android"))))]
    {
        Command::new("xdg-open").arg(path).spawn()?;
    }

    Ok(())
}

/// Open the writable question-bank or image-library directory.
/// Packaged resources are read-only; installed apps write to per-user app data.
#[tauri::command]
fn open_content_location(app: tauri::AppHandle, location: &str) -> Result<String, String> {
    let directory_name = content_directory_name(location)?;
    let target = writable_content_root(&app)?.join(directory_name);
    fs::create_dir_all(&target).map_err(|error| format!("无法创建资源目录：{error}"))?;
    open_directory(&target).map_err(|error| format!("无法打开资源目录：{error}"))?;
    Ok(target.to_string_lossy().into_owned())
}

fn public_directory(_app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("public");

    #[cfg(not(debug_assertions))]
    let root = _app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法获取应用资源目录：{error}"))?
        .join("public");

    Ok(root)
}

fn user_content_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|directory| directory.join("content"))
        .map_err(|error| format!("无法获取应用数据目录：{error}"))
}

fn writable_content_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        public_directory(app)
    }
    #[cfg(not(debug_assertions))]
    {
        user_content_root(app)
    }
}

fn content_directory_name(location: &str) -> Result<&str, String> {
    match location {
        "subjects" => Ok("subjects"),
        "images" => Ok("images"),
        _ => Err("不支持的资源位置".to_string()),
    }
}

fn content_directory(app: &tauri::AppHandle, location: &str) -> Result<PathBuf, String> {
    Ok(public_directory(app)?.join(content_directory_name(location)?))
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct QuestionBankEntry {
    name: String,
    file: String,
    deletable: bool,
}

#[tauri::command]
fn save_question_bank(
    app: tauri::AppHandle,
    payload: public_banks::BankPayload,
) -> Result<public_banks::BankSaveResult, String> {
    let root = writable_content_root(&app)?;
    let prefix = if cfg!(debug_assertions) {
        "/subjects"
    } else {
        "/user-subjects"
    };
    public_banks::save_bank(&root, prefix, payload)
}

#[tauri::command]
fn list_question_banks(app: tauri::AppHandle) -> Result<Vec<QuestionBankEntry>, String> {
    list_question_banks_from_directories(
        &content_directory(&app, "subjects")?,
        &user_content_root(&app)?.join("subjects"),
        cfg!(debug_assertions),
    )
}

fn list_question_banks_from_directories(
    bundled: &Path,
    user: &Path,
    bundled_deletable: bool,
) -> Result<Vec<QuestionBankEntry>, String> {
    let mut banks = scan_question_banks(bundled, "/subjects", bundled_deletable)?;
    banks.extend(scan_question_banks(user, "/user-subjects", true)?);
    banks.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(banks)
}

fn scan_question_banks(
    target: &Path,
    prefix: &str,
    deletable: bool,
) -> Result<Vec<QuestionBankEntry>, String> {
    if !target.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&target)
        .map_err(|error| format!("无法读取题库目录 {}: {error}", target.display()))?;
    let mut banks = Vec::new();

    for entry in entries {
        let entry = entry.map_err(|error| format!("无法读取题库文件: {error}"))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
            continue;
        };
        if !extension.eq_ignore_ascii_case("json") {
            continue;
        }

        let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if file_name.eq_ignore_ascii_case("banks.json") {
            continue;
        }

        let name = path
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or(file_name)
            .to_owned();
        banks.push(QuestionBankEntry {
            name,
            file: format!("{prefix}/{file_name}"),
            deletable,
        });
    }

    banks.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(banks)
}

#[tauri::command]
fn read_question_bank(app: tauri::AppHandle, file: &str) -> Result<String, String> {
    read_question_bank_from_directories(
        file,
        &content_directory(&app, "subjects")?,
        &user_content_root(&app)?.join("subjects"),
    )
}

fn read_question_bank_from_directories(
    file: &str,
    bundled: &Path,
    user: &Path,
) -> Result<String, String> {
    let (directory, file_name) = if let Some(name) = file.strip_prefix("/user-subjects/") {
        (user, name)
    } else if let Some(name) = file.strip_prefix("/subjects/") {
        (bundled, name)
    } else {
        return Err("不支持的题库路径".to_string());
    };
    let target = resolve_question_bank_file(directory, file_name)?;
    let content = fs::read_to_string(&target)
        .map(|text| text.trim_start_matches('\u{feff}').to_owned())
        .map_err(|error| format!("无法读取题库，请使用 UTF-8 编码保存：{error}"))?;
    public_banks::inline_bank_images(
        content,
        directory.parent().ok_or("无法获取题库资源目录")?,
        &target,
    )
}

fn resolve_question_bank_file(directory: &Path, file_name: &str) -> Result<PathBuf, String> {
    if file_name.is_empty()
        || file_name.contains(['/', '\\', ':'])
        || file_name.eq_ignore_ascii_case("banks.json")
        || !Path::new(file_name)
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
    {
        return Err("不支持的题库文件名".to_string());
    }
    let directory = directory
        .canonicalize()
        .map_err(|error| format!("无法读取题库目录：{error}"))?;
    let target = directory
        .join(file_name)
        .canonicalize()
        .map_err(|error| format!("无法找到题库文件：{error}"))?;
    if target.parent() != Some(directory.as_path()) || !target.is_file() {
        return Err("题库文件必须位于选定的 subjects 目录内".to_string());
    }
    Ok(target)
}

#[tauri::command]
fn delete_question_bank(app: tauri::AppHandle, file: &str) -> Result<(), String> {
    delete_question_bank_from_directories(
        file,
        &content_directory(&app, "subjects")?,
        &user_content_root(&app)?.join("subjects"),
        cfg!(debug_assertions),
    )
}

fn delete_question_bank_from_directories(
    file: &str,
    bundled: &Path,
    user: &Path,
    bundled_deletable: bool,
) -> Result<(), String> {
    let (directory, file_name) = if let Some(name) = file.strip_prefix("/user-subjects/") {
        (user, name)
    } else if let Some(name) = file.strip_prefix("/subjects/") {
        if !bundled_deletable {
            return Err("安装包资源目录中的题库为只读，不能删除".to_string());
        }
        (bundled, name)
    } else {
        return Err("不支持的题库路径".to_string());
    };
    let target = resolve_question_bank_file(directory, file_name)?;
    // Delete only this JSON. Manually imported banks may share image resources.
    fs::remove_file(&target).map_err(|error| format!("无法删除题库 {}：{error}", target.display()))
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct UpdateDownloadProgress {
    downloaded: u64,
    total: Option<u64>,
    percent: Option<u8>,
    file_name: String,
}

fn validate_update_url(url: &str) -> Result<(), String> {
    let Some(rest) = url.strip_prefix("https://") else {
        return Err("Update download URL must use HTTPS".to_string());
    };
    let host = rest
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let allowed_hosts = [
        "github.com",
        "objects.githubusercontent.com",
        "github-releases.githubusercontent.com",
        "release-assets.githubusercontent.com",
    ];
    if !allowed_hosts.contains(&host.as_str()) {
        return Err("Update download URL is not a supported GitHub asset URL".to_string());
    }
    Ok(())
}

fn safe_update_file_name(file_name: &str) -> Result<String, String> {
    let name = file_name.rsplit(['/', '\\']).next().unwrap_or("").trim();
    if name.is_empty()
        || name == "."
        || name == ".."
        || !name.to_ascii_lowercase().ends_with("-setup.exe")
    {
        return Err("Invalid update installer file name".to_string());
    }
    if !name
        .chars()
        .all(|character| !character.is_control() && !r#"<>:"/\|?*"#.contains(character))
    {
        return Err("Update installer file name contains unsafe characters".to_string());
    }
    Ok(name.to_string())
}

#[tauri::command]
async fn download_and_install_update(
    app: tauri::AppHandle,
    url: String,
    file_name: String,
) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, url, file_name);
        return Err("Automatic installation is supported only on Windows desktop".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        validate_update_url(&url)?;
        let safe_name = safe_update_file_name(&file_name)?;
        let executable =
            std::env::current_exe().map_err(|error| format!("无法获取当前程序路径：{error}"))?;
        let install_directory = executable
            .parent()
            .ok_or_else(|| "无法获取当前安装目录".to_string())?;
        if !install_directory.join("uninstall.exe").is_file() {
            return Err("当前运行的是便携版或开发版，自动安装不会替换此文件。请使用 Release 中的 *-setup.exe 安装版，并从安装后生成的快捷方式启动。".to_string());
        }
        // 优先保存到用户「下载」目录，方便安装失败时手动找到安装包
        let save_dir = app
            .path()
            .download_dir()
            .or_else(|_| app.path().temp_dir())
            .map_err(|error| format!("无法获取下载目录：{error}"))?;
        fs::create_dir_all(&save_dir).map_err(|error| format!("无法创建下载目录：{error}"))?;
        let target = save_dir.join(&safe_name);
        // 先写入 .part 临时文件，下载完成后再重命名，避免残留半截安装包
        let partial = save_dir.join(format!("{safe_name}.part"));

        let response = reqwest::Client::new()
            .get(&url)
            .header("Accept", "application/octet-stream")
            .header("User-Agent", "exam-desktop-updater")
            .send()
            .await
            .map_err(|error| format!("Update download failed: {error}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "Update download failed (HTTP {})",
                response.status()
            ));
        }

        let total = response.content_length();
        let mut downloaded = 0_u64;
        let mut output =
            fs::File::create(&partial).map_err(|error| format!("无法创建更新文件：{error}"))?;
        let emit_progress = |downloaded: u64, percent: Option<u8>| {
            let _ = app.emit(
                "update-download-progress",
                UpdateDownloadProgress {
                    downloaded,
                    total,
                    percent,
                    file_name: safe_name.clone(),
                },
            );
        };
        emit_progress(0, total.map(|_| 0));

        // 只在百分比变化（或未知总大小时每 1 MB）时上报，避免每个网络分片都推送一次事件
        let mut last_percent: Option<u8> = Some(0);
        let mut last_reported_bytes = 0_u64;
        let mut response = response;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| format!("读取更新数据失败：{error}"))?
        {
            output
                .write_all(&chunk)
                .map_err(|error| format!("保存更新文件失败：{error}"))?;
            downloaded += chunk.len() as u64;
            match total {
                Some(size) => {
                    let percent = if size == 0 {
                        100
                    } else {
                        (downloaded.saturating_mul(100) / size).min(100) as u8
                    };
                    if last_percent != Some(percent) {
                        last_percent = Some(percent);
                        emit_progress(downloaded, Some(percent));
                    }
                }
                None => {
                    if downloaded - last_reported_bytes >= 1024 * 1024 {
                        last_reported_bytes = downloaded;
                        emit_progress(downloaded, None);
                    }
                }
            }
        }
        output
            .flush()
            .map_err(|error| format!("写入更新文件失败：{error}"))?;
        drop(output);
        if downloaded == 0 || total.is_some_and(|size| size != downloaded) {
            return Err("更新安装包下载不完整，请重试".to_string());
        }
        if total.is_none() {
            emit_progress(downloaded, None);
        }

        if target.exists() {
            let _ = fs::remove_file(&target);
        }
        fs::rename(&partial, &target).map_err(|error| format!("无法保存更新安装包：{error}"))?;

        let _ = app.emit(
            "update-install-starting",
            target.to_string_lossy().into_owned(),
        );
        launch_installer(&target, install_directory).map_err(|error| {
            format!(
                "{error}。安装包已保存到：{}，可手动运行安装",
                target.display()
            )
        })?;
        app.exit(0);
        Ok(())
    }
}

/// 通过 ShellExecuteW 启动安装包。
///
/// 安装包是 perMachine 模式，清单要求管理员权限；`Command::spawn`（CreateProcess）
/// 遇到需要提权的程序会直接失败（ERROR_ELEVATION_REQUIRED），而 ShellExecute
/// 会正常弹出 UAC 确认。`/P` 为被动模式（只显示进度、无需点击），`/R` 让安装完成后自动重启应用。
#[cfg(target_os = "windows")]
fn launch_installer(path: &Path, install_directory: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
        value.encode_wide().chain(std::iter::once(0)).collect()
    }

    let operation = wide("open".as_ref());
    let file = wide(path.as_os_str());
    let mut arguments = std::ffi::OsString::from("/UPDATE /P /R /D=");
    arguments.push(install_directory);
    let parameters = wide(&arguments);
    let directory = path.parent().map(|dir| wide(dir.as_os_str()));

    // SAFETY: 所有字符串都是以 0 结尾的 UTF-16 缓冲区，在调用期间保持存活
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            file.as_ptr(),
            parameters.as_ptr(),
            directory
                .as_ref()
                .map_or(std::ptr::null(), |dir| dir.as_ptr()),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecuteW 返回值大于 32 表示成功
    let code = result as isize;
    if code > 32 {
        Ok(())
    } else if code == 5 {
        Err("已取消管理员授权，更新未安装".to_string())
    } else {
        Err(format!("无法启动更新安装程序（错误码 {code}）"))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_app_version,
            open_content_location,
            list_question_banks,
            read_question_bank,
            save_question_bank,
            delete_question_bank,
            read_llm_config,
            write_llm_config,
            open_llm_config_file,
            download_and_install_update
        ])
        .setup(|_app| {
            #[cfg(debug_assertions)]
            if let Some(window) = _app.get_webview_window("main") {
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod content_tests {
    use super::*;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let id = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root =
                std::env::temp_dir().join(format!("exam-content-{}-{id}", std::process::id()));
            fs::create_dir_all(&root).unwrap();
            Self(root)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn shipped_llm_defaults_do_not_embed_development_credentials() {
        let defaults: serde_json::Value = serde_json::from_str(DEFAULT_LLM_CONFIG).unwrap();
        assert!(defaults["provider"]["apiKey"].as_str().unwrap_or("").is_empty());
        assert_eq!(defaults["privacy"]["allowRemoteProcessing"], false);
        assert_eq!(defaults["privacy"]["confirmBeforeSending"], true);
        assert_eq!(defaults["schemaVersion"], 1);
    }

    fn payload(content: &str, image: &str) -> public_banks::BankPayload {
        serde_json::from_value(serde_json::json!({
            "name": "same-name",
            "directory": "import-test",
            "content": serde_json::json!([{
                "type": "single",
                "content": content,
                "image": "/images/import-test/picture.png"
            }]).to_string(),
            "images": [{ "fileName": "picture.png", "data": image }]
        }))
        .unwrap()
    }

    #[test]
    fn bundled_and_user_banks_are_listed_and_read_with_their_own_images() {
        let temp = TestDirectory::new();
        let bundled = temp.0.join("installed-public");
        let user = temp.0.join("user-data/content");
        let original =
            public_banks::save_bank(&bundled, "/subjects", payload("bundled", "AQ==")).unwrap();
        let generated =
            public_banks::save_bank(&user, "/user-subjects", payload("user", "Ag==")).unwrap();
        assert_eq!(generated.file, "/user-subjects/same-name.json");
        assert!(Path::new(&generated.location).starts_with(user.canonicalize().unwrap()));
        let installed_before = fs::read(&original.location).unwrap();
        // A second save must not overwrite either an installed bank or an existing user bank.
        let second =
            public_banks::save_bank(&user, "/user-subjects", payload("second", "Aw==")).unwrap();
        assert_ne!(second.file, generated.file);
        assert_eq!(fs::read(&original.location).unwrap(), installed_before);

        let bundled = bundled.join("subjects");
        let user = user.join("subjects");
        let banks = list_question_banks_from_directories(&bundled, &user, false).unwrap();
        assert_eq!(banks.len(), 3);
        assert!(banks.iter().any(|entry| entry.file == original.file));
        assert!(banks.iter().any(|entry| entry.file == generated.file));
        let installed =
            read_question_bank_from_directories(&original.file, &bundled, &user).unwrap();
        let saved = read_question_bank_from_directories(&generated.file, &bundled, &user).unwrap();
        assert!(installed.contains("bundled"));
        assert!(installed.contains("data:image/png;base64,AQ=="));
        assert!(saved.contains("user"));
        assert!(saved.contains("data:image/png;base64,Ag=="));
    }

    #[test]
    fn absent_user_directory_does_not_hide_bundled_banks() {
        let temp = TestDirectory::new();
        let root = temp.0.join("public");
        public_banks::save_bank(&root, "/subjects", payload("bundled", "AQ==")).unwrap();
        let banks = list_question_banks_from_directories(
            &root.join("subjects"),
            &temp.0.join("absent"),
            false,
        )
        .unwrap();
        assert_eq!(banks.len(), 1);
    }

    #[test]
    fn user_json_and_ai_banks_are_deletable_but_installed_banks_are_read_only() {
        let temp = TestDirectory::new();
        let bundled = temp.0.join("installed-public");
        let user = temp.0.join("user-content");
        let installed =
            public_banks::save_bank(&bundled, "/subjects", payload("bundled", "AQ==")).unwrap();
        let generated =
            public_banks::save_bank(&user, "/user-subjects", payload("ai", "Ag==")).unwrap();
        let manual = user.join("subjects/manual.json");
        fs::write(&manual, r#"[{"type":"single","content":"manual"}]"#).unwrap();
        let bundled_subjects = bundled.join("subjects");
        let user_subjects = user.join("subjects");
        let banks =
            list_question_banks_from_directories(&bundled_subjects, &user_subjects, false).unwrap();
        assert_eq!(banks.len(), 3);
        assert!(
            !banks
                .iter()
                .find(|bank| bank.file == installed.file)
                .unwrap()
                .deletable
        );
        assert!(banks
            .iter()
            .filter(|bank| bank.file.starts_with("/user-subjects/"))
            .all(|bank| bank.deletable));
        assert!(delete_question_bank_from_directories(
            &installed.file,
            &bundled_subjects,
            &user_subjects,
            false
        )
        .is_err());
        assert!(Path::new(&installed.location).is_file());
        delete_question_bank_from_directories(
            "/user-subjects/manual.json",
            &bundled_subjects,
            &user_subjects,
            false,
        )
        .unwrap();
        delete_question_bank_from_directories(
            &generated.file,
            &bundled_subjects,
            &user_subjects,
            false,
        )
        .unwrap();
        assert!(!manual.exists());
        assert!(!Path::new(&generated.location).exists());
        assert!(user.join("images/same-name/picture.png").is_file());
        let banks =
            list_question_banks_from_directories(&bundled_subjects, &user_subjects, false).unwrap();
        assert_eq!(banks.len(), 1);
        assert_eq!(banks[0].file, installed.file);
    }

    #[test]
    fn development_directory_json_can_be_deleted() {
        let temp = TestDirectory::new();
        let bank = public_banks::save_bank(&temp.0, "/subjects", payload("dev", "AQ==")).unwrap();
        let subjects = temp.0.join("subjects");
        let user = temp.0.join("absent");
        assert!(list_question_banks_from_directories(&subjects, &user, true).unwrap()[0].deletable);
        delete_question_bank_from_directories(&bank.file, &subjects, &user, true).unwrap();
        assert!(!Path::new(&bank.location).exists());
    }

    #[test]
    fn delete_rejects_traversal_reserved_files_and_non_json() {
        let temp = TestDirectory::new();
        let subjects = temp.0.join("subjects");
        fs::create_dir(&subjects).unwrap();
        fs::write(temp.0.join("secret.json"), "secret").unwrap();
        fs::write(subjects.join("banks.json"), "[]").unwrap();
        fs::write(subjects.join("config.txt"), "secret").unwrap();
        for file in [
            "/user-subjects/../secret.json",
            "/subjects/../secret.json",
            "/user-subjects/sub/bank.json",
            "/user-subjects/sub\\bank.json",
            "/user-subjects/C:secret.json",
            "/user-subjects/banks.json",
            "/user-subjects/config.txt",
            "/user-subjects/",
            "/other/bank.json",
        ] {
            assert!(
                delete_question_bank_from_directories(file, &subjects, &subjects, true).is_err(),
                "{file}"
            );
        }
        assert!(temp.0.join("secret.json").is_file());
        assert!(subjects.join("banks.json").is_file());
        assert!(subjects.join("config.txt").is_file());
    }

    #[test]
    fn bank_read_rejects_path_traversal_and_reserved_files() {
        let temp = TestDirectory::new();
        for file in [
            "/user-subjects/../secret.json",
            "/user-subjects/sub/bank.json",
            "/user-subjects/sub\\bank.json",
            "/user-subjects/banks.json",
            "/user-subjects/key.txt",
            "/user-subjects/",
            "/other/bank.json",
            "/subjects/../secret.json",
            "/subjects/banks.json",
        ] {
            assert!(
                read_question_bank_from_directories(file, &temp.0, &temp.0).is_err(),
                "{file}"
            );
        }
    }
}
