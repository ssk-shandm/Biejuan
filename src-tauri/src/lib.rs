use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
#[cfg(not(target_os = "android"))]
use std::process::Command;
use tauri::{Emitter, Manager as _};

const DEFAULT_LLM_CONFIG: &str = include_str!("../../config/llm-config.json");

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

/// Open the built-in question-bank or image-library directory.
///
/// Development builds point at the repository's `public` directory. Packaged
/// builds point at the `public` directory copied beside the installed app resources.
#[tauri::command]
fn open_content_location(_app: tauri::AppHandle, location: &str) -> Result<String, String> {
    let directory_name = match location {
        "subjects" => "subjects",
        "images" => "images",
        _ => return Err("不支持的资源位置".to_string()),
    };

    #[cfg(debug_assertions)]
    let target = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("public")
        .join(directory_name);

    #[cfg(not(debug_assertions))]
    let target = _app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法获取应用资源目录：{error}"))?
        .join("public")
        .join(directory_name);

    if !target.is_dir() {
        return Err(format!("资源目录不存在：{}", target.display()));
    }

    open_directory(&target).map_err(|error| format!("无法打开资源目录：{error}"))?;
    Ok(target.to_string_lossy().into_owned())
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
