#!/usr/bin/env python3
"""Persistent analyzer server for Nightingale.

Binds a TCP loopback socket and exchanges newline-delimited JSON with the
Rust client. Stdout/stderr are reserved for plain logs aside from one
handshake line emitted on startup.

Handshake (stdout, single line):
  {"event":"ready","port":N,"token":"...","device":"..."}

Wire protocol (NDJSON over TCP, one JSON object per line):
  Client -> server:
    {"type":"hello","token":"..."}
    {"type":"analyze","hash":"...","audio_path":"...","cache_path":"...", ...}
    {"type":"quit"}
  Server -> client:
    {"type":"hello_ack"}
    {"type":"progress","pct":N,"msg":"..."}
    {"type":"done","hash":"..."}
    {"type":"error","kind":"oom"|"generic","msg":"..."}
"""

import json
import os
import secrets
import socket
import sys
import threading

MAX_COMMAND_BYTES = 2 * 1024 * 1024

if os.name == "nt":
    import huggingface_hub.file_download as _hf_dl
    _hf_dl.are_symlinks_supported = lambda *_a, **_kw: False

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from scheduling import set_background_priority
set_background_priority(report=True)

from gpu import end_of_song_cleanup, hard_free_gpu, log_vram, reset_peak_stats, vram_snapshot
from whisper_compat import detect_device, is_oom, set_align_backend, set_progress_sink
from audio import set_vocal_threshold_pct
from pipeline import run_pipeline


def process_song(cmd, device):
    audio_path = os.path.abspath(cmd["audio_path"])
    output_dir = os.path.abspath(cmd["cache_path"])
    file_hash = cmd["hash"]
    model_name = cmd.get("model", "large-v3")
    separator = cmd.get("separator", "karaoke")
    lyrics_path = cmd.get("lyrics")
    language_override = cmd.get("language")
    skip_transcription = bool(cmd.get("skip_transcription", False))
    align_lrc_lines = bool(cmd.get("align_lrc_lines", False))
    lrclib_lyricsfile = cmd.get("lrclib_lyricsfile")
    duration_secs = cmd.get("duration_secs")
    skip_separation = bool(cmd.get("skip_separation", False))

    set_align_backend(cmd.get("align_backend", "whisperx"))
    set_vocal_threshold_pct(cmd.get("vocal_detection_threshold_pct"))

    reset_peak_stats()
    log_vram("song_start")
    try:
        run_pipeline(
            audio_path, output_dir, file_hash, device,
            model_name=model_name,
            separator=separator,
            lyrics_path=lyrics_path,
            language_override=language_override,
            pre_align_cleanup=end_of_song_cleanup,
            free_gpu_fn=hard_free_gpu,
            skip_transcription=skip_transcription,
            align_lrc_lines=align_lrc_lines,
            lrclib_lyricsfile=lrclib_lyricsfile,
            duration_secs=duration_secs,
            skip_separation=skip_separation,
        )
    finally:
        end_of_song_cleanup()
        log_vram("song_end")


class ProtocolWriter:
    def __init__(self, stream):
        self.stream = stream
        self.lock = threading.Lock()

    def send(self, payload):
        with self.lock:
            try:
                self.stream.write(json.dumps(payload, ensure_ascii=False) + "\n")
                self.stream.flush()
                return True
            except OSError:
                print("[nightingale:LOG] Analyzer connection closed", file=sys.stderr, flush=True)
                return False


def heartbeat(protocol, stopped, busy):
    while not stopped.wait(5):
        if busy.is_set() and not protocol.send({"type": "heartbeat"}):
            return


def read_commands(stream):
    while True:
        line = stream.readline(MAX_COMMAND_BYTES + 1)
        if not line:
            return
        if len(line) > MAX_COMMAND_BYTES or not line.endswith(b"\n"):
            raise ValueError("Analyzer command exceeded the protocol size limit")
        yield line


def main():
    device = detect_device()
    token = secrets.token_hex(16)

    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", 0))
    srv.listen(1)
    port = srv.getsockname()[1]

    print(
        json.dumps({"event": "ready", "port": port, "token": token, "device": device}),
        flush=True,
    )

    srv.settimeout(60.0)
    try:
        conn, _addr = srv.accept()
    except socket.timeout:
        print("[nightingale:LOG] Timed out waiting for client connection", file=sys.stderr, flush=True)
        return
    finally:
        srv.close()

    conn.settimeout(60)
    rfile = conn.makefile("rb")
    wfile = conn.makefile("w", encoding="utf-8", newline="\n")
    protocol = ProtocolWriter(wfile)

    hello_line = rfile.readline(1025)
    if not hello_line:
        return
    try:
        hello = json.loads(hello_line)
    except json.JSONDecodeError:
        return
    if not isinstance(hello, dict) or hello.get("type") != "hello" or hello.get("token") != token:
        print("[nightingale:LOG] Auth failed, closing connection", file=sys.stderr, flush=True)
        return
    conn.settimeout(None)
    protocol.send({"type": "hello_ack"})
    stopped = threading.Event()
    busy = threading.Event()
    pulse = threading.Thread(target=heartbeat, args=(protocol, stopped, busy), daemon=True)
    pulse.start()

    set_progress_sink(lambda pct, msg: protocol.send({"type": "progress", "pct": int(pct), "msg": str(msg)[:4096]}))

    try:
        for line in read_commands(rfile):
            line = line.strip()
            if not line:
                continue
            try:
                cmd = json.loads(line)
            except json.JSONDecodeError as e:
                protocol.send({"type": "error", "kind": "generic", "msg": f"Invalid JSON: {e}"})
                continue

            if not isinstance(cmd, dict):
                protocol.send({"type": "error", "kind": "generic", "msg": "Expected a command object"})
                continue
            ctype = cmd.get("type")
            if ctype == "quit":
                break
            if ctype == "analyze":
                busy.set()
                try:
                    process_song(cmd, device)
                    protocol.send({"type": "done", "hash": cmd.get("hash", "")})
                except Exception as e:
                    import traceback
                    traceback.print_exc(file=sys.stderr)
                    err_str = str(e)
                    if is_oom(err_str):
                        snap = vram_snapshot()
                        if snap:
                            print(
                                f"[nightingale:LOG] OOM in process_song; vram={snap}",
                                file=sys.stderr, flush=True,
                            )
                        end_of_song_cleanup()
                        protocol.send({"type": "error", "kind": "oom", "msg": err_str[:4096]})
                    else:
                        protocol.send({"type": "error", "kind": "generic", "msg": err_str[:4096]})
                finally:
                    busy.clear()
            else:
                protocol.send({"type": "error", "kind": "generic", "msg": "Unknown command"})
    finally:
        stopped.set()
        try:
            conn.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        pulse.join(timeout=1)
        try:
            wfile.close()
        except Exception:
            pass
        try:
            rfile.close()
        except Exception:
            pass
        try:
            conn.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
