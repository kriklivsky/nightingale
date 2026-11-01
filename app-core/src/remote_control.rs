//! Settings for the LAN remote control, read from `remote-control.json` next to
//! `config.json`. The file is the opt-in: without it no listener is started.
//! The password is kept in the same at-rest envelope as provider credentials;
//! a hand-written plaintext password is re-encrypted on first load. Signed-in
//! browsers hold a random session token; sessions live in memory only.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};

use crate::cache::default_nightingale_dir;
use crate::secret;

const DEFAULT_PORT: u16 = 8090;
const MAX_FILE_BYTES: u64 = 4096;
const MAX_SESSIONS: usize = 32;
const MAX_TOKEN_BYTES: usize = 128;
pub const REMOTE_SESSION_LIFETIME: Duration = Duration::from_secs(30 * 24 * 60 * 60);

#[derive(Serialize, Deserialize)]
struct StoredSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    port: Option<u16>,
    username: String,
    password: String,
}

pub struct RemoteControlSettings {
    pub port: u16,
    pub username: String,
    username_hash: blake3::Hash,
    password_hash: blake3::Hash,
    sessions: Mutex<HashMap<blake3::Hash, Instant>>,
}

fn settings_path() -> PathBuf {
    default_nightingale_dir().join("remote-control.json")
}

fn valid_username(value: &str) -> bool {
    (1..=64).contains(&value.chars().count())
        && !value.contains(':')
        && !value.chars().any(char::is_control)
}

fn valid_password(value: &str) -> bool {
    (8..=128).contains(&value.chars().count()) && !value.chars().any(char::is_control)
}

fn write_settings(path: &Path, stored: &StoredSettings) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(stored)
        .map_err(|_| "Cannot encode remote control settings".to_string())?;
    let temporary = path.with_extension(format!("{:016x}.tmp", rand::random::<u64>()));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = options
        .open(&temporary)
        .and_then(|mut file| file.write_all(&bytes).and_then(|()| file.sync_all()))
        .and_then(|()| std::fs::rename(&temporary, path));
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result.map_err(|_| "Cannot save remote control settings".to_string())
}

impl RemoteControlSettings {
    /// `Ok(None)` when the remote control is not configured.
    pub fn load() -> Result<Option<Self>, String> {
        let path = settings_path();
        let file = match std::fs::File::open(&path) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err("Cannot read remote control settings".into()),
        };
        let mut bytes = Vec::new();
        file.take(MAX_FILE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "Cannot read remote control settings".to_string())?;
        if bytes.len() as u64 > MAX_FILE_BYTES {
            return Err("Remote control settings file is too large".into());
        }
        let mut stored: StoredSettings = serde_json::from_slice(&bytes)
            .map_err(|_| "Invalid remote control settings".to_string())?;
        let password = secret::decrypt_string(&stored.password);
        if password.is_empty() && secret::is_encrypted(&stored.password) {
            return Err(
                "Cannot decrypt the remote control password; write it again as plain text".into(),
            );
        }
        if !valid_username(&stored.username) {
            return Err("Remote control username must be 1-64 characters without ':'".into());
        }
        if !valid_password(&password) {
            return Err("Remote control password must be 8-128 characters".into());
        }
        let port = stored.port.unwrap_or(DEFAULT_PORT);
        if port == 0 {
            return Err("Remote control port must not be 0".into());
        }
        if !secret::is_encrypted(&stored.password) {
            stored.password = secret::encrypt_string(&password);
            write_settings(&path, &stored)?;
        }
        Ok(Some(Self {
            port,
            username_hash: blake3::hash(stored.username.as_bytes()),
            username: stored.username,
            password_hash: blake3::hash(password.as_bytes()),
            sessions: Mutex::new(HashMap::new()),
        }))
    }

    fn credentials_match(&self, username: &str, password: &str) -> bool {
        let username_matches = blake3::hash(username.as_bytes()) == self.username_hash;
        let password_matches = blake3::hash(password.as_bytes()) == self.password_hash;
        username_matches & password_matches
    }

    fn sessions(&self) -> std::sync::MutexGuard<'_, HashMap<blake3::Hash, Instant>> {
        self.sessions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Returns a new session token when the credentials match. The oldest
    /// session is dropped once `MAX_SESSIONS` browsers are signed in.
    pub fn sign_in(&self, username: &str, password: &str) -> Option<String> {
        if !self.credentials_match(username, password) {
            return None;
        }
        let token = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());
        let now = Instant::now();
        let mut sessions = self.sessions();
        sessions.retain(|_, expires| *expires > now);
        if sessions.len() >= MAX_SESSIONS
            && let Some(oldest) = sessions
                .iter()
                .min_by_key(|(_, expires)| **expires)
                .map(|(key, _)| *key)
        {
            sessions.remove(&oldest);
        }
        sessions.insert(
            blake3::hash(token.as_bytes()),
            now + REMOTE_SESSION_LIFETIME,
        );
        Some(token)
    }

    /// Checks a session token and extends its lifetime.
    pub fn session_valid(&self, token: &str) -> bool {
        if token.len() > MAX_TOKEN_BYTES {
            return false;
        }
        let now = Instant::now();
        let mut sessions = self.sessions();
        match sessions.get_mut(&blake3::hash(token.as_bytes())) {
            Some(expires) if *expires > now => {
                *expires = now + REMOTE_SESSION_LIFETIME;
                true
            }
            _ => false,
        }
    }

    pub fn sign_out(&self, token: &str) {
        self.sessions().remove(&blake3::hash(token.as_bytes()));
    }

    /// Checks an HTTP `Authorization` header value for Basic credentials.
    pub fn authorizes(&self, header: &str) -> bool {
        let Some((scheme, encoded)) = header.trim().split_once(' ') else {
            return false;
        };
        if !scheme.eq_ignore_ascii_case("basic") || encoded.len() > 1024 {
            return false;
        }
        let Some(decoded) = STANDARD
            .decode(encoded.trim())
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
        else {
            return false;
        };
        decoded
            .split_once(':')
            .is_some_and(|(username, password)| self.credentials_match(username, password))
    }
}
