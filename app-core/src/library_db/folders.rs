use std::collections::BTreeMap;

use rusqlite::Connection;

use crate::library_menu::LibraryMenuItem;

pub(super) fn load(connection: &Connection) -> rusqlite::Result<Vec<LibraryMenuItem>> {
    let root: String =
        connection.query_row("SELECT folder FROM library_meta WHERE id = 1", [], |row| {
            row.get(0)
        })?;
    let root = root.trim_end_matches(['/', '\\']);
    if root.is_empty() {
        return Ok(Vec::new());
    }

    let mut statement = connection.prepare(
        "SELECT s.path, s.is_analyzed, aq.status FROM songs s
         LEFT JOIN analysis_queue aq ON aq.file_hash = s.file_hash",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, bool>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })?;
    let mut folders = BTreeMap::<Vec<(String, String)>, LibraryMenuItem>::new();
    for row in rows {
        let (path, analyzed, status) = row?;
        let Some(rest) = path
            .strip_prefix(root)
            .filter(|rest| rest.starts_with(['/', '\\']))
        else {
            continue;
        };
        let offset = path.len() - rest.len() + 1;
        let mut start = offset;
        let mut key = Vec::new();
        for (index, character) in path[offset..].char_indices() {
            if !['/', '\\'].contains(&character) {
                continue;
            }
            let end = offset + index;
            if end > start {
                let name = &path[start..end];
                key.push((name.to_lowercase(), name.to_string()));
                let item = folders
                    .entry(key.clone())
                    .or_insert_with(|| LibraryMenuItem {
                        value: path[..=end].to_string(),
                        label: name.to_string(),
                        depth: Some((key.len() - 1) as u32),
                        count: 0,
                        analysed_count: 0,
                        queued_count: 0,
                        analysing_count: 0,
                    });
                item.count += 1;
                item.analysed_count += u64::from(analyzed);
                item.queued_count += u64::from(status.as_deref() == Some("queued"));
                item.analysing_count += u64::from(status.as_deref() == Some("analyzing"));
            }
            start = end + 1;
        }
    }
    Ok(folders.into_values().collect())
}
