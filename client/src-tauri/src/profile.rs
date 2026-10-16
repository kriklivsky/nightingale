use app_core::ProfileStore;

#[tauri::command]
pub(crate) fn load_profiles() -> ProfileStore {
    ProfileStore::load()
}

#[tauri::command]
pub(crate) fn create_profile(name: String) {
    let mut profile_store = ProfileStore::load();

    profile_store.create_profile(name);
}

#[tauri::command]
pub(crate) fn switch_profile(name: String) {
    let mut profile_store = ProfileStore::load();

    profile_store.switch_profile(&name);
}

#[tauri::command]
pub(crate) fn delete_profile(name: String) {
    let mut profile_store = ProfileStore::load();

    profile_store.delete_profile(&name);
}

#[tauri::command]
pub(crate) fn add_score(song_hash: String, score: u32, profile: Option<String>) {
    let mut profile_store = ProfileStore::load();

    profile_store.add_score(&song_hash, score, profile.as_deref());
}

#[tauri::command]
pub(crate) async fn add_scores(
    song_hash: String,
    scores: Vec<(String, u32)>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        ProfileStore::load().add_scores(&song_hash, &scores)
    })
    .await
    .map_err(|error| format!("Score saving task failed: {error}"))?
}
