from __future__ import annotations

import ipaddress
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile


def run(arguments: list[str]) -> str:
    return subprocess.run(arguments, check=True, capture_output=True, text=True, timeout=10).stdout.strip()


def local_addresses() -> list[tuple[str, str]]:
    devices = json.loads(run(["/usr/sbin/ip", "-j", "-4", "address", "show"]))
    return [(device["ifname"], address["local"]) for device in devices
            for address in device.get("addr_info", []) if address.get("scope") == "global"
            and not ipaddress.ip_address(address["local"]).is_loopback]


def preferred_address(addresses: list[tuple[str, str]]) -> str:
    wifi = [(name, address) for name, address in addresses
            if Path(f"/sys/class/net/{name}/wireless").exists() or Path(f"/sys/class/net/{name}/phy80211").exists()]
    if wifi:
        return next((address for _name, address in wifi if address == "10.77.0.1"), wifi[0][1])
    try:
        routes = json.loads(run(["/usr/sbin/ip", "-j", "-4", "route", "get", "1.1.1.1"]))
        source = routes[0].get("prefsrc")
        if any(address == source for _name, address in addresses):
            return source
    except subprocess.SubprocessError:
        pass
    if addresses:
        return addresses[0][1]
    raise RuntimeError("Нет локального IPv4 адреса. Подключите Wi-Fi, включите точку доступа или Ethernet.")


def certificate(config: Path, addresses: list[tuple[str, str]]) -> tuple[Path, Path, Path]:
    authority = config / "server.crt"
    authority_key = config / "server.key"
    leaf = config / "receiver.crt"
    key = config / "receiver.key"
    if not authority.is_file() or not authority_key.is_file():
        raise RuntimeError("HTTPS сертификат не настроен. Запустите tvbox-screen-setup.")
    ips = sorted({address for _name, address in addresses} | {"10.77.0.1", "10.77.1.1"})
    if leaf.is_file() and key.is_file():
        try:
            run(["/usr/bin/openssl", "verify", "-CAfile", str(authority), str(leaf)])
            run(["/usr/bin/openssl", "x509", "-in", str(leaf), "-noout", "-checkend", "86400"])
            for address in ips:
                run(["/usr/bin/openssl", "x509", "-in", str(leaf), "-noout", "-checkip", address])
            return leaf, key, authority
        except subprocess.SubprocessError:
            pass
    with tempfile.TemporaryDirectory(prefix=".receiver-", dir=config) as temporary:
        work = Path(temporary)
        extensions = work / "extensions.cnf"
        extensions.write_text("basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:orangepi5.local," + ",".join(f"IP:{address}" for address in ips) + "\n")
        run(["/usr/bin/openssl", "req", "-new", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:P-256",
             "-nodes", "-keyout", str(work / "key"), "-out", str(work / "request"), "-subj", "/CN=Orange Pi Screen"])
        run(["/usr/bin/openssl", "x509", "-req", "-in", str(work / "request"), "-CA", str(authority),
             "-CAkey", str(authority_key), "-set_serial", "0x" + secrets.token_hex(16), "-days", "30",
             "-sha256", "-extfile", str(extensions), "-out", str(work / "certificate")])
        run(["/usr/bin/openssl", "verify", "-CAfile", str(authority), str(work / "certificate")])
        os.chmod(work / "key", 0o600)
        os.replace(work / "key", key)
        os.replace(work / "certificate", leaf)
    return leaf, key, authority


def main() -> None:
    os.umask(0o077)
    addresses = local_addresses()
    address = preferred_address(addresses)
    config = Path.home() / ".config/tvbox-screen"
    leaf, key, authority = certificate(config, addresses)
    runtime = Path(os.environ["XDG_RUNTIME_DIR"]) / "tvbox-screen"
    runtime.mkdir(mode=0o700, exist_ok=True)
    os.execv("/usr/bin/python3", ["/usr/bin/python3", "/usr/local/libexec/tvbox-screen/screen_server.py",
             "--bind", address, "--public-url", f"https://{address}:8091", "--certificate", str(leaf),
             "--private-key", str(key), "--trust-certificate", str(authority),
             "--assets", "/usr/local/share/tvbox-screen", "--runtime", str(runtime / "receiver.json"),
             "--parent-pid", os.environ["TVBOX_SCREEN_PARENT_PID"]])


if __name__ == "__main__":
    main()
