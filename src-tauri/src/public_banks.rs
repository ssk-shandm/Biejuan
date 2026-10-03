use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BankImage {
    file_name: String,
    data: String,
}

#[derive(serde::Deserialize)]
pub struct BankPayload {
    name: String,
    directory: String,
    content: String,
    images: Vec<BankImage>,
}

#[derive(serde::Serialize)]
pub struct BankSaveResult {
    pub file: String,
    pub location: String,
}

fn validate_component(name: &str) -> Result<(), String> {
    let device = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if name.is_empty()
        || name.len() > 240
        || name.starts_with('.')
        || name.ends_with(['.', ' '])
        || name
            .chars()
            .any(|character| character.is_control() || "/\\:*?\"<>|".contains(character))
        || matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (device.len() == 4
            && (device.starts_with("COM") || device.starts_with("LPT"))
            && matches!(device.as_bytes()[3], b'1'..=b'9'))
    {
        return Err("不支持的题库或图片文件名".to_string());
    }
    Ok(())
}

fn bank_name(name: &str) -> String {
    let name: String = name
        .chars()
        .take(64)
        .map(|character| {
            if character.is_control() || "/\\:*?\"<>|%#".contains(character) {
                '-'
            } else {
                character
            }
        })
        .collect();
    let name = name.trim().trim_matches('.');
    let name = name.strip_suffix(".json").unwrap_or(name);
    if name.is_empty() {
        "question-bank".to_string()
    } else if validate_component(name).is_err() || name.eq_ignore_ascii_case("banks") {
        format!("题库-{name}")
    } else {
        name.to_string()
    }
}

fn checked_directory(root: &Path, child: &str) -> Result<PathBuf, String> {
    let directory = root.join(child);
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建题库目录：{error}"))?;
    let directory = directory
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if directory.parent() != Some(root) {
        return Err("题库目录不能指向 public 以外的位置".to_string());
    }
    Ok(directory)
}

fn write_new_file(path: &Path, data: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension(format!(
        "{}.tmp",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_nanos()
    ));
    let result = (|| {
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        output.write_all(data)?;
        output.sync_all()?;
        fs::rename(&temporary, path)
    })();
    let _ = fs::remove_file(&temporary);
    result.map_err(|error| format!("无法保存文件 {}：{error}", path.display()))
}

pub fn save_bank(
    root: &Path,
    prefix: &str,
    payload: BankPayload,
) -> Result<BankSaveResult, String> {
    if payload.content.len() > 16 * 1024 * 1024 {
        return Err("题库 JSON 超过 16 MB".to_string());
    }
    validate_component(&payload.directory)?;
    let raw: serde_json::Value =
        serde_json::from_str(payload.content.trim_start_matches('\u{feff}'))
            .map_err(|error| format!("JSON 格式错误：{error}"))?;
    if !raw.as_array().is_some_and(|questions| {
        !questions.is_empty()
            && questions.iter().all(|question| {
                question.is_object()
                    && question.get("type").is_some_and(|value| value.is_string())
                    && question
                        .get("content")
                        .or_else(|| question.get("question"))
                        .and_then(|value| value.as_str())
                        .is_some_and(|value| !value.trim().is_empty())
            })
    }) {
        return Err("题库必须是包含有效题目的非空数组".to_string());
    }
    let mut images = Vec::new();
    let mut total = 0;
    for image in &payload.images {
        validate_component(&image.file_name)?;
        if images.iter().any(|(name, _)| name == &image.file_name) {
            return Err("图片文件名不能重复".to_string());
        }
        let bytes = STANDARD
            .decode(&image.data)
            .map_err(|error| format!("图片编码错误：{error}"))?;
        total += bytes.len();
        if total > 48 * 1024 * 1024 {
            return Err("题库图片总大小超过 48 MB".to_string());
        }
        images.push((image.file_name.clone(), bytes));
    }
    fs::create_dir_all(root).map_err(|error| format!("无法创建 public 目录：{error}"))?;
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    let subjects = checked_directory(&root, "subjects")?;
    let images_root = checked_directory(&root, "images")?;
    let base = bank_name(&payload.name);
    let mut stem = base.clone();
    let mut suffix = 2;
    while subjects.join(format!("{stem}.json")).exists() || images_root.join(&stem).exists() {
        stem = format!("{base} ({suffix})");
        suffix += 1;
    }
    let image_directory = images_root.join(&stem);
    if !images.is_empty() {
        fs::create_dir(&image_directory).map_err(|error| format!("无法创建图片目录：{error}"))?;
    }
    let target = subjects.join(format!("{stem}.json"));
    let result = (|| {
        for (name, bytes) in &images {
            write_new_file(&image_directory.join(name), bytes)?;
        }
        let content = payload.content.replace(
            &format!("/images/{}/", payload.directory),
            &format!("/images/{stem}/"),
        );
        write_new_file(&target, content.as_bytes())
    })();
    if let Err(error) = result {
        for (name, _) in &images {
            let _ = fs::remove_file(image_directory.join(name));
        }
        let _ = fs::remove_dir(&image_directory);
        return Err(error);
    }
    Ok(BankSaveResult {
        file: format!("{prefix}/{stem}.json"),
        location: target.to_string_lossy().into_owned(),
    })
}

pub fn inline_bank_images(mut content: String, root: &Path, bank: &Path) -> Result<String, String> {
    let Some(stem) = bank.file_stem().and_then(|value| value.to_str()) else {
        return Ok(content);
    };
    let images_root = root.join("images");
    let directory = images_root.join(stem);
    if !directory.exists() {
        return Ok(content);
    }
    let images_root = images_root
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let directory = directory
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if directory.parent() != Some(images_root.as_path()) {
        return Err("图片目录不能指向 public/images 以外的位置".to_string());
    }
    for entry in fs::read_dir(&directory).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let reference = format!("/images/{stem}/{name}");
        if !content.contains(&reference) {
            continue;
        }
        let resolved = path.canonicalize().map_err(|error| error.to_string())?;
        if resolved.parent() != Some(directory.as_path()) || !resolved.is_file() {
            return Err("图片文件路径不合法".to_string());
        }
        let mime = match path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str()
        {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "svg" => "image/svg+xml",
            "bmp" => "image/bmp",
            _ => "application/octet-stream",
        };
        let bytes = fs::read(&resolved).map_err(|error| format!("无法读取题库图片：{error}"))?;
        content = content.replace(
            &reference,
            &format!("data:{mime};base64,{}", STANDARD.encode(bytes)),
        );
    }
    Ok(content)
}
