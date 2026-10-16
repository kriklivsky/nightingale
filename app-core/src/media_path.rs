use std::path::{Path, PathBuf};

use crate::{AppConfig, LibrarySource, default_nightingale_dir, nightingale_dir};

pub fn resolve_media_path(input: &Path) -> Option<PathBuf> {
    let canonical = std::fs::canonicalize(input).ok()?;
    if !canonical.is_file() {
        return None;
    }
    let config = AppConfig::load();
    let mut roots = vec![
        nightingale_dir(),
        default_nightingale_dir(),
        config.effective_data_path(),
    ];
    if let Some(LibrarySource::Folder { path }) = config.library_source {
        roots.push(path);
    }
    if let Some(paths) = config.cache_paths {
        roots.extend([paths.songs, paths.videos].into_iter().flatten());
    }
    roots
        .into_iter()
        .filter_map(|root| std::fs::canonicalize(root).ok())
        .any(|root| canonical.starts_with(root))
        .then_some(canonical)
}
