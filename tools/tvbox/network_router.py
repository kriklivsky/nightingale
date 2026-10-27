from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import struct
import time

from network_backend import AP_ADDRESS, LAN_ADDRESS, NetworkBusy, NetworkError, active_ap, command, ipv4_addresses, network_lock


INTERFACE = "end1"
OVERRIDE = Path("/run/systemd/network/00-tvbox-event-lan.network")
STATE = Path("/run/tvbox-event-router.json")
NETWORK = f"""[Match]
Name={INTERFACE}

[Network]
Address={LAN_ADDRESS}/24
DHCPServer=yes
LinkLocalAddressing=no
IPv6AcceptRA=no
IPv4Forwarding=yes
IPv6Forwarding=no
IPMasquerade=ipv4

[DHCPServer]
PoolOffset=20
PoolSize=200
EmitDNS=yes
DNS={AP_ADDRESS}
EmitRouter=yes
"""


def configure(lan: bool) -> None:
    if lan == OVERRIDE.exists():
        return
    if lan:
        OVERRIDE.write_text(NETWORK)
    else:
        OVERRIDE.unlink()
    command(["/usr/bin/networkctl", "reload"])
    command(["/usr/bin/networkctl", "reconfigure", INTERFACE])


def external_dhcp() -> bool:
    transaction = int.from_bytes(os.urandom(4), "big")
    mac = bytes.fromhex(Path(f"/sys/class/net/{INTERFACE}/address").read_text().strip().replace(":", ""))
    packet = struct.pack("!BBBBIHH4s4s4s4s16s64s128s", 1, 1, 6, 0, transaction, 0, 0x8000,
                         bytes(4), bytes(4), bytes(4), bytes(4), mac.ljust(16, b"\0"), bytes(64), bytes(128))
    packet += b"\x63\x82\x53\x63\x35\x01\x01\x37\x02\x01\x03\xff"
    udp = struct.pack("!HHHH", 68, 67, len(packet) + 8, 0)
    header = struct.pack("!BBHHHBBH4s4s", 0x45, 0, len(packet) + 28, 0, 0, 64, 17, 0,
                         bytes(4), bytes([255]) * 4)
    checksum = sum(struct.unpack("!10H", header))
    while checksum >> 16:
        checksum = (checksum & 0xffff) + (checksum >> 16)
    header = header[:10] + struct.pack("!H", ~checksum & 0xffff) + header[12:]
    ethernet = bytes([255]) * 6 + mac + b"\x08\x00"
    with socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(0x0800)) as probe:
        probe.bind((INTERFACE, 0x0800))
        probe.settimeout(1)
        probe.send(ethernet + header + udp + packet)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                frame = probe.recv(4096)
            except TimeoutError:
                continue
            if len(frame) < 42 or frame[6:12] == mac or frame[12:14] != b"\x08\x00" or frame[14] >> 4 != 4 or frame[23] != 17:
                continue
            offset = 14 + (frame[14] & 15) * 4
            if offset < 34 or len(frame) < offset + 8 or frame[offset:offset + 4] != struct.pack("!HH", 67, 68):
                continue
            response = frame[offset + 8:]
            if len(response) >= 240 and response[0] == 2 and response[4:8] == transaction.to_bytes(4, "big") and response[236:240] == b"\x63\x82\x53\x63":
                return True
    return False


def tick() -> None:
    link = Path(f"/sys/class/net/{INTERFACE}")
    if not link.exists():
        return
    try:
        enabled = active_ap()
    except NetworkError:
        configure(False)
        STATE.unlink(missing_ok=True)
        raise
    if not enabled or link.joinpath("carrier").read_text().strip() != "1":
        configure(False)
        STATE.unlink(missing_ok=True)
        return
    if OVERRIDE.exists():
        if external_dhcp():
            configure(False)
            STATE.unlink(missing_ok=True)
        return
    if any(item["interface"] == INTERFACE for item in ipv4_addresses()):
        STATE.unlink(missing_ok=True)
        return
    now = time.monotonic()
    since = json.loads(STATE.read_text()).get("since", now) if STATE.exists() else now
    if not STATE.exists():
        STATE.write_text(json.dumps({"since": since}))
    if now - since >= 25 and not external_dhcp() and not any(item["interface"] == INTERFACE for item in ipv4_addresses()):
        configure(True)


if __name__ == "__main__":
    try:
        with network_lock():
            tick()
    except NetworkBusy:
        pass
