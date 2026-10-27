from __future__ import annotations

import contextlib
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time
import uuid

import gi

gi.require_version("GLib", "2.0")
from gi.repository import GLib


PROFILE_ROOT = Path("/etc/NetworkManager/system-connections")
AP_FILE = PROFILE_ROOT / "tvbox-event-ap.nmconnection"
AP_ID = "tvbox-event-ap"
AP_ADDRESS = "10.77.0.1"
LAN_ADDRESS = "10.77.1.1"
NM_ENV = {"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C", "LC_ALL": "C"}


class NetworkError(Exception):
    pass


class NetworkBusy(NetworkError):
    pass


def command(arguments: list[str], timeout: int = 12) -> str:
    result = subprocess.run(arguments, capture_output=True, text=True, timeout=timeout, env=NM_ENV)
    if result.returncode:
        raise NetworkError("Сетевая операция не выполнена. Проверьте адаптер, пароль и доступность сети.")
    if len(result.stdout) > 512 * 1024:
        raise NetworkError("Слишком большой ответ сетевой службы.")
    return result.stdout.strip()


def nm(*arguments: str, timeout: int = 12) -> str:
    return command(["/usr/bin/nmcli", "--wait", str(min(timeout, 40)), *arguments], timeout + 3)


def fields(line: str) -> list[str]:
    values, current, escaped = [], "", False
    for character in line:
        if escaped:
            current += character
            escaped = False
        elif character == "\\":
            escaped = True
        elif character == ":":
            values.append(current)
            current = ""
        else:
            current += character
    values.append(current)
    return values


def wifi_device() -> str | None:
    for line in nm("-t", "-f", "DEVICE,TYPE", "device", "status").splitlines():
        device, kind = fields(line)
        if kind == "wifi" and re.fullmatch(r"[A-Za-z0-9_-]{1,15}", device):
            return device
    return None


def active_ap() -> bool:
    return AP_ID in nm("-g", "NAME", "connection", "show", "--active").splitlines()


def ipv4_addresses() -> list[dict]:
    result = json.loads(command(["/usr/sbin/ip", "-j", "-4", "address", "show"]))
    return [{"interface": item["ifname"], "address": address["local"]}
            for item in result for address in item.get("addr_info", [])
            if address.get("scope") == "global" and not ipaddress.ip_address(address["local"]).is_loopback]


def networks(device: str, rescan: bool) -> list[dict]:
    if rescan and not active_ap():
        nm("device", "wifi", "rescan", "ifname", device, timeout=20)
    rows = nm("-t", "-f", "BSSID,SSID,SECURITY,SIGNAL,IN-USE", "device", "wifi", "list",
              "ifname", device, "--rescan", "no")
    found = {}
    for line in rows.splitlines():
        bssid, ssid, security, strength, used = fields(line)
        if not ssid or len(ssid.encode()) > 32 or any(ord(character) < 32 for character in ssid):
            continue
        security = "Open" if security in {"", "--"} else security
        supported = (security == "Open" or "WPA" in security) and "802.1X" not in security and "WEP" not in security
        item = {"bssid": bssid, "ssid": ssid, "security": security,
                "signal": int(strength), "active": used == "*", "supported": supported}
        previous = found.get(ssid)
        if previous is None or item["active"] or (not previous["active"] and item["signal"] > previous["signal"]):
            found[ssid] = item
    return sorted(found.values(), key=lambda item: (not item["active"], -item["signal"], item["ssid"]))[:80]


def status(rescan: bool = False) -> dict:
    device = wifi_device()
    addresses = ipv4_addresses()
    ap = active_ap()
    ap_supported = device is not None and nm("-g", "WIFI-PROPERTIES.AP", "device", "show", device) == "yes"
    return {"device": device, "ap_supported": ap_supported, "ap_active": ap,
            "ap_ready": AP_FILE.is_file(), "ssid": "karaorangePi", "addresses": addresses,
            "networks": networks(device, rescan) if device else [],
            "ethernet_role": "lan" if Path("/run/systemd/network/00-tvbox-event-lan.network").exists() else "uplink"}


def write_profile(path: Path, values: dict) -> None:
    keyfile = GLib.KeyFile()
    for group, properties in values.items():
        for name, value in properties.items():
            keyfile.set_string(group, name, str(value))
    encoded, _length = keyfile.to_data()
    descriptor, temporary = tempfile.mkstemp(prefix=".tvbox-", dir=PROFILE_ROOT)
    try:
        with os.fdopen(descriptor, "w") as output:
            output.write(encoded)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        nm("connection", "load", str(path))
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def setup_ap(password: object) -> None:
    if os.environ.get("SUDO_USER"):
        raise NetworkError("Первичная настройка доступна только администратору.")
    if AP_FILE.exists():
        raise NetworkError("Точка доступа уже настроена; существующий пароль не заменён.")
    if not isinstance(password, str) or not 8 <= len(password.encode()) <= 63 or not password.isascii() or not password.isprintable():
        raise NetworkError("Пароль WPA2 должен содержать 8–63 печатных ASCII символа.")
    write_profile(AP_FILE, {
        "connection": {"id": AP_ID, "uuid": str(uuid.uuid4()), "type": "wifi", "autoconnect": "false"},
        "wifi": {"mode": "ap", "ssid": "karaorangePi", "band": "a", "channel": "36", "powersave": "2"},
        "wifi-security": {"key-mgmt": "wpa-psk", "proto": "rsn;", "pairwise": "ccmp;", "psk": password},
        "ipv4": {"method": "shared", "address1": f"{AP_ADDRESS}/24", "never-default": "true"},
        "ipv6": {"method": "disabled"},
    })


def check_subnets() -> None:
    routes = json.loads(command(["/usr/sbin/ip", "-j", "-4", "route", "show"]))
    private = [ipaddress.ip_network("10.77.0.0/24"), ipaddress.ip_network("10.77.1.0/24")]
    for route in routes:
        destination = route.get("dst", "default")
        if destination == "default":
            continue
        existing = ipaddress.ip_network(destination, strict=False)
        if any(existing.overlaps(subnet) for subnet in private):
            raise NetworkError("Подсети 10.77.0.0/24 или 10.77.1.0/24 уже заняты. Точка доступа не включена.")


def connect(request: dict, device: str) -> None:
    bssid = request.get("bssid")
    if not isinstance(bssid, str) or not re.fullmatch(r"(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}", bssid):
        raise NetworkError("Выберите сеть из списка.")
    candidates = networks(device, False)
    candidate = next((item for item in candidates if item["bssid"].lower() == bssid.lower()), None)
    if candidate is None or not candidate["supported"]:
        raise NetworkError("Сеть исчезла или требует неподдерживаемой корпоративной авторизации.")
    password = request.get("password", "")
    if not isinstance(password, str) or len(password.encode()) > 128 or "\x00" in password:
        raise NetworkError("Некорректный пароль сети.")
    identity = "tvbox-wifi-" + hashlib.sha256(candidate["ssid"].encode()).hexdigest()[:20]
    path = PROFILE_ROOT / f"{identity}.nmconnection"
    if password or not path.is_file():
        secure = candidate["security"] != "Open"
        if secure and not (8 <= len(password.encode()) <= 63 or re.fullmatch(r"[0-9A-Fa-f]{64}", password)):
            raise NetworkError("Для этой сети нужен пароль WPA/WPA2/WPA3, обычно от 8 символов.")
        values = {
            "connection": {"id": identity, "uuid": str(uuid.uuid5(uuid.NAMESPACE_DNS, identity)),
                           "type": "wifi", "interface-name": device, "autoconnect": "true", "autoconnect-retries": "2"},
            "wifi": {"mode": "infrastructure", "ssid": candidate["ssid"], "powersave": "2"},
            "ipv4": {"method": "auto", "route-metric": "200"},
            "ipv6": {"method": "auto", "route-metric": "200"},
        }
        if secure:
            values["wifi-security"] = {"key-mgmt": "sae" if "WPA3" in candidate["security"] and "WPA2" not in candidate["security"] else "wpa-psk", "psk": password}
        write_profile(path, values)
    nm("radio", "wifi", "on")
    nm("connection", "up", "id", identity, "ifname", device, timeout=40)


def dispatch(request: dict) -> dict:
    action = request.get("action")
    allowed = {"status": {"action"}, "scan": {"action"}, "connect": {"action", "bssid", "password"},
               "disconnect": {"action"}, "ap-on": {"action"}, "ap-off": {"action"}, "setup": {"action", "password"}}
    if not isinstance(action, str) or action not in allowed or request.keys() - allowed[action]:
        raise NetworkError("Некорректная сетевая операция.")
    if action == "setup":
        setup_ap(request.get("password"))
        return {"configured": True}
    if action in {"status", "scan"}:
        return status(action == "scan")
    device = wifi_device()
    if not device:
        raise NetworkError("USB Wi-Fi адаптер не найден. Проверьте подключение и драйвер.")
    if action == "connect":
        connect(request, device)
    elif action == "ap-on" and not active_ap():
        if not AP_FILE.is_file():
            raise NetworkError("Администратор ещё не настроил точку доступа.")
        if nm("-g", "WIFI-PROPERTIES.AP", "device", "show", device) != "yes":
            raise NetworkError("Драйвер этого адаптера не поддерживает точку доступа.")
        check_subnets()
        nm("radio", "wifi", "on")
        nm("connection", "up", "id", AP_ID, "ifname", device, timeout=40)
    elif action == "disconnect":
        nm("device", "disconnect", device)
    elif action == "ap-off" and active_ap():
        nm("device", "disconnect", device)
    return status()


@contextlib.contextmanager
def network_lock(wait_seconds: float = 0):
    root = Path("/run/tvbox-network")
    root.mkdir(mode=0o700, exist_ok=True)
    descriptor = os.open(root / "lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "a") as lock:
        deadline = time.monotonic() + wait_seconds
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError as error:
                if time.monotonic() >= deadline:
                    raise NetworkBusy("Сеть уже перенастраивается. Повторите через несколько секунд.") from error
                time.sleep(0.1)
        yield


def main() -> None:
    os.umask(0o077)
    try:
        if os.geteuid() != 0 or len(sys.argv) != 1:
            raise NetworkError("Недостаточно прав для настройки сети.")
        signal.alarm(5)
        raw = sys.stdin.buffer.read(4097)
        signal.alarm(0)
        if len(raw) > 4096:
            raise NetworkError("Слишком большой запрос.")
        request = json.loads(raw)
        if not isinstance(request, dict):
            raise NetworkError("Некорректный запрос.")
        if request.get("action") == "status":
            result = dispatch(request)
        else:
            with network_lock(6):
                result = dispatch(request)
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
    except (NetworkError, OSError, ValueError, GLib.Error, subprocess.SubprocessError) as error:
        message = str(error) if isinstance(error, NetworkError) else "Сетевая служба недоступна. Проверьте её установку и драйвер адаптера."
        print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
        sys.exit(1)
