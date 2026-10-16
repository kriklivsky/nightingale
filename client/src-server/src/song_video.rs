use axum::http::{HeaderMap, StatusCode};
use serde::Deserialize;
use serde_json::Value;

use crate::commands::{ApiError, CmdResult};

pub(crate) fn authorize(headers: &HeaderMap) -> Result<(), ApiError> {
    let token = std::env::var("NIGHTINGALE_VIDEO_TOKEN")
        .ok()
        .filter(|token| {
            (32..=256).contains(&token.len()) && token.bytes().all(|byte| byte.is_ascii_graphic())
        });
    let Some(token) = token else {
        return Err(ApiError(StatusCode::FORBIDDEN, "YouTube access is disabled on this server. Configure NIGHTINGALE_VIDEO_TOKEN (32–256 characters).".into()));
    };
    let received = headers
        .get("Authorization")
        .and_then(|header| header.to_str().ok())
        .and_then(|header| header.strip_prefix("Bearer "))
        .unwrap_or("");
    if received.len() != token.len()
        || received
            .bytes()
            .zip(token.bytes())
            .fold(0u8, |difference, (left, right)| difference | (left ^ right))
            != 0
    {
        return Err(ApiError(
            StatusCode::UNAUTHORIZED,
            "Enter the server's YouTube access token.".into(),
        ));
    }
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VideoArgs {
    file_hash: String,
    #[serde(default)]
    title_only: bool,
    #[serde(default)]
    video_id: String,
    #[serde(default)]
    offset_sec: Option<f64>,
}

pub(crate) async fn dispatch(name: &str, payload: Value) -> CmdResult {
    let args: VideoArgs = serde_json::from_value(payload)
        .map_err(|_| ApiError(StatusCode::BAD_REQUEST, "Invalid video arguments".into()))?;
    let name = name.to_string();
    tokio::task::spawn_blocking(move || {
        let result = match name.as_str() {
            "get_song_video" => serde_json::to_value(app_core::get_song_video(&args.file_hash)?),
            "search_song_videos" => serde_json::to_value(app_core::search_song_videos(
                &args.file_hash,
                args.title_only,
            )?),
            "download_song_video" => serde_json::to_value(app_core::download_song_video(
                &args.file_hash,
                &args.video_id,
            )?),
            "set_song_video_offset" => serde_json::to_value(app_core::set_song_video_offset(
                &args.file_hash,
                args.offset_sec
                    .ok_or_else(|| "Video offset is required".to_string())?,
            )?),
            "remove_song_video" => {
                app_core::remove_song_video(&args.file_hash)?;
                Ok(Value::Null)
            }
            _ => return Err("Unknown video command".to_string()),
        };
        result.map_err(|_| "Cannot encode video response".to_string())
    })
    .await
    .map_err(|_| {
        ApiError(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Video operation interrupted".into(),
        )
    })?
    .map_err(|message| ApiError(StatusCode::BAD_REQUEST, message))
}
