#!/usr/bin/python3
from __future__ import annotations

import argparse
import getpass
from pathlib import Path
import re
import ssl
import sys
import urllib.error
import urllib.request
from urllib.parse import urlsplit


def main() -> None:
    parser = argparse.ArgumentParser(description="Read paired Orange Pi microphones as raw PCM on stdout")
    parser.add_argument("--url", required=True, help="HTTPS origin shown on the TV, e.g. https://10.3.0.102:8091")
    parser.add_argument("--certificate", type=Path, required=True, help="Trusted public Orange Pi certificate, never server.key")
    parser.add_argument("--channel", choices=["stereo", "1", "2"], default="stereo")
    args = parser.parse_args()
    origin = urlsplit(args.url)
    if origin.scheme != "https" or not origin.hostname or origin.path or origin.query or origin.fragment or origin.username or origin.password:
        parser.error("url must be an HTTPS origin without credentials or path")
    if sys.stdout.isatty():
        parser.error("Pipe stdout to your audio processor or redirect it to a PCM file")
    token = getpass.getpass("Temporary microphone key (paste from paired browser): ")
    if re.fullmatch(r"[A-Za-z0-9_-]{43}", token) is None:
        parser.error("Invalid microphone key")
    request = urllib.request.Request(args.url + "/api/microphone-audio", headers={"Authorization": "Bearer " + token})
    try:
        context = ssl.create_default_context(cafile=str(args.certificate))
        with urllib.request.urlopen(request, context=context, timeout=10) as response:
            if response.headers.get("X-Audio-Format") != "S16LE;rate=48000;channels=2;layout=interleaved":
                raise ValueError("Unexpected microphone format")
            print("Receiving 48000 Hz S16LE " + args.channel + " PCM; Ctrl+C stops capture.", file=sys.stderr)
            pending = b""
            while chunk := response.read1(8192):
                pending += chunk
                size = len(pending) // 4 * 4
                data, pending = pending[:size], pending[size:]
                if args.channel != "stereo":
                    offset = 0 if args.channel == "1" else 2
                    data = b"".join(data[index:index + 2] for index in range(offset, len(data), 4))
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
            print("Microphone stream ended; reconnect or check the TV receiver.", file=sys.stderr)
    except (OSError, ValueError, urllib.error.URLError) as error:
        print(f"Microphone stream failed: {error}", file=sys.stderr)
        raise SystemExit(1) from None


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
