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
                            request_selected_source_wake()
                        pending = None
                log(f"CEC monitor exited ({monitor.returncode}); restarting")
        except OSError as error:
            log(f"CEC monitor unavailable: {error}")
        time.sleep(2)


def request_selected_source_wake() -> bool:
    """Restore HDMI only after the TV or soundbar selects our CEC route."""
    global LAST_WAKE
    if not WAKE_LOCK.acquire(blocking=False):
        return False
    if time.monotonic() - LAST_WAKE < WAKE_THROTTLE_SECONDS:
        WAKE_LOCK.release()
        return False
    LAST_WAKE = time.monotonic()

    def wake_and_release() -> None:
        try:
            perform_display_wake()
        finally:
            WAKE_LOCK.release()

    threading.Thread(target=wake_and_release, daemon=True).start()
    return True


def perform_display_wake() -> None:
    """Restore HDMI after our source was selected on the TV."""
    try:
        # Let the soundbar's HDMI repeater finish waking before retraining.
        time.sleep(1)
        env = {**os.environ, "DISPLAY": ":0", "XAUTHORITY": "/run/tvbox.Xauthority"}
        kind_file = Path("/run/tvbox-active.kind")
        kind = kind_file.read_text().strip() if kind_file.exists() else "launcher"
        if kind != "moonlight":
            result = subprocess.run(["xrandr", "--current"], env=env,
                                    capture_output=True, text=True, timeout=3, check=False)
            match = re.search(r"^(\S+) connected", result.stdout, re.MULTILINE)
            if match:
                output = match.group(1)
                subprocess.run(["xrandr", "--output", output, "--mode", "3840x2160", "--rate", "29.97"],
                               env=env, capture_output=True, timeout=5, check=False)
                time.sleep(0.25)
                mode = subprocess.run(["xrandr", "--output", output, "--mode", "3840x2160", "--rate", "30"],
                                      env=env, capture_output=True, timeout=5, check=False)
                if mode.returncode == 0:
                    log("retrained HDMI at 3840x2160@30")
                else:
                    log(f"HDMI retrain failed: {mode.stderr.decode(errors='replace').strip()}")
        for adapter in sorted(glob.glob("/dev/cec*")):
            result = subprocess.run(["cec-ctl", "--device", adapter],
                                    capture_output=True, text=True, timeout=3, check=False)
            match = re.search(r"Physical Address\s*:\s*([0-9a-fA-F.]+)", result.stdout)
            if not match or match.group(1).lower() == "f.f.f.f":
                continue
            for _ in range(2):
                subprocess.run(["cec-ctl", "--device", adapter, "--to", "0",
                                "--image-view-on", "--active-source", f"phys-addr={match.group(1)}"],
                               capture_output=True, timeout=5, check=False)
                time.sleep(0.5)
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
