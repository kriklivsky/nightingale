use rusqlite::{OptionalExtension, params};

use super::connection::{with_conn, with_conn_mut};

pub(crate) fn load_favorite_hashes() -> rusqlite::Result<Vec<String>> {
    with_conn(|conn| {
        let mut statement = conn.prepare(
            "SELECT DISTINCT favorite_songs.file_hash
             FROM favorite_songs
             JOIN songs ON songs.file_hash = favorite_songs.file_hash
             ORDER BY favorite_songs.file_hash",
        )?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        rows.collect()
    })
}

pub(crate) fn set_song_favorite(file_hash: &str, favorite: bool) -> rusqlite::Result<bool> {
    with_conn_mut(|conn| {
        let song_exists = conn
            .query_row(
                "SELECT 1 FROM songs WHERE file_hash = ?1 LIMIT 1",
                [file_hash],
                |row| row.get::<_, i32>(0),
            )
            .optional()?
            .is_some();
        if !song_exists {
            return Ok(false);
        }

        if favorite {
            conn.execute(
                "INSERT OR IGNORE INTO favorite_songs (file_hash) VALUES (?1)",
                params![file_hash],
            )?;
        } else {
            conn.execute(
                "DELETE FROM favorite_songs WHERE file_hash = ?1",
                params![file_hash],
            )?;
        }
        Ok(true)
    })
}
