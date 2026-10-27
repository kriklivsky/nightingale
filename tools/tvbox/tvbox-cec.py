#!/usr/bin/python3
from __future__ import annotations

import argparse
import glob
import os
import re
import subprocess
import threading
import time
from pathlib import Path

from evdev import InputDevice, UInput, ecodes, list_devices


VIRTUAL_NAME = "tvbox-cec-keyboard"
BACK_HOLD_SECONDS = 2.0
MENU_REFRESH_SECONDS = 15.0
WAKE_THROTTLE_SECONDS = 8.0
WAKE_LOCK = threading.Lock()
LAST_WAKE = float("-inf")
KEY_MAP = {
    ecodes.KEY_UP: ecodes.KEY_UP,
    ecodes.KEY_DOWN: ecodes.KEY_DOWN,
    ecodes.KEY_LEFT: ecodes.KEY_LEFT,
    ecodes.KEY_RIGHT: ecodes.KEY_RIGHT,
    ecodes.KEY_OK: ecodes.KEY_ENTER,
    ecodes.KEY_SELECT: ecodes.KEY_ENTER,
    ecodes.KEY_ENTER: ecodes.KEY_ENTER,
    ecodes.KEY_BACK: ecodes.KEY_ESC,
    ecodes.KEY_EXIT: ecodes.KEY_ESC,
    ecodes.KEY_ESC: ecodes.KEY_ESC,
    ecodes.KEY_PLAYPAUSE: ecodes.KEY_PLAYPAUSE,
    ecodes.KEY_PLAY: ecodes.KEY_PLAY,
    ecodes.KEY_PAUSE: ecodes.KEY_PAUSE,
    ecodes.KEY_STOP: ecodes.KEY_STOP,
    ecodes.KEY_HOME: ecodes.KEY_HOME,
    ecodes.KEY_MENU: ecodes.KEY_MENU,
    ecodes.KEY_PREVIOUSSONG: ecodes.KEY_PREVIOUSSONG,
    ecodes.KEY_NEXTSONG: ecodes.KEY_NEXTSONG,
}
BACK_KEYS = {ecodes.KEY_BACK, ecodes.KEY_EXIT, ecodes.KEY_ESC}


def log(message: str) -> None:
    print(f"tvbox-cec: {message}", flush=True)


def configure_cec_adapter() -> None:
    for adapter in sorted(glob.glob("/dev/cec*")):
        try:
            result = subprocess.run(
                ["/usr/bin/cec-ctl", "--device", adapter, "--playback",
                 "--osd-name", "OrangePiTV"],
                capture_output=True,
                text=True,
                timeout=8,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            log(f"{adapter} is not ready ({error})")
            continue
        mask = re.search(r"Logical Address Mask\s*:\s*0x([0-9a-fA-F]+)", result.stdout)
        if result.returncode == 0 and mask and int(mask.group(1), 16) != 0:
            log(f"configured {adapter} as playback device")
            return
        if result.returncode == 0:
            log(f"{adapter} has no logical address yet; will retry")
            continue
        detail = result.stderr.strip().splitlines()
        log(f"{adapter} is not ready ({detail[-1] if detail else result.returncode})")


def cec_address_allocated() -> bool:
    for adapter in sorted(glob.glob("/dev/cec*")):
        try:
            result = subprocess.run(["/usr/bin/cec-ctl", "--device", adapter],
                                    capture_output=True, text=True, timeout=3, check=False)
        except (OSError, subprocess.TimeoutExpired):
            continue
        mask = re.search(r"Logical Address Mask\s*:\s*0x([0-9a-fA-F]+)", result.stdout)
        if mask and int(mask.group(1), 16) != 0:
            return True
    return False


def request_menu_control() -> None:
    """Ask the TV to forward navigation keys without reallocating our CEC address."""
    for adapter in sorted(glob.glob("/dev/cec*")):
        try:
            subprocess.run(
                [
                    "/usr/bin/cec-ctl",
                    "--device",
                    adapter,
                    "--to",
                    "0",
                    "--menu-request",
                    "menu-req=activate",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=5,
                check=False,
            )
        except subprocess.TimeoutExpired:
            pass


def maintain_menu_control() -> None:
    while True:
        if not cec_address_allocated():
            configure_cec_adapter()
        request_menu_control()
        time.sleep(MENU_REFRESH_SECONDS)


def selected_route_matches(selected: str, physical: str, allow_parent: bool = True) -> bool:
    if re.fullmatch(r"[0-9a-f](?:\.[0-9a-f]){3}", selected, re.I) is None:
        return False
    if selected.lower() == physical.lower():
        return True
    if not allow_parent:
        return False
    parts = physical.lower().split(".")
    nonzero = [index for index, part in enumerate(parts) if part != "0"]
    if len(nonzero) < 2:
        return False
    parts[nonzero[-1]] = "0"
    return selected.lower() == ".".join(parts)


def reported_active_route(output: str) -> str | None:
    route = None
    pending = None
    for raw in output.splitlines():
        line = raw.strip()
        if line.startswith("Received from "):
            if "ACTIVE_SOURCE (0x82)" in line:
                pending = "phys-addr"
            elif line.startswith(("Received from TV ", "Received from Audio System ")):
                if "ROUTING_CHANGE (0x80)" in line:
                    pending = "new-phys-addr"
                elif "ROUTING_INFORMATION (0x81)" in line or "SET_STREAM_PATH (0x86)" in line:
                    pending = "phys-addr"
                else:
                    pending = None
            else:
                pending = None
        elif pending and line.startswith(f"{pending}:"):
            selected = line.partition(":")[2].strip()
            if re.fullmatch(r"[0-9a-f](?:\.[0-9a-f]){3}", selected, re.I):
                route = selected
            pending = None
    return route


def recover_startup_source() -> None:
    deadline = time.monotonic() + 60
    env = {**os.environ, "DISPLAY": ":0", "XAUTHORITY": "/run/tvbox.Xauthority"}
    while time.monotonic() < deadline:
        try:
            adapters = sorted(glob.glob("/dev/cec*"))
            if not adapters:
                time.sleep(2)
                continue
            adapter = adapters[0]
            info = subprocess.run(["cec-ctl", "--device", adapter], capture_output=True,
                                  text=True, timeout=3, check=False)
            physical = re.search(r"Physical Address\s*:\s*([0-9a-fA-F.]+)", info.stdout)
            mask = re.search(r"Logical Address Mask\s*:\s*0x([0-9a-fA-F]+)", info.stdout)
            if not physical or physical.group(1).lower() == "f.f.f.f" or not mask or int(mask.group(1), 16) == 0:
                time.sleep(2)
                continue
            display = subprocess.run(["xrandr", "--current"], env=env, capture_output=True,
                                     text=True, timeout=3, check=False)
            if display.returncode != 0 or not re.search(r"^\S+ connected.*\d+x\d+\+", display.stdout, re.MULTILINE):
                time.sleep(2)
                continue
            power = subprocess.run(["cec-ctl", "--device", adapter, "--to", "0",
                                    "--give-device-power-status"], capture_output=True,
                                   text=True, timeout=5, check=False)
            if re.search(r"pwr-state:\s*(?:standby|to-standby)\s+\(", power.stdout):
                log("startup HDMI announcement skipped: TV is in standby")
                return
            if power.returncode != 0 or not re.search(r"pwr-state:\s*on\s+\(", power.stdout):
                time.sleep(2)
                continue
            active = subprocess.run(["cec-ctl", "--device", adapter, "--request-active-source",
                                     "--monitor", "--monitor-time", "3"], capture_output=True,
                                    text=True, timeout=8, check=False)
            if active.returncode != 0:
                time.sleep(2)
                continue
            selected = reported_active_route(active.stdout)
            if selected and not selected_route_matches(selected, physical.group(1)):
                log(f"startup HDMI announcement skipped: another source is active ({selected})")
                return
            if request_selected_source_wake(True, retrain=False):
                log("startup HDMI announcement requested without changing the video mode")
            return
        except (OSError, subprocess.TimeoutExpired) as error:
            log(f"startup HDMI check not ready ({error})")
            time.sleep(2)
    log("startup HDMI announcement skipped: display/CEC/TV did not become ready within 60 seconds")


def monitor_source_selection() -> None:
    while True:
        adapters = sorted(glob.glob("/dev/cec*"))
        if not adapters:
            time.sleep(2)
            continue
        adapter = adapters[0]
        try:
            with subprocess.Popen(
                ["/usr/bin/stdbuf", "-oL", "/usr/bin/cec-ctl",
                 "--device", adapter, "--monitor"],
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                text=True, bufsize=1,
            ) as monitor:
                physical = None
                pending = None
                if monitor.stdout is None:
                    raise OSError("CEC monitor has no output")
                for raw in monitor.stdout:
                    line = raw.strip()
                    state = re.search(r"State Change: PA: ([0-9a-fA-F.]+)", line)
                    if state:
                        physical = state.group(1)
                    elif line.startswith(("Received from TV ", "Received from Audio System ")):
                        if "ROUTING_CHANGE (0x80)" in line:
                            pending = ("new-phys-addr", True)
                        elif "SET_STREAM_PATH (0x86)" in line:
                            pending = ("phys-addr", True)
                        elif "ACTIVE_SOURCE (0x82)" in line:
                            pending = ("phys-addr", False)
                        else:
                            pending = None
                    elif pending and line.startswith(f"{pending[0]}:"):
                        selected = line.partition(":")[2].strip()
                        if physical and selected_route_matches(selected, physical, pending[1]):
                            log(f"TV selected HDMI route {selected}; restoring picture")
                            if not cec_address_allocated():
                                configure_cec_adapter()
                            request_menu_control()
                            request_selected_source_wake(selected.lower() != physical.lower())
                        pending = None
                log(f"CEC monitor exited ({monitor.returncode}); restarting")
        except OSError as error:
            log(f"CEC monitor unavailable: {error}")
        time.sleep(2)


def request_selected_source_wake(wait_for_cec: bool = False, *, retrain: bool = True) -> bool:
    """Serialize startup and selected-route HDMI recovery."""
    global LAST_WAKE
    if not WAKE_LOCK.acquire(blocking=False):
        return False
    if time.monotonic() - LAST_WAKE < WAKE_THROTTLE_SECONDS:
        WAKE_LOCK.release()
        return False
    LAST_WAKE = time.monotonic()

    def wake_and_release() -> None:
        global LAST_WAKE
        try:
            if wait_for_cec:
                for _ in range(30):
                    if cec_address_allocated():
                        break
                    time.sleep(2)
                else:
                    log("CEC address unavailable after TV selected soundbar route")
                    return
            perform_display_wake(wait_for_cec, retrain=retrain)
        finally:
            LAST_WAKE = time.monotonic()
            WAKE_LOCK.release()

    threading.Thread(target=wake_and_release, daemon=True).start()
    return True


def perform_display_wake(activate_source: bool = False, *, retrain: bool = True) -> None:
    """Announce our source, optionally retraining HDMI for a routing event."""
    try:
        time.sleep(1)
        env = {**os.environ, "DISPLAY": ":0", "XAUTHORITY": "/run/tvbox.Xauthority"}
        kind_file = Path("/run/tvbox-active.kind")
        kind = kind_file.read_text().strip() if kind_file.exists() else "launcher"
        result = subprocess.run(["xrandr", "--current"], env=env,
                                capture_output=True, text=True, timeout=3, check=False)
        match = re.search(r"^(\S+) connected", result.stdout, re.MULTILINE)
        current_4k60 = re.search(r"^\s*3840x2160\s+[^\n]*60\.00\*",
                                result.stdout, re.MULTILINE)
        if retrain and match and (current_4k60 or kind != "moonlight"):
            output = match.group(1)
            if current_4k60:
                retrained = subprocess.run(["xrandr", "--output", output, "--mode", "3840x2160", "--rate", "59.94"],
                                          env=env, capture_output=True, timeout=5, check=False)
                if retrained.returncode == 0:
                    time.sleep(1)
                else:
                    log(f"HDMI retrain failed: {retrained.stderr.decode(errors='replace').strip()}")
            mode = subprocess.run(["xrandr", "--output", output, "--mode", "3840x2160", "--rate", "60"],
                                  env=env, capture_output=True, timeout=5, check=False)
            if mode.returncode == 0:
                log("retrained HDMI at 3840x2160@60" if current_4k60 else "restored HDMI mode 3840x2160@60")
            else:
                log(f"HDMI mode restore failed: {mode.stderr.decode(errors='replace').strip()}")

        for adapter in sorted(glob.glob("/dev/cec*")):
            try:
                result = subprocess.run(["cec-ctl", "--device", adapter],
                                        capture_output=True, text=True, timeout=3, check=False)
            except (OSError, subprocess.TimeoutExpired) as error:
                log(f"CEC adapter {adapter} unavailable ({error})")
                continue
            match = re.search(r"Physical Address\s*:\s*([0-9a-fA-F.]+)", result.stdout)
            if not match or match.group(1).lower() == "f.f.f.f":
                continue
            physical = match.group(1)
            try:
                if activate_source:
                    wake = subprocess.run(["cec-ctl", "--device", adapter, "--to", "0", "--image-view-on"],
                                          capture_output=True, timeout=5, check=False)
                    if wake.returncode != 0:
                        log(f"CEC image-view-on failed with exit code {wake.returncode}")
                    else:
                        time.sleep(1)
                sent = subprocess.run(["cec-ctl", "--device", adapter, "--to", "15",
                                       "--active-source", f"phys-addr={physical}"],
                                      capture_output=True, timeout=5, check=False)
                if sent.returncode != 0:
                    log(f"CEC active-source failed with exit code {sent.returncode}")
            except (OSError, subprocess.TimeoutExpired) as error:
                log(f"CEC active-source failed ({error})")
        log("display wake request completed")
    except (OSError, subprocess.TimeoutExpired) as error:
        log(f"display wake failed: {error}")


def find_cec_input() -> InputDevice | None:
    for path in sorted(list_devices()):
        try:
            device = InputDevice(path)
            resolved = Path(path).resolve().name
            sys_path = Path("/sys/class/input") / resolved / "device"
            target = str(sys_path.resolve())
            name = device.name.lower()
            if name != VIRTUAL_NAME and "/rc/" in target and (
                "hdmi" in name or "cec" in name
            ):
                return device
            device.close()
        except OSError:
            continue
    return None


class Bridge:
    def __init__(self, output: UInput):
        self.output = output
        self.lock = threading.Lock()
        self.back_timer: threading.Timer | None = None
        self.back_long = False

    def emit(self, code: int, value: int) -> None:
        self.output.write(ecodes.EV_KEY, code, value)
        self.output.syn()

    def emit_click(self, code: int) -> None:
        self.emit(code, 1)
        self.emit(code, 0)

    def long_back(self) -> None:
        with self.lock:
            self.back_long = True
        log("long Back: requesting return to launcher")
        subprocess.run(["/usr/local/bin/tvbox-return"], check=False, timeout=5)

    def handle_back(self, value: int) -> None:
        with self.lock:
            if value == 1:
                if self.back_timer is not None:
                    self.back_timer.cancel()
                self.back_long = False
                self.back_timer = threading.Timer(BACK_HOLD_SECONDS, self.long_back)
                self.back_timer.daemon = True
                self.back_timer.start()
                return
            if value == 2:
                return
            timer = self.back_timer
            self.back_timer = None
            long_press = self.back_long
            if timer is not None:
                timer.cancel()
        if not long_press:
            self.emit_click(ecodes.KEY_ESC)

    def handle(self, code: int, value: int) -> None:
        mapped = KEY_MAP.get(code)
        if mapped is None:
            return
        if code in BACK_KEYS:
            self.handle_back(value)
        else:
            self.emit(mapped, value)

    def reset(self) -> None:
        with self.lock:
            if self.back_timer is not None:
                self.back_timer.cancel()
                self.back_timer = None
            self.back_long = False
        for code in sorted(set(KEY_MAP.values())):
            self.emit(code, 0)


def make_uinput() -> UInput:
    return UInput(
        {ecodes.EV_KEY: sorted(set(KEY_MAP.values()))},
        name=VIRTUAL_NAME,
        vendor=0x524B,
        product=0xCEC0,
        version=1,
    )


def self_test() -> int:
    with make_uinput() as output:
        log(f"self-test device: {output.device}")
        time.sleep(1)
        bridge = Bridge(output)
        for code in (ecodes.KEY_UP, ecodes.KEY_ENTER, ecodes.KEY_ESC):
            bridge.emit_click(code)
            time.sleep(0.25)
        time.sleep(2)
    return 0


def run() -> int:
    with make_uinput() as output:
        log(f"virtual keyboard ready: {output.device}")
        configure_cec_adapter()
        menu_thread = threading.Thread(target=maintain_menu_control, daemon=True)
        menu_thread.start()
        monitor_thread = threading.Thread(target=monitor_source_selection, daemon=True)
        monitor_thread.start()
        startup_thread = threading.Thread(target=recover_startup_source, daemon=True)
        startup_thread.start()
        while True:
            source = find_cec_input()
            if source is None:
                log("CEC rc input is unavailable; retrying")
                configure_cec_adapter()
                time.sleep(2)
                continue
            bridge = Bridge(output)
            try:
                source.grab()
                log(f"forwarding {source.path} ({source.name})")
                for event in source.read_loop():
                    if event.type == ecodes.EV_KEY:
                        bridge.handle(event.code, event.value)
            except OSError as error:
                log(f"input disconnected: {error}; retrying")
            finally:
                bridge.reset()
                try:
                    source.ungrab()
                except OSError:
                    pass
                source.close()
            configure_cec_adapter()
            time.sleep(2)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    return self_test() if args.self_test else run()


if __name__ == "__main__":
    raise SystemExit(main())
