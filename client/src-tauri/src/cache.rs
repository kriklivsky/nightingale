use app_core::{clear_models, clear_videos, CacheStats};

#[tauri::command]
pub(crate) async fn calculate_cache_stats() -> Result<CacheStats, String> {
    tauri::async_runtime::spawn_blocking(CacheStats::calculate)
        .await
        .map_err(|_| "Cache calculation interrupted. Try again.".to_string())
}

#[tauri::command]
pub(crate) async fn clear_videos_command() -> Result<(), String> {
    clear_cache(clear_videos).await
}

#[tauri::command]
pub(crate) async fn clear_models_command() -> Result<(), String> {
    clear_cache(clear_models).await
}

#[tauri::command]
pub(crate) async fn clear_all() -> Result<(), String> {
    clear_cache(|| {
        clear_models();
        clear_videos();
    })
    .await
}

async fn clear_cache(operation: impl FnOnce() + Send + 'static) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| "Cache cleanup interrupted. Try again.".to_string())
}
