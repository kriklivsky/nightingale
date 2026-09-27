use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::analyzer::{AnalysisQueue, QueuedStatus};
use crate::cache::CacheDir;
use crate::config::{AppConfig, LibrarySource};
use crate::library_db;
use crate::song::{Song, SongOrigin};
use crate::usdx;

fn existing_local_file(path: &Path, root: &Path) -> Result<Option<PathBuf>, String> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Cannot inspect {}: {error}", path.display())),
    };
    if !metadata.file_type().is_file() {
        return Err(format!("Not a regular file: {}", path.display()));
    }

    let canonical = std::fs::canonicalize(path)
        .map_err(|error| format!("Cannot resolve {}: {error}", path.display()))?;
    if !canonical.starts_with(root) {
        return Err(format!(
            "Refusing to delete a file outside the library: {}",
            path.display()
        ));
    }
    Ok(Some(canonical))
}

fn referenced_paths(song: &Song) -> Result<Vec<PathBuf>, String> {
    if song.usdx.is_some() {
        usdx::referenced_files(&song.path).map_err(|error| {
            format!(
                "Cannot read UltraStar file {}: {error}",
                song.path.display()
            )
        })
    } else {
        Ok(vec![song.path.clone()])
    }
}

fn other_references(song: &Song) -> Vec<PathBuf> {
    if let Some(bundle) = &song.usdx {
        usdx::referenced_files(&song.path).unwrap_or_else(|_| {
            let mut paths = vec![song.path.clone(), bundle.audio.clone()];
            paths.extend(
                [
                    bundle.vocals.clone(),
                    bundle.instrumental.clone(),
                    bundle.video.clone(),
                ]
                .into_iter()
                .flatten(),
            );
            paths
        })
    } else {
        vec![song.path.clone()]
    }
}

fn rollback_staged(staged: &[(PathBuf, PathBuf)]) -> String {
    let failures: Vec<_> = staged
        .iter()
        .rev()
        .filter_map(|(original, temporary)| {
            std::fs::rename(temporary, original)
                .err()
                .map(|error| format!("{}: {error}", original.display()))
        })
        .collect();
    if failures.is_empty() {
        String::new()
    } else {
        format!("; rollback failed for {}", failures.join(", "))
    }
}

fn stage_files(targets: &[PathBuf]) -> Result<Vec<(PathBuf, PathBuf)>, String> {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let mut staged = Vec::new();
    for (index, original) in targets.iter().enumerate() {
        let temporary = original.with_file_name(format!(
            ".nightingale-delete-{}-{nonce}-{index}",
            std::process::id()
        ));
        if temporary.symlink_metadata().is_ok() {
            let rollback = rollback_staged(&staged);
            return Err(format!(
                "Temporary deletion path already exists: {}{rollback}",
                temporary.display()
            ));
        }
        if let Err(error) = std::fs::rename(original, &temporary) {
            let rollback = rollback_staged(&staged);
            return Err(format!(
                "Cannot prepare {} for deletion: {error}{rollback}",
                original.display()
            ));
        }
        staged.push((original.clone(), temporary));
    }
    Ok(staged)
}

pub fn delete_local_song(file_hash: &str, path: &Path) -> Result<(), String> {
    let Some(LibrarySource::Folder { path: folder }) = AppConfig::load().library_source else {
        return Err("Only songs in a local folder can be deleted".to_string());
    };
    let root = std::fs::canonicalize(&folder)
        .map_err(|error| format!("Cannot resolve library folder: {error}"))?;
    let song = library_db::load_song_by_hash_and_path(file_hash, path)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "Song is no longer in the library".to_string())?;
    if song.origin != SongOrigin::LocalFile {
        return Err("Remote songs cannot be deleted from disk".to_string());
    }
    if matches!(
        AnalysisQueue::load().entries.get(file_hash),
        Some(QueuedStatus::Queued | QueuedStatus::Analyzing(_))
    ) {
        return Err("Wait until song analysis finishes before deleting it".to_string());
    }

    let mut targets = Vec::new();
    let mut unique = HashSet::new();
    for path in referenced_paths(&song)? {
        match existing_local_file(&path, &root)? {
            Some(canonical) if unique.insert(canonical.clone()) => targets.push(canonical),
            _ => {}
        }
    }
    let source = existing_local_file(&song.path, &root)?
        .ok_or_else(|| "Song file is missing; rescan the library".to_string())?;
    if !unique.contains(&source) {
        return Err("Song file is missing from the deletion set".to_string());
    }

    for other in library_db::load_all_songs().map_err(|error| error.to_string())? {
        if other.path == song.path || other.origin != SongOrigin::LocalFile {
            continue;
        }
        for reference in other_references(&other) {
            if let Some(shared) = existing_local_file(&reference, &root)?
                && unique.contains(&shared)
            {
                return Err(format!(
                    "Cannot delete {}: it is also used by {}",
                    shared.display(),
                    other.title
                ));
            }
        }
    }

    let staged = match stage_files(&targets) {
        Ok(staged) => staged,
        Err(error) => {
            crate::scanner::start_scan();
            return Err(error);
        }
    };

    let deleted = match library_db::delete_song_by_hash_and_path(file_hash, path) {
        Ok(true) => true,
        Ok(false) => false,
        Err(error) => {
            let rollback = rollback_staged(&staged);
            crate::scanner::start_scan();
            return Err(format!(
                "Cannot update library after deletion: {error}{rollback}"
            ));
        }
    };
    if !deleted {
        let rollback = rollback_staged(&staged);
        crate::scanner::start_scan();
        return Err(format!("Song changed during deletion{rollback}"));
    }

    let mut failures = Vec::new();
    for (_, temporary) in &staged {
        if let Err(error) = std::fs::remove_file(temporary) {
            failures.push(format!("{}: {error}", temporary.display()));
        }
    }
    if !failures.is_empty() {
        crate::scanner::start_scan();
        return Err(format!(
            "Song was removed from the library, but some staged files remain on disk: {}",
            failures.join(", ")
        ));
    }

    match library_db::load_song_by_hash(file_hash) {
        Ok(None) => CacheDir::new().delete_song_cache(file_hash),
        Err(error) => tracing::warn!("Cannot check deleted song cache: {error}"),
        Ok(Some(_)) => {}
    };
    crate::scanner::start_scan();
    Ok(())
}
