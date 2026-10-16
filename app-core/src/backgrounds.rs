use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use url::Url;

use crate::{AppConfig, nightingale_dir};

pub const MAX_BACKGROUND_UPLOAD_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;
const MAX_SHADER_BYTES: u64 = 256 * 1024;
const MAX_NAME_CHARS: usize = 80;
const MAX_URL_CHARS: usize = 2048;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum CustomBackgroundKind {
    Image,
    Shader,
    Video,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum CustomBackgroundSource {
    Managed { file_name: String },
    Url { url: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CustomBackground {
    pub id: String,
    pub name: String,
    pub background_type: CustomBackgroundKind,
    pub source: CustomBackgroundSource,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum BackgroundSelection {
    BuiltInShader { id: String },
    Pixabay,
    Custom { id: String },
}

fn backgrounds_dir() -> PathBuf {
    nightingale_dir().join("backgrounds")
}

fn normalized_name(name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("background name cannot be empty".into());
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(format!(
            "background name cannot exceed {MAX_NAME_CHARS} characters"
        ));
    }
    Ok(name.to_string())
}

fn extension_for(name: &str) -> Result<String, String> {
    Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "background file needs a supported extension".to_string())
}

pub fn custom_background_kind_for_name(name: &str) -> Result<CustomBackgroundKind, String> {
    let extension = extension_for(name)?;
    match extension.as_str() {
        "jpg" | "jpeg" | "png" | "webp" => Ok(CustomBackgroundKind::Image),
        "glsl" | "frag" | "fs" => Ok(CustomBackgroundKind::Shader),
        "mp4" | "webm" => Ok(CustomBackgroundKind::Video),
        _ => Err(format!(
            "unsupported background extension .{extension}; supported: .jpg, .jpeg, .png, .webp, .glsl, .frag, .fs, .mp4, .webm"
        )),
    }
}

pub fn custom_background_max_bytes(kind: CustomBackgroundKind) -> u64 {
    match kind {
        CustomBackgroundKind::Image => MAX_IMAGE_BYTES,
        CustomBackgroundKind::Shader => MAX_SHADER_BYTES,
        CustomBackgroundKind::Video => MAX_BACKGROUND_UPLOAD_BYTES,
    }
}

fn read_prefix(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let mut file =
        File::open(path).map_err(|error| format!("failed opening background: {error}"))?;
    let mut bytes = Vec::new();
    file.by_ref()
        .take(limit)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("failed reading background: {error}"))?;
    Ok(bytes)
}

fn validate_image_signature(extension: &str, bytes: &[u8]) -> bool {
    match extension {
        "jpg" | "jpeg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "png" => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        "webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        _ => false,
    }
}

fn validate_video_signature(extension: &str, bytes: &[u8]) -> bool {
    match extension {
        "mp4" => bytes.get(4..8) == Some(b"ftyp"),
        "webm" => bytes.starts_with(&[0x1a, 0x45, 0xdf, 0xa3]),
        _ => false,
    }
}

fn validate_file(
    path: &Path,
    original_name: &str,
) -> Result<(CustomBackgroundKind, String), String> {
    let metadata = path
        .metadata()
        .map_err(|error| format!("failed reading background metadata: {error}"))?;
    if !metadata.is_file() {
        return Err("background upload must be a file".into());
    }
    if metadata.len() == 0 {
        return Err("background file cannot be empty".into());
    }
    let kind = custom_background_kind_for_name(original_name)?;
    let limit = custom_background_max_bytes(kind);
    if metadata.len() > limit {
        return Err(format!(
            "background file exceeds {} MiB limit",
            limit / 1024 / 1024
        ));
    }

    let extension = extension_for(original_name)?;
    let bytes = read_prefix(path, MAX_SHADER_BYTES + 1)?;
    match kind {
        CustomBackgroundKind::Image if !validate_image_signature(&extension, &bytes) => {
            return Err("image contents do not match its file extension".into());
        }
        CustomBackgroundKind::Video if !validate_video_signature(&extension, &bytes) => {
            return Err("video contents do not match its file extension".into());
        }
        CustomBackgroundKind::Shader => {
            let source = std::str::from_utf8(&bytes)
                .map_err(|_| "shader must contain valid UTF-8 text".to_string())?;
            if bytes.len() > MAX_SHADER_BYTES as usize {
                return Err("shader exceeds 256 KiB limit".into());
            }
            if !source.contains("void main") {
                return Err("shader must define void main()".into());
            }
        }
        _ => {}
    }
    Ok((kind, extension))
}

fn validate_remote_url(value: &str) -> Result<Url, String> {
    let value = value.trim();
    if value.chars().count() > MAX_URL_CHARS {
        return Err(format!(
            "background URL cannot exceed {MAX_URL_CHARS} characters"
        ));
    }
    let url = Url::parse(value).map_err(|error| format!("invalid background URL: {error}"))?;
    if url.scheme() != "https" {
        return Err("background URL must use HTTPS".into());
    }
    if url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
        return Err("background URL must not contain credentials and must include a host".into());
    }
    Ok(url)
}

fn managed_path(file_name: &str) -> Result<PathBuf, String> {
    let path = Path::new(file_name);
    let mut components = path.components();
    let single_normal_component =
        matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none();
    if !single_normal_component
        || path.file_name().and_then(|name| name.to_str()) != Some(file_name)
    {
        return Err("invalid managed background file name".into());
    }
    Ok(backgrounds_dir().join(path))
}

pub fn import_custom_background_file(
    source_path: PathBuf,
    original_name: String,
    name: String,
) -> Result<AppConfig, String> {
    let name = normalized_name(&name)?;
    let (background_type, extension) = validate_file(&source_path, &original_name)?;
    let id = format!("{:032x}", rand::random::<u128>());
    let file_name = format!("{id}.{extension}");
    let directory = backgrounds_dir();
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("failed creating backgrounds directory: {error}"))?;
    let destination = directory.join(&file_name);
    std::fs::copy(&source_path, &destination)
        .map_err(|error| format!("failed importing background: {error}"))?;

    let mut config = AppConfig::load();
    config.custom_backgrounds.push(CustomBackground {
        id,
        name,
        background_type,
        source: CustomBackgroundSource::Managed { file_name },
    });
    config.save();
    Ok(config)
}

pub fn add_custom_background_url(name: String, url: String) -> Result<AppConfig, String> {
    let url = validate_remote_url(&url)?;
    let background_type = custom_background_kind_for_name(url.path())?;
    let mut config = AppConfig::load();
    config.custom_backgrounds.push(CustomBackground {
        id: format!("{:032x}", rand::random::<u128>()),
        name: normalized_name(&name)?,
        background_type,
        source: CustomBackgroundSource::Url { url: url.into() },
    });
    config.save();
    Ok(config)
}

pub fn remove_custom_background(id: &str) -> Result<AppConfig, String> {
    let mut config = AppConfig::load();
    let index = config
        .custom_backgrounds
        .iter()
        .position(|background| background.id == id)
        .ok_or_else(|| "custom background not found".to_string())?;
    let background = config.custom_backgrounds.remove(index);
    if let CustomBackgroundSource::Managed { file_name } = background.source {
        let path = managed_path(&file_name)?;
        if path.exists() {
            std::fs::remove_file(path)
                .map_err(|error| format!("failed deleting background file: {error}"))?;
        }
    }
    if matches!(
        config.last_background.as_ref(),
        Some(BackgroundSelection::Custom { id: selected }) if selected == id
    ) {
        config.last_background = None;
    }
    config.save();
    Ok(config)
}

fn managed_background(id: &str) -> Result<(CustomBackgroundKind, PathBuf), String> {
    let config = AppConfig::load();
    let background = config
        .custom_backgrounds
        .iter()
        .find(|background| background.id == id)
        .ok_or_else(|| "custom background not found".to_string())?;
    let CustomBackgroundSource::Managed { file_name } = &background.source else {
        return Err("linked background does not have a managed file".into());
    };
    let path = managed_path(file_name)?;
    if !path.is_file() {
        return Err("managed background file is missing".into());
    }
    Ok((background.background_type, path))
}

pub fn resolve_custom_background_path(id: &str) -> Result<String, String> {
    let (_, path) = managed_background(id)?;
    Ok(path.to_string_lossy().into_owned())
}

pub fn load_custom_background_shader(id: &str) -> Result<String, String> {
    let (kind, path) = managed_background(id)?;
    if kind != CustomBackgroundKind::Shader {
        return Err("custom background is not a shader".into());
    }
    std::fs::read_to_string(path).map_err(|error| format!("failed reading shader: {error}"))
}
