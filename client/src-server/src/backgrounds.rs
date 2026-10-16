use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use app_core::AppConfig;
use axum::extract::{multipart::Field, Multipart};
use axum::http::{header, HeaderMap, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::Json;
use tokio::io::AsyncWriteExt;

const MAX_TEXT_FIELD_BYTES: usize = 1024;
static UPLOAD_COUNTER: AtomicU64 = AtomicU64::new(0);

pub(crate) struct UploadError(StatusCode, String);

impl UploadError {
    fn bad_request(message: impl Into<String>) -> Self {
        Self(StatusCode::BAD_REQUEST, message.into())
    }

    fn internal(message: impl Into<String>) -> Self {
        Self(StatusCode::INTERNAL_SERVER_ERROR, message.into())
    }
}

impl IntoResponse for UploadError {
    fn into_response(self) -> Response {
        (self.0, self.1).into_response()
    }
}

struct TemporaryUpload {
    path: PathBuf,
}

impl TemporaryUpload {
    fn new() -> Self {
        Self {
            path: std::env::temp_dir()
                .join(format!("nightingale-background-{:032x}.upload", rand_id())),
        }
    }
}

impl Drop for TemporaryUpload {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

fn rand_id() -> u128 {
    use std::time::{SystemTime, UNIX_EPOCH};

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let sequence = u128::from(UPLOAD_COUNTER.fetch_add(1, Ordering::Relaxed));
    nanos ^ (sequence << 64) ^ u128::from(std::process::id())
}

fn require_same_origin(headers: &HeaderMap) -> Result<(), UploadError> {
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| UploadError::bad_request("upload requires a same-origin request"))?;
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| UploadError::bad_request("upload request is missing Host"))?;
    let uri = origin
        .parse::<Uri>()
        .map_err(|_| UploadError::bad_request("upload Origin is invalid"))?;
    if uri.authority().map(|authority| authority.as_str()) != Some(host) {
        return Err(UploadError::bad_request(
            "cross-origin background uploads are not allowed",
        ));
    }
    Ok(())
}

async fn read_small_text(mut field: Field<'_>) -> Result<String, UploadError> {
    let mut bytes = Vec::new();
    while let Some(chunk) = field
        .chunk()
        .await
        .map_err(|error| UploadError::bad_request(format!("invalid form field: {error}")))?
    {
        if bytes.len() + chunk.len() > MAX_TEXT_FIELD_BYTES {
            return Err(UploadError::bad_request("form field is too long"));
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|_| UploadError::bad_request("form field must be UTF-8"))
}

pub(crate) async fn handle_upload(
    headers: HeaderMap,
    mut multipart: Multipart,
) -> Result<Json<AppConfig>, UploadError> {
    require_same_origin(&headers)?;

    let mut name = None;
    let mut original_name = None;
    let mut temporary = None;

    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|error| UploadError::bad_request(format!("invalid upload: {error}")))?
    {
        match field.name() {
            Some("name") => name = Some(read_small_text(field).await?),
            Some("file") => {
                if temporary.is_some() {
                    return Err(UploadError::bad_request("upload must contain one file"));
                }
                let file_name = field
                    .file_name()
                    .map(str::to_string)
                    .ok_or_else(|| UploadError::bad_request("uploaded file needs a name"))?;
                let file_limit = app_core::custom_background_kind_for_name(&file_name)
                    .map(app_core::custom_background_max_bytes)
                    .map_err(UploadError::bad_request)?;
                let upload = TemporaryUpload::new();
                let mut output = tokio::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&upload.path)
                    .await
                    .map_err(|error| {
                        UploadError::internal(format!("failed creating upload: {error}"))
                    })?;
                let mut size = 0_u64;
                while let Some(chunk) = field.chunk().await.map_err(|error| {
                    UploadError::bad_request(format!("invalid upload data: {error}"))
                })? {
                    size = size.saturating_add(chunk.len() as u64);
                    if size > file_limit {
                        return Err(UploadError::bad_request(
                            "background upload exceeds the limit for its type",
                        ));
                    }
                    output.write_all(&chunk).await.map_err(|error| {
                        UploadError::internal(format!("failed writing upload: {error}"))
                    })?;
                }
                output.flush().await.map_err(|error| {
                    UploadError::internal(format!("failed finishing upload: {error}"))
                })?;
                original_name = Some(file_name);
                temporary = Some(upload);
            }
            _ => {}
        }
    }

    let upload = temporary.ok_or_else(|| UploadError::bad_request("upload file is required"))?;
    let original_name =
        original_name.ok_or_else(|| UploadError::bad_request("uploaded file needs a name"))?;
    let name = name.ok_or_else(|| UploadError::bad_request("background name is required"))?;
    let upload_path = upload.path.clone();
    let imported = tokio::task::spawn_blocking(move || {
        app_core::import_custom_background_file(upload_path, original_name, name)
    })
    .await
    .map_err(|error| UploadError::internal(format!("background import task failed: {error}")))?;
    let config = imported.map_err(UploadError::bad_request)?;

    Ok(Json(config))
}
