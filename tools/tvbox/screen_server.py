#!/usr/bin/python3
from __future__ import annotations

import argparse
import asyncio
from collections import defaultdict, deque
from dataclasses import dataclass, field
import hashlib
import ipaddress
import json
import logging
import os
from pathlib import Path
import secrets
import signal
import ssl
import time
from urllib.parse import urlsplit

from aiohttp import WSMsgType, web


LOGGER = logging.getLogger("tvbox-screen")
MAX_BODY = 128 * 1024
SESSION_TIMEOUT = 30


@dataclass
class Session:
    receiver_token: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    code: str = field(default_factory=lambda: f"{secrets.randbelow(1_000_000):06d}")
    sender_token: str | None = None
    offer: str | None = None
    answer: str | None = None
    generation: int = 0
    receiver_seen: float = 0
    sender_seen: float = 0
    attempts: dict[str, deque[float]] = field(default_factory=lambda: defaultdict(deque))
    all_attempts: deque[float] = field(default_factory=deque)
    monitoring: bool | None = None
    monitoring_revision: int = 0
    microphone_available: bool = False
    microphone_token: str | None = None
    microphone_queue: asyncio.Queue[bytes | None] | None = None
    microphone_source: web.WebSocketResponse | None = None

    def stop_microphones(self) -> None:
        self.microphone_token = None
        if self.microphone_queue is not None:
            while not self.microphone_queue.empty():
                self.microphone_queue.get_nowait()
            self.microphone_queue.put_nowait(None)
            self.microphone_queue = None

    def reset(self) -> None:
        self.stop_microphones()
        self.code = f"{secrets.randbelow(1_000_000):06d}"
        self.sender_token = None
        self.offer = None
        self.answer = None
        self.generation += 1
        self.sender_seen = 0

    def expire(self) -> None:
        now = time.monotonic()
        if self.sender_token is not None and (
            now - self.sender_seen > SESSION_TIMEOUT
            or now - self.receiver_seen > SESSION_TIMEOUT
        ):
            self.reset()

    def allow_pair(self, address: str) -> bool:
        now = time.monotonic()
        for key in list(self.attempts):
            while self.attempts[key] and now - self.attempts[key][0] > 60:
                self.attempts[key].popleft()
            if not self.attempts[key]:
                del self.attempts[key]
        while self.all_attempts and now - self.all_attempts[0] > 60:
            self.all_attempts.popleft()
        if len(self.all_attempts) >= 20 or len(self.attempts.get(address, ())) >= 5:
            return False
        self.attempts[address].append(now)
        self.all_attempts.append(now)
        return True


async def object_body(request: web.Request) -> dict:
    if request.content_type != "application/json":
        raise web.HTTPUnsupportedMediaType(text="Expected JSON")
    try:
        value = await request.json()
    except (ValueError, UnicodeError):
        raise web.HTTPBadRequest(text="Invalid JSON") from None
    if not isinstance(value, dict):
        raise web.HTTPBadRequest(text="Expected an object")
    return value


def authorize(request: web.Request, token: str | None) -> None:
    supplied = request.headers.get("Authorization", "")
    if token is None or not secrets.compare_digest(supplied.encode("utf-8"), f"Bearer {token}".encode("ascii")):
        raise web.HTTPUnauthorized(text="Connection expired. Enter the TV code again.")


def sdp_body(value: dict, expected_generation: int) -> str:
    sdp = value.get("sdp")
    generation = value.get("generation")
    if type(generation) is not int or generation != expected_generation:
        raise web.HTTPConflict(text="Connection changed. Try again.")
    if not isinstance(sdp, str) or not sdp.startswith("v=0\r\n") or len(sdp) > 100_000:
        raise web.HTTPBadRequest(text="Invalid session description")
    return sdp


def create_apps(args: argparse.Namespace, session: Session) -> tuple[web.Application, web.Application]:
    receiver_origins = {f"http://127.0.0.1:{args.receiver_port}"}

    @web.middleware
    async def guard(request: web.Request, handler):
        local = request.app is receiver
        origin = request.headers.get("Origin")
        expected = receiver_origins if local else {args.public_url}
        if request.path.startswith("/api/") and (
            (origin is not None and origin not in expected)
            or (request.method not in {"GET", "HEAD"} and origin is None)
        ):
            raise web.HTTPForbidden(text="Untrusted origin")
        try:
            if request.method == "OPTIONS" and local:
                response = web.Response(status=204)
            else:
                response = await handler(request)
        except web.HTTPException as error:
            response = error
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), display-capture=(self)"
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "connect-src 'self'; img-src 'self'; font-src 'self'; media-src blob:; "
            "frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
        )
        if local and origin in receiver_origins:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        return response

    sender = web.Application(client_max_size=MAX_BODY, middlewares=[guard])
    receiver = web.Application(client_max_size=MAX_BODY, middlewares=[guard])

    async def pair(request: web.Request) -> web.Response:
        if not session.allow_pair(request.remote or "unknown"):
            raise web.HTTPTooManyRequests(text="Too many attempts. Wait one minute.")
        value = await object_body(request)
        session.expire()
        code = value.get("code")
        if not isinstance(code, str) or len(code) != 6 or not code.isascii() or not code.isdigit() or not secrets.compare_digest(code, session.code):
            raise web.HTTPUnauthorized(text="Incorrect TV code")
        if time.monotonic() - session.receiver_seen > 5:
            raise web.HTTPServiceUnavailable(text="TV receiver is not ready")
        if session.sender_token is not None:
            raise web.HTTPConflict(text="Another laptop is connected. Disconnect it on the TV first.")
        session.sender_token = secrets.token_urlsafe(32)
        session.sender_seen = time.monotonic()
        LOGGER.info("Laptop paired")
        return web.json_response({"token": session.sender_token, "generation": session.generation})

    async def sender_state(request: web.Request) -> web.Response:
        session.expire()
        authorize(request, session.sender_token)
        session.sender_seen = time.monotonic()
        return web.json_response({
            "generation": session.generation, "answer": session.answer,
            "monitoring": session.monitoring,
            "microphone_available": session.microphone_available,
            "microphone_streaming": session.microphone_queue is not None,
        })

    async def monitoring(request: web.Request) -> web.Response:
        session.expire()
        authorize(request, session.sender_token)
        value = await object_body(request)
        if type(value.get("enabled")) is not bool:
            raise web.HTTPBadRequest(text="Expected enabled boolean")
        session.monitoring = value["enabled"]
        session.monitoring_revision += 1
        return web.json_response({"ok": True})

    async def microphone_access(request: web.Request) -> web.Response:
        session.expire()
        authorize(request, session.sender_token)
        value = await object_body(request)
        if type(value.get("enabled")) is not bool:
            raise web.HTTPBadRequest(text="Expected enabled boolean")
        session.stop_microphones()
        if value["enabled"]:
            if not session.microphone_available:
                raise web.HTTPConflict(text="UMC202HD is unavailable on the TV receiver")
            session.microphone_token = secrets.token_urlsafe(32)
        return web.json_response({"token": session.microphone_token})

    async def microphone_audio(request: web.Request) -> web.StreamResponse:
        session.expire()
        authorize(request, session.microphone_token)
        if session.microphone_queue is not None:
            raise web.HTTPConflict(text="Microphones already have a consumer")
        frames: asyncio.Queue[bytes | None] = asyncio.Queue(maxsize=4)
        session.microphone_queue = frames
        response = web.StreamResponse(headers={
            "Content-Type": "application/octet-stream",
            "X-Audio-Format": "S16LE;rate=48000;channels=2;layout=interleaved",
            "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
            "X-Accel-Buffering": "no",
            "Referrer-Policy": "no-referrer",
            "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        })
        try:
            await response.prepare(request)
            while True:
                try:
                    frame = await asyncio.wait_for(frames.get(), timeout=5)
                except TimeoutError:
                    break
                if frame is None:
                    break
                await asyncio.wait_for(response.write(frame), timeout=2)
        except (ConnectionError, TimeoutError):
            pass
        finally:
            if session.microphone_queue is frames:
                session.microphone_queue = None
        return response

    async def microphone_source(request: web.Request) -> web.WebSocketResponse:
        authorize(request, session.receiver_token)
        generation = session.generation
        if request.query.get("generation") != str(generation):
            raise web.HTTPConflict(text="Microphone session changed")
        if session.microphone_source is not None:
            raise web.HTTPConflict(text="Microphone producer already connected")
        socket = web.WebSocketResponse(max_msg_size=8192, heartbeat=5)
        await socket.prepare(request)
        session.microphone_source = socket
        try:
            async for message in socket:
                if generation != session.generation:
                    await socket.close(code=1008, message=b"Microphone session changed")
                    break
                if message.type != WSMsgType.BINARY or not message.data or len(message.data) % 4:
                    await socket.close(code=1003, message=b"Expected stereo S16LE PCM")
                    break
                frames = session.microphone_queue
                if frames is not None:
                    if frames.full():
                        frames.get_nowait()
                    frames.put_nowait(message.data)
        finally:
            session.microphone_source = None
        return socket

    async def offer(request: web.Request) -> web.Response:
        session.expire()
        authorize(request, session.sender_token)
        value = await object_body(request)
        if session.offer is not None:
            raise web.HTTPConflict(text="Already sharing. Stop before starting again.")
        session.offer = sdp_body(value, session.generation)
        session.sender_seen = time.monotonic()
        return web.json_response({"ok": True})

    async def disconnect_sender(request: web.Request) -> web.Response:
        authorize(request, session.sender_token)
        session.reset()
        return web.json_response({"ok": True})

    async def receiver_state(request: web.Request) -> web.Response:
        session.expire()
        authorize(request, session.receiver_token)
        session.receiver_seen = time.monotonic()
        return web.json_response({
            "code": session.code,
            "generation": session.generation,
            "paired": session.sender_token is not None,
            "offer": session.offer,
            "monitoring": session.monitoring,
            "monitoring_revision": session.monitoring_revision,
            "microphone_streaming": session.microphone_queue is not None,
        })

    async def receiver_audio(request: web.Request) -> web.Response:
        authorize(request, session.receiver_token)
        value = await object_body(request)
        if type(value.get("monitoring")) is not bool or type(value.get("available")) is not bool:
            raise web.HTTPBadRequest(text="Expected audio state booleans")
        revision = value.get("revision")
        if revision is not None and (type(revision) is not int or revision < 0):
            raise web.HTTPBadRequest(text="Invalid audio revision")
        if revision is None or revision == session.monitoring_revision:
            session.monitoring = value["monitoring"]
            session.monitoring_revision += 1
        session.microphone_available = value["available"]
        return web.json_response({"ok": True})

    async def answer(request: web.Request) -> web.Response:
        authorize(request, session.receiver_token)
        value = await object_body(request)
        if session.offer is None:
            raise web.HTTPConflict(text="No active sender")
        session.answer = sdp_body(value, session.generation)
        session.receiver_seen = time.monotonic()
        return web.json_response({"ok": True})

    async def disconnect_receiver(request: web.Request) -> web.Response:
        authorize(request, session.receiver_token)
        session.reset()
        return web.json_response({"ok": True})

    async def index(_request: web.Request) -> web.FileResponse:
        return web.FileResponse(args.assets / "index.html")

    async def certificate(_request: web.Request) -> web.FileResponse:
        return web.FileResponse(args.trust_certificate or args.certificate, headers={"Content-Disposition": 'attachment; filename="orangepi-screen.crt"'})

    async def microphone_client(_request: web.Request) -> web.FileResponse:
        return web.FileResponse(Path(__file__).with_name("microphone_client.py"),
                                headers={"Content-Disposition": 'attachment; filename="microphone_client.py"'})

    sender.router.add_get("/", index)
    sender.router.add_get("/certificate", certificate)
    sender.router.add_get("/microphone-client.py", microphone_client)
    sender.router.add_static("/assets/", args.assets / "assets", follow_symlinks=False)
    sender.router.add_post("/api/pair", pair)
    sender.router.add_get("/api/state", sender_state)
    sender.router.add_post("/api/offer", offer)
    sender.router.add_post("/api/disconnect", disconnect_sender)
    sender.router.add_post("/api/monitoring", monitoring)
    sender.router.add_post("/api/microphone-access", microphone_access)
    sender.router.add_get("/api/microphone-audio", microphone_audio)
    receiver.router.add_get("/api/state", receiver_state)
    receiver.router.add_post("/api/answer", answer)
    receiver.router.add_post("/api/disconnect", disconnect_receiver)
    receiver.router.add_post("/api/audio", receiver_audio)
    receiver.router.add_get("/api/microphone-source", microphone_source)
    receiver.router.add_route("OPTIONS", "/api/{name}", receiver_state)
    return sender, receiver


async def run(args: argparse.Namespace) -> None:
    parent = args.parent_pid if args.parent_pid is not None else os.getppid()
    if os.getppid() != parent:
        return
    session = Session()
    sender, receiver = create_apps(args, session)
    tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    tls.minimum_version = ssl.TLSVersion.TLSv1_2
    tls.load_cert_chain(args.certificate, args.private_key)
    pem = (args.trust_certificate or args.certificate).read_text(encoding="ascii")
    fingerprint = hashlib.sha256(ssl.PEM_cert_to_DER_cert(pem)).hexdigest().upper()
    runners = [web.AppRunner(sender, access_log=None), web.AppRunner(receiver, access_log=None)]
    runtime_written = False
    try:
        for runner in runners:
            await runner.setup()
        await web.TCPSite(runners[0], args.bind, args.port, ssl_context=tls, backlog=16).start()
        await web.TCPSite(runners[1], "127.0.0.1", args.receiver_port, backlog=8).start()
        args.runtime.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        temporary = args.runtime.with_name(f".receiver-{secrets.token_hex(16)}")
        try:
            descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                json.dump({
                    "endpoint": f"http://127.0.0.1:{args.receiver_port}",
                    "token": session.receiver_token,
                    "public_url": args.public_url,
                    "fingerprint": fingerprint,
                    "process_id": os.getpid(),
                }, stream)
            os.link(temporary, args.runtime)
            runtime_written = True
        finally:
            temporary.unlink(missing_ok=True)
        LOGGER.info("Local screen receiver ready")
        stopped = asyncio.Event()
        for signum in (signal.SIGINT, signal.SIGTERM):
            asyncio.get_running_loop().add_signal_handler(signum, stopped.set)
        while not stopped.is_set() and os.getppid() == parent:
            try:
                await asyncio.wait_for(stopped.wait(), timeout=2)
            except TimeoutError:
                session.expire()
    finally:
        if runtime_written:
            args.runtime.unlink(missing_ok=True)
        for runner in runners:
            await runner.cleanup()


def main() -> None:
    parser = argparse.ArgumentParser(description="Local, paired WebRTC signaling for the TV launcher")
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8091)
    parser.add_argument("--receiver-port", type=int, default=8092)
    parser.add_argument("--public-url", required=True)
    parser.add_argument("--certificate", type=Path, required=True)
    parser.add_argument("--trust-certificate", type=Path)
    parser.add_argument("--private-key", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--parent-pid", type=int)
    args = parser.parse_args()
    ipaddress.ip_address(args.bind)
    public = urlsplit(args.public_url)
    if public.scheme != "https" or public.path or public.query or public.fragment or public.username or public.password:
        parser.error("public-url must be an HTTPS origin without credentials or path")
    if not 1 <= args.port <= 65535 or not 1 <= args.receiver_port <= 65535 or args.port == args.receiver_port:
        parser.error("ports must be distinct and in range 1..65535")
    logging.basicConfig(level=logging.INFO, format="%(name)s: %(message)s")
    try:
        asyncio.run(run(args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
