//! Loopback WebSocket that delivers microphone frames to the page. WebKitGTK
//! hands Tauri channel messages to the page on the GTK main thread, which can
//! be busy compositing rendered frames; socket data reaches the web process
//! without waiting for that thread.

use std::collections::HashMap;
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, SyncSender};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use tracing::warn;
use tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tungstenite::http::StatusCode;
use tungstenite::protocol::WebSocketConfig;
use tungstenite::Message;

use super::MicSampleFrame;

const MAX_STREAMS: usize = 8;
const QUEUED_FRAMES: usize = 16;
const MAX_CAPTURE_ID_BYTES: usize = 128;
const MAX_HELLO_BYTES: usize = 1024;
const HELLO_TIMEOUT: Duration = Duration::from_secs(2);

/// Where the page connects; the token is sent in the first message, not the URL.
#[derive(Clone, Serialize)]
pub(crate) struct MicStreamEndpoint {
    pub url: String,
    pub token: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Hello {
    token: String,
    capture_id: String,
}

struct Sink {
    connection: u64,
    frames: SyncSender<Vec<u8>>,
}

static ENDPOINT: OnceLock<Result<MicStreamEndpoint, String>> = OnceLock::new();
static SINKS: OnceLock<Mutex<HashMap<String, Sink>>> = OnceLock::new();
static CONNECTIONS: AtomicU64 = AtomicU64::new(0);

fn sinks() -> MutexGuard<'static, HashMap<String, Sink>> {
    SINKS
        .get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(|error| error.into_inner())
}

#[tauri::command]
pub(crate) fn mic_stream_endpoint() -> Result<MicStreamEndpoint, String> {
    ENDPOINT.get_or_init(start).clone()
}

fn start() -> Result<MicStreamEndpoint, String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))
        .map_err(|error| format!("Microphone stream unavailable: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Microphone stream unavailable: {error}"))?
        .port();
    let token = URL_SAFE_NO_PAD.encode(rand::random::<[u8; 32]>());
    let expected = token.clone();
    std::thread::Builder::new()
        .name("mic-stream".into())
        .spawn(move || {
            for stream in listener.incoming().flatten() {
                let expected = expected.clone();
                let connection = CONNECTIONS.fetch_add(1, Ordering::Relaxed);
                let spawned = std::thread::Builder::new()
                    .name("mic-stream-conn".into())
                    .spawn(move || {
                        if let Err(error) = serve(stream, &expected, connection) {
                            warn!("[mic] stream connection closed: {error}");
                        }
                    });
                if let Err(error) = spawned {
                    warn!("[mic] stream connection not served: {error}");
                }
            }
        })
        .map_err(|error| format!("Microphone stream unavailable: {error}"))?;
    Ok(MicStreamEndpoint {
        url: format!("ws://127.0.0.1:{port}"),
        token,
    })
}

fn allowed_origin(origin: &str) -> bool {
    matches!(origin, "tauri://localhost" | "http://tauri.localhost")
        || (cfg!(debug_assertions) && origin == "http://localhost:1420")
}

fn forbidden() -> ErrorResponse {
    let mut rejection = ErrorResponse::new(None);
    *rejection.status_mut() = StatusCode::FORBIDDEN;
    rejection
}

fn tokens_match(left: &str, right: &str) -> bool {
    left.len() == right.len()
        && left
            .bytes()
            .zip(right.bytes())
            .fold(0, |difference, (a, b)| difference | (a ^ b))
            == 0
}

fn serve(stream: TcpStream, token: &str, connection: u64) -> Result<(), String> {
    stream
        .set_nodelay(true)
        .map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(HELLO_TIMEOUT))
        .map_err(|error| error.to_string())?;
    let config = WebSocketConfig {
        max_message_size: Some(MAX_HELLO_BYTES),
        max_frame_size: Some(MAX_HELLO_BYTES),
        ..WebSocketConfig::default()
    };
    let check_origin = |request: &Request, response: Response| {
        let origin = request
            .headers()
            .get("origin")
            .and_then(|value| value.to_str().ok());
        if origin.is_some_and(allowed_origin) {
            Ok(response)
        } else {
            Err(forbidden())
        }
    };
    let mut socket = tungstenite::accept_hdr_with_config(stream, check_origin, Some(config))
        .map_err(|error| format!("handshake failed: {error}"))?;

    let Message::Text(hello) = socket.read().map_err(|error| error.to_string())? else {
        return Err("expected a hello message".into());
    };
    let hello: Hello = serde_json::from_str(&hello).map_err(|_| "invalid hello message")?;
    if !tokens_match(&hello.token, token)
        || hello.capture_id.is_empty()
        || hello.capture_id.len() > MAX_CAPTURE_ID_BYTES
    {
        return Err("rejected hello message".into());
    }
    socket
        .get_mut()
        .set_read_timeout(None)
        .map_err(|error| error.to_string())?;

    let (frames, receiver) = mpsc::sync_channel(QUEUED_FRAMES);
    {
        let mut sinks = sinks();
        if sinks.len() >= MAX_STREAMS && !sinks.contains_key(&hello.capture_id) {
            return Err("too many microphone streams".into());
        }
        sinks.insert(hello.capture_id.clone(), Sink { connection, frames });
    }
    for frame in receiver {
        if socket.send(Message::Binary(frame)).is_err() {
            break;
        }
    }
    let mut sinks = sinks();
    if sinks
        .get(&hello.capture_id)
        .is_some_and(|sink| sink.connection == connection)
    {
        sinks.remove(&hello.capture_id);
    }
    drop(sinks);
    let _ = socket.close(None);
    Ok(())
}

/// Queues a frame for the page as a little-endian `u32` sample rate followed
/// by `f32` samples. A frame is dropped when the page is not reading.
pub(super) fn send(capture_id: &str, frame: &MicSampleFrame) {
    let sinks = sinks();
    let Some(sink) = sinks.get(capture_id) else {
        return;
    };
    let mut bytes = Vec::with_capacity(4 + frame.samples.len() * 4);
    bytes.extend_from_slice(&frame.sample_rate.to_le_bytes());
    for sample in &frame.samples {
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    let _ = sink.frames.try_send(bytes);
}

/// Ends the stream of a stopped capture.
pub(super) fn close(capture_id: &str) {
    sinks().remove(capture_id);
}
