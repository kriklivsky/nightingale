use app_core::AppConfig;

#[tauri::command]
pub(crate) async fn import_custom_background(
    path: String,
    original_name: String,
    name: String,
) -> Result<AppConfig, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app_core::import_custom_background_file(path.into(), original_name, name)
    })
    .await
    .map_err(|error| format!("Background import task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn add_custom_background_url(
    name: String,
    url: String,
) -> Result<AppConfig, String> {
    tauri::async_runtime::spawn_blocking(move || app_core::add_custom_background_url(name, url))
        .await
        .map_err(|error| format!("Background task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn remove_custom_background(id: String) -> Result<AppConfig, String> {
    tauri::async_runtime::spawn_blocking(move || app_core::remove_custom_background(&id))
        .await
        .map_err(|error| format!("Background task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn resolve_custom_background_path(id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || app_core::resolve_custom_background_path(&id))
        .await
        .map_err(|error| format!("Background task failed: {error}"))?
}

#[tauri::command]
pub(crate) async fn load_custom_background_shader(id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || app_core::load_custom_background_shader(&id))
        .await
        .map_err(|error| format!("Background task failed: {error}"))?
}
