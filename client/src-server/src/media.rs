use std::path::{Path, PathBuf};

use axum::{
    body::Body,
    extract::{Path as AxumPath, Query, State},
    http::{header, HeaderMap, HeaderValue, Request, Response, StatusCode},
};
use serde::Deserialize;
use tower::ServiceExt;
use tower_http::services::ServeFile;

use crate::state::AppState;

/// Resolved-and-canonicalised view of a candidate media path. Constructing it
/// guarantees the final path lives inside the data dir, so the caller can
/// hand it to `ServeFile` without worrying about path-traversal.
struct ResolvedPath(PathBuf);

impl ResolvedPath {
    fn resolve(input: &Path) -> Option<Self> {
        app_core::resolve_media_path(input).map(Self)
    }
}

#[derive(Deserialize)]
pub(crate) struct AssetQuery {
    path: String,
}

/// Path-keyed file route used for media that does not have a stable hash key
/// (Pixabay backgrounds, ffmpeg-transcoded source videos, etc.). Every path
/// is canonicalised against the allowed roots before serving.
pub(crate) async fn handle_asset(
    State(_state): State<AppState>,
    Query(query): Query<AssetQuery>,
    headers: HeaderMap,
    request: Request<Body>,
) -> Response<Body> {
    serve(query.path.as_ref(), headers, request).await
}

/// Hash-keyed route for song stems and source video. The browser never sees
/// the underlying filesystem path; `kind` controls which `app-core` helper
/// resolves the path on the server.
pub(crate) async fn handle_hashed(
    State(_state): State<AppState>,
    AxumPath((hash, kind)): AxumPath<(String, String)>,
    headers: HeaderMap,
    request: Request<Body>,
) -> Response<Body> {
    let path = match tokio::task::spawn_blocking(move || match kind.as_str() {
        "instrumental" => Some(app_core::get_audio_paths(&hash).instrumental),
        "vocals" => app_core::get_audio_paths(&hash).vocals,
        "source-video" | "video" => app_core::ensure_playable_source_video(&hash).ok().flatten(),
        _ => None,
    })
    .await
    {
        Ok(path) => path,
        Err(_) => {
            return response(
                StatusCode::INTERNAL_SERVER_ERROR,
                Body::from("media operation interrupted"),
            )
        }
    };

    let Some(path) = path else {
        return not_found("unknown media kind");
    };

    serve(Path::new(&path), headers, request).await
}

async fn serve(path: &Path, _headers: HeaderMap, request: Request<Body>) -> Response<Body> {
    let path = path.to_path_buf();
    let resolved = match tokio::task::spawn_blocking(move || ResolvedPath::resolve(&path)).await {
        Ok(Some(resolved)) => resolved,
        Ok(None) => return not_found("media path not found or outside data dir"),
        Err(_) => {
            return response(
                StatusCode::INTERNAL_SERVER_ERROR,
                Body::from("media operation interrupted"),
            )
        }
    };

    let serve = ServeFile::new(&resolved.0);
    match serve.oneshot(request).await {
        Ok(response) => annotate_audio(response.map(Body::new)),
        Err(e) => {
            tracing::warn!("media serve error: {e}");
            response(
                StatusCode::INTERNAL_SERVER_ERROR,
                Body::from("failed to serve media"),
            )
        }
    }
}

/// `ServeFile` already sets `Accept-Ranges` and `Content-Range`, but it omits
/// `Cache-Control` and a no-sniff hint we want for browser-cached audio.
fn annotate_audio(mut response: Response<Body>) -> Response<Body> {
    let headers = response.headers_mut();
    headers
        .entry(header::CACHE_CONTROL)
        .or_insert_with(|| HeaderValue::from_static("private, max-age=300"));
    headers
        .entry(header::X_CONTENT_TYPE_OPTIONS)
        .or_insert_with(|| HeaderValue::from_static("nosniff"));
    response
}

fn response(status: StatusCode, body: Body) -> Response<Body> {
    let mut response = Response::new(body);
    *response.status_mut() = status;
    response
}

fn not_found(reason: &str) -> Response<Body> {
    response(StatusCode::NOT_FOUND, Body::from(reason.to_string()))
}
