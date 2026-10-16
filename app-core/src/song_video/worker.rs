use std::io::{Read, Write};
use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;

static ACTIVE_WORKER: Mutex<()> = Mutex::new(());

pub(super) fn run(request: Value, timeout_sec: u64) -> Result<Value, String> {
    let _guard = ACTIVE_WORKER
        .try_lock()
        .map_err(|_| "Another YouTube request is running; wait for it to finish".to_string())?;
    let input = serde_json::to_vec(&request).map_err(|_| "Invalid video request".to_string())?;
    if input.len() > 8192 {
        return Err("Video request is too large".into());
    }
    let mut command = crate::vendor::silent_command(crate::vendor::python_path());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .arg(crate::vendor::analyzer_dir().join("youtube_video.py"))
        .env("OPENBLAS_NUM_THREADS", "1")
        .env("OMP_NUM_THREADS", "1")
        .env("NODE_OPTIONS", "--max-old-space-size=192")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Cannot start YouTube worker; run Nightingale setup first".to_string())?;
    let write_result = child
        .stdin
        .take()
        .ok_or("Cannot open video worker input")
        .and_then(|mut stream| {
            stream
                .write_all(&input)
                .map_err(|_| "Cannot send video request")
        });
    if let Err(message) = write_result {
        stop(&mut child);
        return Err(message.into());
    }
    let Some(stdout) = child.stdout.take() else {
        stop(&mut child);
        return Err("Cannot open video worker output".into());
    };
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.take(65537).read_to_end(&mut bytes).map(|_| bytes)
    });
    let deadline = Instant::now() + Duration::from_secs(timeout_sec);
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(50)),
            Ok(None) => {
                stop(&mut child);
                break Err("YouTube operation timed out; try another video".to_string());
            }
            Err(_) => {
                stop(&mut child);
                break Err("Cannot monitor YouTube worker".to_string());
            }
        }
    };
    let bytes = reader
        .join()
        .map_err(|_| "Cannot read video worker response".to_string())?
        .map_err(|_| "Cannot read video worker response".to_string())?;
    if !status?.success() || bytes.len() > 65536 {
        return Err("Video worker failed or returned too much data".into());
    }
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid video worker response".to_string())?;
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return Err(error.chars().take(500).collect());
    }
    Ok(value)
}

fn stop(child: &mut std::process::Child) {
    #[cfg(unix)]
    if !crate::vendor::silent_command("kill")
        .args(["-KILL", "--", &format!("-{}", child.id())])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
    {
        tracing::warn!("[song-video] Could not stop video worker process group");
    }
    #[cfg(windows)]
    if !crate::vendor::silent_command("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .is_ok_and(|status| status.success())
    {
        tracing::warn!("[song-video] Could not stop video worker process tree");
    }
    if let Err(_error) = child.kill() {
        tracing::warn!("[song-video] Could not stop failed video worker");
    }
    if let Err(_error) = child.wait() {
        tracing::warn!("[song-video] Could not reap failed video worker");
    }
}
