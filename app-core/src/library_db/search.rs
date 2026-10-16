use rusqlite::{Connection, functions::FunctionFlags};
use unicode_normalization::{UnicodeNormalization, char::is_combining_mark};

fn fold(input: &str) -> String {
    input
        .to_lowercase()
        .nfd()
        .filter(|character| !is_combining_mark(*character))
        .map(|character| if character == 'ё' { 'е' } else { character })
        .collect()
}

pub(super) fn register(connection: &Connection) -> rusqlite::Result<()> {
    connection.create_scalar_function(
        "nightingale_fold",
        1,
        FunctionFlags::SQLITE_UTF8
            | FunctionFlags::SQLITE_DETERMINISTIC
            | FunctionFlags::SQLITE_INNOCUOUS,
        |context| Ok(fold(&context.get::<String>(0)?)),
    )
}

fn escape_like_pattern(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    for character in input.chars() {
        if matches!(character, '%' | '_' | '\\') {
            output.push('\\');
        }
        output.push(character);
    }
    output
}

pub(super) fn search_words_from_query(query: &str) -> Option<Vec<String>> {
    let words: Vec<_> = fold(query)
        .split_whitespace()
        .map(escape_like_pattern)
        .collect();
    if words.is_empty() { None } else { Some(words) }
}

pub(super) fn songs_where_like_words(words: &[String]) -> (String, Vec<String>) {
    let mut bindings = Vec::new();
    let mut clauses = Vec::new();
    for word in words {
        clauses.push(
            "(nightingale_fold(s.title) LIKE ('%' || ? || '%') ESCAPE '\\' OR \
             nightingale_fold(s.artist) LIKE ('%' || ? || '%') ESCAPE '\\' OR \
             nightingale_fold(s.album) LIKE ('%' || ? || '%') ESCAPE '\\' OR \
             nightingale_fold(s.path) LIKE ('%' || ? || '%') ESCAPE '\\')",
        );
        bindings.extend(std::iter::repeat_n(word.clone(), 4));
    }
    (clauses.join(" AND "), bindings)
}
