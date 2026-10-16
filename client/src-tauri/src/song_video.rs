use app_core::{SongVideo, VideoCandidate};

async fn blocking<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| "Video operation interrupted".to_string())?
}

#[tauri::command]
pub(crate) async fn get_song_video(file_hash: String) -> Result<Option<SongVideo>, String> {
    blocking(move || app_core::get_song_video(&file_hash)).await
}

#[tauri::command]
pub(crate) async fn search_song_videos(
    file_hash: String,
    title_only: bool,
) -> Result<Vec<VideoCandidate>, String> {
    blocking(move || app_core::search_song_videos(&file_hash, title_only)).await
}

#[tauri::command]
pub(crate) async fn download_song_video(
    file_hash: String,
    video_id: String,
) -> Result<SongVideo, String> {
    blocking(move || app_core::download_song_video(&file_hash, &video_id)).await
}

#[tauri::command]
pub(crate) async fn set_song_video_offset(
    file_hash: String,
    offset_sec: f64,
) -> Result<SongVideo, String> {
    blocking(move || app_core::set_song_video_offset(&file_hash, offset_sec)).await
}

#[tauri::command]
pub(crate) async fn remove_song_video(file_hash: String) -> Result<(), String> {
    blocking(move || app_core::remove_song_video(&file_hash)).await
}
