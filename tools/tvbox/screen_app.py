#!/usr/bin/python3
from __future__ import annotations

import argparse
import json
import logging
import os
from pathlib import Path
import queue
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("GdkX11", "3.0")
gi.require_version("Gst", "1.0")
from gi.repository import Gdk, GdkX11, GLib, Gst, Gtk

from screen_audio import MicrophoneMonitor
from screen_receiver import Receiver


LOGGER = logging.getLogger("tvbox-screen")


class ScreenApplication:
    def __init__(self, config: dict, settings: dict) -> None:
        self.config = config
        self.stopped = threading.Event()
        self.commands = queue.SimpleQueue()
        self.generation = -1
        self.window = Gtk.Window(title="Экран ноутбука")
        self.window.set_default_size(1920, 1080)
        self.window.connect("destroy", Gtk.main_quit)
        self.window.connect("key-press-event", self.key_pressed)
        self.status = Gtk.Label(label="Ожидаем подключения")
        self.microphone_status = Gtk.Label()
        self.receiver = Receiver(self.show_video, self.report)
        self.monitor = MicrophoneMonitor(settings, self.microphone_status.set_text)
        self.welcome = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=24)
        self.welcome.set_halign(Gtk.Align.CENTER)
        self.welcome.set_valign(Gtk.Align.CENTER)
        self.code = Gtk.Label()
        self.code.set_name("pair-code")
        title = Gtk.Label(label="Экран ноутбука")
        title.set_name("screen-title")
        address = Gtk.Label(label=config["public_url"])
        address.set_name("screen-address")
        instructions = Gtk.Label(label="Откройте адрес на ноутбуке, введите код и выберите экран или вкладку.\nДля передачи музыки включите «Передавать звук» в Chrome.")
        instructions.set_justify(Gtk.Justification.CENTER)
        fingerprint = Gtk.Label(label="Сертификат HTTPS · SHA-256\n" + config["fingerprint"])
        fingerprint.set_line_wrap(True)
        fingerprint.set_max_width_chars(48)
        fingerprint.set_selectable(True)
        for widget in [title, address, self.code, instructions, fingerprint]:
            self.welcome.pack_start(widget, False, False, 0)
        overlay = Gtk.Overlay()
        overlay.add(self.receiver.widget)
        overlay.add_overlay(self.welcome)
        footer = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=16)
        footer.set_border_width(16)
        footer.pack_start(self.status, True, True, 0)
        footer.pack_start(self.microphone_status, False, False, 0)
        self.disconnect_button = Gtk.Button(label="Завершить трансляцию")
        self.disconnect_button.set_sensitive(False)
        self.disconnect_button.connect("clicked", lambda _button: self.commands.put("disconnect"))
        microphone_button = Gtk.Button(label="Микрофоны вкл/выкл")
        microphone_button.connect("clicked", lambda _button: self.monitor.toggle())
        exit_button = Gtk.Button(label="В лаунчер · Назад")
        exit_button.connect("clicked", lambda _button: self.window.destroy())
        self.buttons = [self.disconnect_button, microphone_button, exit_button]
        for button in self.buttons:
            footer.pack_start(button, False, False, 0)
        layout = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        layout.pack_start(overlay, True, True, 0)
        layout.pack_start(footer, False, False, 0)
        self.window.add(layout)
        css = Gtk.CssProvider()
        css.load_from_data(b"window { background: #10121c; color: #f1f3fc; } label { color: #f1f3fc; font-size: 18px; } #screen-title { font-size: 44px; font-weight: bold; } #screen-address { font-size: 36px; } #pair-code { font-size: 88px; font-weight: bold; } button { padding: 18px; background: #242b45; color: #f1f3fc; border: 3px solid #424a64; } button:focus { background: #485bba; border-color: #bbc6ff; }")
        Gtk.StyleContext.add_provider_for_screen(self.window.get_screen(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        self.window.show_all()
        self.window.fullscreen()
        exit_button.grab_focus()
        self.fit_attempts = 0
        GLib.timeout_add(250, self.fit_window)
        self.monitor.start()
        self.worker = threading.Thread(target=self.signaling, daemon=True)
        self.worker.start()

    def key_pressed(self, _window, event) -> bool:
        if event.keyval == Gdk.KEY_Escape:
            self.window.destroy()
            return True
        if event.keyval in [Gdk.KEY_Return, Gdk.KEY_KP_Enter, Gdk.KEY_space]:
            focused = self.window.get_focus()
            if isinstance(focused, Gtk.Button) and focused.get_sensitive():
                focused.clicked()
                return True
        if event.keyval in [Gdk.KEY_Left, Gdk.KEY_Right, Gdk.KEY_Up, Gdk.KEY_Down]:
            buttons = [button for button in self.buttons if button.get_sensitive()]
            focused = self.window.get_focus()
            index = buttons.index(focused) if focused in buttons else 0
            step = -1 if event.keyval in [Gdk.KEY_Left, Gdk.KEY_Up] else 1
            buttons[max(0, min(len(buttons) - 1, index + step))].grab_focus()
            return True
        return False

    def report(self, message: str) -> bool:
        self.status.set_text(message)
        return False

    def show_video(self, size: str) -> bool:
        self.welcome.hide()
        self.status.set_text("Трансляция · " + size)
        return False

    def fit_window(self) -> bool:
        self.fit_attempts += 1
        window = self.window.get_window()
        if window is None:
            return self.fit_attempts < 8
        window.set_cursor(Gdk.Cursor.new_for_display(window.get_display(), Gdk.CursorType.BLANK_CURSOR))
        window.focus(Gdk.CURRENT_TIME)
        try:
            geometry = subprocess.run(["xdotool", "getdisplaygeometry"], check=True, capture_output=True, text=True, timeout=2)
            width, height = geometry.stdout.split()
            subprocess.run(["xdotool", "windowsize", str(GdkX11.X11Window.get_xid(window)), width, height], check=True, timeout=2)
        except (OSError, subprocess.SubprocessError, ValueError):
            LOGGER.warning("Could not fit receiver window to display")
        return self.fit_attempts < 8

    def request(self, path: str, body: dict | None = None) -> dict:
        headers = {"Authorization": "Bearer " + self.config["token"], "Origin": self.config["endpoint"]}
        if body is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.config["endpoint"] + "/api/" + path,
            data=None if body is None else json.dumps(body).encode(), headers=headers)
        with urllib.request.urlopen(request, timeout=5) as response:
            data = response.read(128 * 1024 + 1)
            if len(data) > 128 * 1024:
                raise ValueError("Oversized signaling response")
            value = json.loads(data)
            if not isinstance(value, dict):
                raise ValueError("Invalid signaling response")
            return value

    def signaling(self) -> None:
        while not self.stopped.is_set():
            try:
                if not self.commands.empty():
                    self.commands.get_nowait()
                    self.request("disconnect", {})
                while not self.receiver.answers.empty():
                    generation, sdp = self.receiver.answers.get_nowait()
                    self.request("answer", {"generation": generation, "sdp": sdp})
                state = self.request("state")
                GLib.idle_add(self.accept_state, state)
            except (OSError, ValueError, urllib.error.URLError) as error:
                LOGGER.warning("Signaling unavailable: %s", type(error).__name__)
                GLib.idle_add(self.report, "Приёмник недоступен. Вернитесь в лаунчер и повторите.")
            self.stopped.wait(0.5)

    def accept_state(self, state: dict) -> bool:
        if self.stopped.is_set():
            return False
        generation, code = state.get("generation"), state.get("code")
        if not isinstance(generation, int) or not isinstance(code, str) or len(code) != 6 or not code.isdigit():
            self.report("Некорректное состояние приёмника")
            return False
        if self.generation != generation:
            self.generation = generation
            self.receiver.stop()
            self.welcome.show_all()
            self.report("Ожидаем подключения")
        self.code.set_text(code[:3] + " " + code[3:])
        paired = state.get("paired") is True
        self.disconnect_button.set_sensitive(paired)
        offer = state.get("offer")
        if isinstance(offer, str) and self.receiver.generation != generation:
            self.receiver.accept(offer, generation)
            self.report("Подключаем трансляцию…")
        return False

    def close(self) -> None:
        self.stopped.set()
        self.worker.join(timeout=6)
        self.monitor.stop()
        self.receiver.stop()


def main() -> None:
    parser = argparse.ArgumentParser(description="Standalone Orange Pi screen receiver")
    parser.add_argument("--no-microphones", action="store_true")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(name)s: %(message)s")
    settings_path = Path.home() / ".config/tvbox-screen/settings.json"
    settings = json.loads(settings_path.read_text()) if settings_path.is_file() else {}
    if not isinstance(settings, dict):
        raise ValueError("Screen receiver settings must be a JSON object")
    if args.no_microphones:
        settings["microphone_monitoring"] = False
    runtime = Path(os.environ["XDG_RUNTIME_DIR"]) / "tvbox-screen/receiver.json"
    if runtime.exists():
        raise RuntimeError("Screen receiver is already running or its runtime requires cleanup")
    Gst.init(None)
    service = subprocess.Popen(["/usr/local/bin/tvbox-screen-service"], env={**os.environ, "TVBOX_SCREEN_PARENT_PID":str(os.getpid())})
    application = None
    try:
        for _attempt in range(100):
            if runtime.is_file():
                break
            if service.poll() is not None:
                raise RuntimeError("HTTPS screen service failed to start")
            time.sleep(0.1)
        config = json.loads(runtime.read_text())
        application = ScreenApplication(config, settings)
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, lambda: (Gtk.main_quit(), False)[1])
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, lambda: (Gtk.main_quit(), False)[1])
        Gtk.main()
    finally:
        if application is not None:
            application.close()
        if service.poll() is None:
            service.terminate()
            try:
                service.wait(timeout=5)
            except subprocess.TimeoutExpired:
                service.kill()
                service.wait()
        if runtime.is_file():
            value = json.loads(runtime.read_text())
            if value.get("process_id") == service.pid:
                runtime.unlink()


if __name__ == "__main__":
    main()
