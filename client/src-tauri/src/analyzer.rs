use app_core::{
    cancel_analysis as core_cancel_analysis, delete_cache as core_delete_cache,
    enqueue as core_enqueue, realign as core_realign,
    reanalyze_force_transcribe as core_reanalyze_force_transcribe,
    reanalyze_full as core_reanalyze_full, reanalyze_transcript as core_reanalyze_transcript,
    refresh_metadata as core_refresh_metadata, shift_key_done_payload, shift_tempo_done_payload,
    SongTarget,
};
use tauri::{AppHandle, Emitter};

#[tauri::command]
pub(crate) async fn enqueue(target: SongTarget) -> Result<usize, String> {
    run_action(move || core_enqueue(target)).await
}

#[tauri::command]
pub(crate) async fn cancel_analysis(target: SongTarget) -> Result<usize, String> {
    run_action(move || core_cancel_analysis(target)).await
}

#[tauri::command]
pub(crate) async fn delete_song_cache(target: SongTarget) -> Result<usize, String> {
    run_action(move || core_delete_cache(target)).await
}

#[tauri::command]
pub(crate) async fn reanalyze_transcript(
    target: SongTarget,
    language: Option<String>,
) -> Result<usize, String> {
    run_action(move || core_reanalyze_transcript(target, language)).await
}

#[tauri::command]
pub(crate) async fn reanalyze_full(target: SongTarget) -> Result<usize, String> {
    run_action(move || core_reanalyze_full(target)).await
}

#[tauri::command]
pub(crate) async fn realign(target: SongTarget, language: Option<String>) -> Result<usize, String> {
    run_action(move || core_realign(target, language)).await
}

#[tauri::command]
pub(crate) fn reanalyze_force_transcribe(target: SongTarget) -> Result<usize, String> {
    core_reanalyze_force_transcribe(target)
}

#[tauri::command]
pub(crate) async fn refresh_metadata(target: SongTarget) -> Result<usize, String> {
    run_action(move || core_refresh_metadata(target)).await
}

async fn run_action<F>(operation: F) -> Result<usize, String>
where
    F: FnOnce() -> Result<usize, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| "Analysis request interrupted. Try again.".to_string())?
}

#[tauri::command]
pub(crate) fn shift_key(
    app: AppHandle,
    file_hash: String,
    key: String,
    pitch_ratio: f64,
    key_offset: i32,
) {
    std::thread::spawn(move || {
        let payload = shift_key_done_payload(file_hash, key, pitch_ratio, key_offset);
        let _ = app.emit("shift-key-done", payload);
    });
}

#[tauri::command]
pub(crate) fn shift_tempo(app: AppHandle, file_hash: String, tempo: f64) {
    std::thread::spawn(move || {
        let payload = shift_tempo_done_payload(file_hash, tempo);
        let _ = app.emit("shift-tempo-done", payload);
    });
}
