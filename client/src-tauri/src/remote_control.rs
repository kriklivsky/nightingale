//! LAN remote control: the phone page (`remote.html` from the embedded
//! frontend) and a small JSON API for the playback queue, library search,
//! YouTube import and control of what the TV is playing. It listens on every interface so a phone can reach it over
//! the box's access point, Wi-Fi or Ethernet address. The page and its assets
//! are public; the API needs a session cookie from the sign-in form or HTTP
//! Basic credentials from `remote-control.json`.

use std::collections::HashMap;
use std::io::Read;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use app_core::{
    AnalysisQueue, AppConfig, ImportJob, LibraryMenuFilters, LoadSongsParams, PlaybackQueue,
    PlaybackQueueEntry, QueuedStatus, RemoteControlSettings, Song, SongsStore, YoutubeImports,
};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tiny_http::{Header, Method, Request, Response, Server};

use crate::playback_queue::emit_queue;

mod tv;

pub(crate) use tv::{playback_window_closed, report_remote_status, TvStatusState};

const WORKERS: usize = 4;
const MAX_BODY_BYTES: u64 = 4096;
const SEARCH_LIMIT: usize = 50;
const MAX_ERROR_CHARS: usize = 300;
const ARTIST_SONG_LIMIT: usize = 1000;
const FAILED_AUTH_DELAY: Duration = Duration::from_millis(300);
const JSON_TYPE: &str = "application/json; charset=utf-8";
const PAGE_CSP: &str = "default-src 'self'; img-src 'self' data: https://i.ytimg.com; \
    style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; \
    frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum RemoteControlInfo {
    Off,
    Running { username: String, urls: Vec<String> },
    Failed { error: String },
}

#[derive(Default)]
enum Status {
    #[default]
    Off,
    Running {
        username: String,
        port: u16,
    },
    Failed(String),
}

#[derive(Default)]
pub(crate) struct RemoteControlState(Mutex<Status>);

/// Status for the settings page; URLs are listed fresh because the access
/// point, Wi-Fi and Ethernet addresses come and go while the app runs.
#[tauri::command]
pub(crate) fn remote_control_info(state: State<'_, RemoteControlState>) -> RemoteControlInfo {
    match &*lock(&state.0) {
        Status::Off => RemoteControlInfo::Off,
        Status::Running { username, port } => RemoteControlInfo::Running {
            username: username.clone(),
            urls: local_addresses()
                .into_iter()
                .map(|address| format!("http://{address}:{port}"))
                .collect(),
        },
        Status::Failed(error) => RemoteControlInfo::Failed {
            error: error.clone(),
        },
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(unix)]
fn local_addresses() -> Vec<std::net::Ipv4Addr> {
    use nix::net::if_::InterfaceFlags;

    let Ok(interfaces) = nix::ifaddrs::getifaddrs() else {
        return Vec::new();
    };
    let mut addresses: Vec<_> = interfaces
        .filter(|interface| {
            interface.flags.contains(InterfaceFlags::IFF_UP)
                && !interface.flags.contains(InterfaceFlags::IFF_LOOPBACK)
        })
        .filter_map(|interface| {
            interface
                .address?
                .as_sockaddr_in()
                .map(|address| address.ip())
        })
        .collect();
    addresses.sort_unstable();
    addresses.dedup();
    addresses
}

#[cfg(not(unix))]
fn local_addresses() -> Vec<std::net::Ipv4Addr> {
    Vec::new()
}

/// Starts the listener when `remote-control.json` exists. Failures are kept
/// for the settings page instead of stopping the app.
pub(crate) fn start(app: &AppHandle) {
    let state = app.state::<RemoteControlState>();
    let settings = match RemoteControlSettings::load() {
        Ok(Some(settings)) => settings,
        Ok(None) => return,
        Err(error) => {
            tracing::warn!("Remote control is disabled: {error}");
            *lock(&state.0) = Status::Failed(error);
            return;
        }
    };
    let server = match Server::http(("0.0.0.0", settings.port)) {
        Ok(server) => Arc::new(server),
        Err(error) => {
            let error = format!("Cannot listen on port {}: {error}", settings.port);
            tracing::warn!("Remote control is disabled: {error}");
            *lock(&state.0) = Status::Failed(error);
            return;
        }
    };
    tracing::info!("Remote control listening on port {}", settings.port);
    *lock(&state.0) = Status::Running {
        username: settings.username.clone(),
        port: settings.port,
    };

    let queue_app = app.clone();
    let imports = YoutubeImports::start(move |song| {
        let queue = queue_app.state::<PlaybackQueue>();
        match queue.add(&song.file_hash, song.tempo, song.key_offset) {
            Ok(entries) => {
                if let Err(error) = emit_queue(&queue_app, &entries) {
                    tracing::warn!("Cannot announce imported song in the queue: {error}");
                }
            }
            Err(error) => tracing::warn!("Cannot queue imported song: {error}"),
        }
    });
    let context = Arc::new(Context {
        app: app.clone(),
        settings,
        imports,
    });
    for _ in 0..WORKERS {
        let server = Arc::clone(&server);
        let context = Arc::clone(&context);
        std::thread::spawn(move || {
            while let Ok(request) = server.recv() {
                context.handle(request);
            }
        });
    }
}

struct Context {
    app: AppHandle,
    settings: RemoteControlSettings,
    imports: YoutubeImports,
}

enum Reply {
    Json(serde_json::Value),
    Asset(tauri::Asset),
    Error(u16, String),
    Session(Option<String>),
}

const SESSION_COOKIE: &str = "nightingale_remote";

fn session_token(request: &Request) -> Option<&str> {
    header(request, "Cookie")?
        .split(';')
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(name, _)| *name == SESSION_COOKIE)
        .map(|(_, value)| value)
}

fn session_cookie(token: Option<&str>) -> String {
    let (value, max_age) = token.map_or(("", 0), |token| {
        (token, app_core::REMOTE_SESSION_LIFETIME.as_secs())
    });
    format!("{SESSION_COOKIE}={value}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Strict")
}

type Handled = Result<serde_json::Value, String>;

fn header<'a>(request: &'a Request, name: &'static str) -> Option<&'a str> {
    request
        .headers()
        .iter()
        .find(|header| header.field.equiv(name))
        .map(|header| header.value.as_str())
}

fn split_target(url: &str) -> (&str, HashMap<String, String>) {
    let (path, query) = url.split_once('?').unwrap_or((url, ""));
    let parameters = url::form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect();
    (path, parameters)
}

fn to_json<T: Serialize>(value: &T) -> Handled {
    serde_json::to_value(value).map_err(|_| "Cannot encode the response".to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
enum SongStatus {
    Ready,
    Queued,
    Analyzing,
    Failed,
    NotAnalyzed,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteSong {
    file_hash: String,
    title: String,
    artist: String,
    duration_sec: f64,
    status: SongStatus,
    progress: Option<usize>,
    error: Option<String>,
}

#[derive(Serialize)]
struct RemoteQueueEntry {
    id: String,
    song: RemoteSong,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteState {
    queue: Vec<RemoteQueueEntry>,
    imports: Vec<ImportJob>,
    tv: Option<tv::TvStatus>,
    monitor_gain: f32,
}

fn remote_song(song: &Song, analysis: &HashMap<String, QueuedStatus>) -> RemoteSong {
    let (status, progress, error) = match analysis.get(&song.file_hash) {
        Some(QueuedStatus::Queued) => (SongStatus::Queued, None, None),
        Some(QueuedStatus::Analyzing(progress)) => (SongStatus::Analyzing, Some(*progress), None),
        Some(QueuedStatus::Failed(error)) => (
            SongStatus::Failed,
            None,
            Some(error.chars().take(MAX_ERROR_CHARS).collect()),
        ),
        None if song.is_analyzed => (SongStatus::Ready, None, None),
        None => (SongStatus::NotAnalyzed, None, None),
    };
    let title = if song.title.trim().is_empty() {
        song.path
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_default()
    } else {
        song.title.clone()
    };
    RemoteSong {
        file_hash: song.file_hash.clone(),
        title,
        artist: song.artist.clone(),
        duration_sec: song.duration_secs,
        status,
        progress,
        error,
    }
}

fn analysis_statuses() -> Result<HashMap<String, QueuedStatus>, String> {
    AnalysisQueue::load()
        .map(|queue| queue.entries)
        .map_err(|_| "Cannot read the analysis queue".to_string())
}

#[derive(Deserialize)]
struct LoginInput {
    username: String,
    password: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddInput {
    file_hash: String,
}

#[derive(Deserialize)]
struct MoveInput {
    id: String,
    index: usize,
}

#[derive(Deserialize)]
struct RemoveInput {
    id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportInput {
    video_id: String,
    artist: String,
    title: String,
}

impl Context {
    fn handle(&self, mut request: Request) {
        let mut headers = vec![
            ("X-Content-Type-Options", "nosniff".to_string()),
            ("X-Frame-Options", "DENY".to_string()),
            ("Referrer-Policy", "no-referrer".to_string()),
        ];
        let (status, body) = match self.route(&mut request) {
            Reply::Json(value) => {
                headers.push(("Content-Type", JSON_TYPE.to_string()));
                headers.push(("Cache-Control", "no-store".to_string()));
                (200, value.to_string().into_bytes())
            }
            Reply::Asset(asset) => {
                if asset.mime_type.starts_with("text/html") {
                    headers.push(("Content-Security-Policy", PAGE_CSP.to_string()));
                    headers.push(("Cache-Control", "no-store".to_string()));
                } else {
                    headers.push(("Cache-Control", "max-age=31536000, immutable".to_string()));
                }
                headers.push(("Content-Type", asset.mime_type));
                (200, asset.bytes)
            }
            Reply::Error(status, message) => {
                headers.push(("Content-Type", JSON_TYPE.to_string()));
                headers.push(("Cache-Control", "no-store".to_string()));
                let body = serde_json::json!({ "error": message }).to_string();
                (status, body.into_bytes())
            }
            Reply::Session(token) => {
                headers.push(("Content-Type", JSON_TYPE.to_string()));
                headers.push(("Cache-Control", "no-store".to_string()));
                headers.push(("Set-Cookie", session_cookie(token.as_deref())));
                (200, b"{}".to_vec())
            }
        };
        let mut response = Response::from_data(body).with_status_code(status);
        for (name, value) in headers {
            if let Ok(header) = Header::from_bytes(name.as_bytes(), value.as_bytes()) {
                response.add_header(header);
            }
        }
        if let Err(error) = request.respond(response) {
            tracing::debug!("Remote control response failed: {error}");
        }
    }

    fn signed_in(&self, request: &Request) -> bool {
        session_token(request).is_some_and(|token| self.settings.session_valid(token))
            || header(request, "Authorization")
                .is_some_and(|credentials| self.settings.authorizes(credentials))
    }

    fn route(&self, request: &mut Request) -> Reply {
        let url = request.url().to_string();
        let (path, parameters) = split_target(&url);
        match (request.method(), path) {
            (Method::Get, "/" | "/index.html") => return self.asset("remote.html"),
            (Method::Get, "/favicon.png") => return self.asset("favicon.png"),
            (Method::Get, _) if path.starts_with("/assets/") => return self.asset(&path[1..]),
            (Method::Post, "/api/login") => return self.sign_in(request),
            _ => {}
        }
        if !self.signed_in(request) {
            return Reply::Error(401, "Sign in to use the remote control".into());
        }
        match request.method() {
            Method::Get => self.read(path, &parameters),
            Method::Post if path == "/api/logout" => {
                if let Some(token) = session_token(request) {
                    self.settings.sign_out(token);
                }
                Reply::Session(None)
            }
            Method::Post => self.write(request, path),
            _ => Reply::Error(405, "Method not allowed".into()),
        }
    }

    fn sign_in(&self, request: &mut Request) -> Reply {
        let input: LoginInput = match read_body(request)
            .and_then(|body| parse(&body).map_err(|error| Reply::Error(400, error)))
        {
            Ok(input) => input,
            Err(reply) => return reply,
        };
        match self.settings.sign_in(&input.username, &input.password) {
            Some(token) => Reply::Session(Some(token)),
            None => {
                std::thread::sleep(FAILED_AUTH_DELAY);
                Reply::Error(401, "Wrong username or password".into())
            }
        }
    }

    fn read(&self, path: &str, parameters: &HashMap<String, String>) -> Reply {
        let query = parameters.get("q").map_or("", String::as_str);
        let result = match path {
            "/api/state" => self.state(),
            "/api/setup" => to_json(&tv::start_setup()),
            "/api/songs" => match parameters.get("artist") {
                Some(artist) => self.artist_songs(artist),
                None => self.songs(query),
            },
            "/api/artists" => artists(),
            "/api/youtube" => app_core::search_youtube(query).and_then(|found| to_json(&found)),
            "/api/youtube/lyrics" => app_core::check_import_lyrics(
                parameters.get("artist").map_or("", String::as_str),
                parameters.get("title").map_or("", String::as_str),
                parameters
                    .get("duration")
                    .and_then(|value| value.parse().ok()),
            )
            .and_then(|check| to_json(&check)),
            _ => return Reply::Error(404, "Not found".into()),
        };
        match result {
            Ok(value) => Reply::Json(value),
            Err(error) => Reply::Error(400, error),
        }
    }

    fn asset(&self, path: &str) -> Reply {
        let safe = !path.contains("..")
            && path.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b'/')
            });
        if !safe {
            return Reply::Error(404, "Not found".into());
        }
        match self.app.asset_resolver().get(path.to_string()) {
            Some(asset) => Reply::Asset(asset),
            None => Reply::Error(404, "Not found".into()),
        }
    }

    fn write(&self, request: &mut Request, path: &str) -> Reply {
        let body = match read_body(request) {
            Ok(body) => body,
            Err(reply) => return reply,
        };
        let result = match path {
            "/api/queue/add" => parse(&body).and_then(|input: AddInput| {
                self.change_queue(|queue| {
                    let song = SongsStore::load_by_hashes(std::slice::from_ref(&input.file_hash))
                        .into_iter()
                        .next()
                        .ok_or_else(|| "Song is no longer in the library".to_string())?;
                    if !matches!(
                        remote_song(&song, &analysis_statuses()?).status,
                        SongStatus::Ready
                    ) {
                        return Err("The song is not ready to sing yet".into());
                    }
                    queue.add(&song.file_hash, song.tempo, song.key_offset)
                })
            }),
            "/api/queue/move" => parse(&body).and_then(|input: MoveInput| {
                self.change_queue(|queue| queue.move_entry(&input.id, input.index))
            }),
            "/api/queue/remove" => parse(&body)
                .and_then(|input: RemoveInput| self.change_queue(|queue| queue.remove(&input.id))),
            "/api/queue/clear" => self.change_queue(PlaybackQueue::clear),
            "/api/control" => parse(&body).and_then(|command: tv::RemoteCommand| {
                tv::send(&self.app, &command)?;
                self.state()
            }),
            "/api/youtube/import" => parse(&body).and_then(|input: ImportInput| {
                self.imports
                    .import(&input.video_id, &input.artist, &input.title)
                    .and_then(|_| self.state())
            }),
            _ => return Reply::Error(404, "Not found".into()),
        };
        match result {
            Ok(value) => Reply::Json(value),
            Err(error) => Reply::Error(400, error),
        }
    }

    fn change_queue(
        &self,
        change: impl FnOnce(&PlaybackQueue) -> Result<Vec<PlaybackQueueEntry>, String>,
    ) -> Handled {
        let entries = change(&self.app.state::<PlaybackQueue>())?;
        emit_queue(&self.app, &entries)?;
        self.state()
    }

    fn state(&self) -> Handled {
        let analysis = analysis_statuses()?;
        let queue = self
            .app
            .state::<PlaybackQueue>()
            .entries()?
            .into_iter()
            .map(|entry| RemoteQueueEntry {
                song: remote_song(&entry.song, &analysis),
                id: entry.id,
            })
            .collect();
        to_json(&RemoteState {
            queue,
            imports: self.imports.jobs(),
            tv: tv::current(&self.app.state::<TvStatusState>()),
            monitor_gain: AppConfig::load().mic_monitor_gain(),
        })
    }

    fn songs(&self, query: &str) -> Handled {
        let query = query.trim();
        if query.chars().count() > 200 {
            return Err("Search text is too long".into());
        }
        list_songs(
            (!query.is_empty()).then(|| query.to_string()),
            LibraryMenuFilters::default(),
            SEARCH_LIMIT,
        )
    }

    fn artist_songs(&self, artist: &str) -> Handled {
        if artist.is_empty() || artist.chars().count() > 500 {
            return Err("Invalid artist".into());
        }
        list_songs(
            None,
            LibraryMenuFilters {
                artist: Some(artist.to_string()),
                ..LibraryMenuFilters::default()
            },
            ARTIST_SONG_LIMIT,
        )
    }
}

fn list_songs(search: Option<String>, filters: LibraryMenuFilters, take: usize) -> Handled {
    let store = SongsStore::load(&LoadSongsParams {
        search,
        filters,
        sort: None,
        skip: 0,
        take,
    })
    .map_err(|_| "Cannot search the library".to_string())?;
    let analysis = analysis_statuses()?;
    let songs: Vec<_> = store
        .processed
        .iter()
        .map(|song| remote_song(song, &analysis))
        .collect();
    to_json(&songs)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteArtist {
    value: String,
    label: String,
    count: u64,
    ready_count: u64,
}

fn artists() -> Handled {
    let items =
        app_core::load_library_menu_items().map_err(|_| "Cannot read the library".to_string())?;
    let artists: Vec<_> = items
        .artists
        .into_iter()
        .map(|item| RemoteArtist {
            value: item.value,
            label: item.label,
            count: item.count,
            ready_count: item.analysed_count,
        })
        .collect();
    to_json(&artists)
}

/// Reads a JSON body from the remote page's own origin; anything else is
/// rejected so other sites cannot drive the remote with a signed-in cookie.
fn read_body(request: &mut Request) -> Result<Vec<u8>, Reply> {
    let json = header(request, "Content-Type").is_some_and(|value| {
        value
            .trim()
            .to_ascii_lowercase()
            .starts_with("application/json")
    });
    let same_origin = match (header(request, "Origin"), header(request, "Host")) {
        (None, _) => true,
        (Some(origin), Some(host)) => origin == format!("http://{host}"),
        (Some(_), None) => false,
    };
    if !json || !same_origin {
        return Err(Reply::Error(403, "Request rejected".into()));
    }
    let mut body = Vec::new();
    if request
        .as_reader()
        .take(MAX_BODY_BYTES + 1)
        .read_to_end(&mut body)
        .is_err()
        || body.len() as u64 > MAX_BODY_BYTES
    {
        return Err(Reply::Error(413, "Request body is too large".into()));
    }
    Ok(body)
}

fn parse<T: DeserializeOwned>(body: &[u8]) -> Result<T, String> {
    serde_json::from_slice(body).map_err(|_| "Invalid request".to_string())
}
