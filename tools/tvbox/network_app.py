#!/usr/bin/python3
from __future__ import annotations

import json
import signal
import subprocess
import threading

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, GLib, Gtk

from tv_keyboard import PasswordDialog, present_window


class NetworkApplication:
    def __init__(self) -> None:
        self.window = Gtk.Window(title="Сеть Orange Pi")
        self.window.set_default_size(1280, 720)
        self.window.set_border_width(32)
        self.window.connect("destroy", self.close)
        self.window.connect("key-press-event", self.key_pressed)
        self.closed = False
        self.busy = False
        self.prompt_open = False
        self.state = {}
        self.buttons = []
        self.network_buttons = []
        self.control_index = 3
        self.title = Gtk.Label(label="Wi-Fi и точка доступа")
        self.title.set_name("network-title")
        self.summary = Gtk.Label(label="Проверяем сеть…")
        self.summary.set_line_wrap(True)
        self.summary.set_justify(Gtk.Justification.CENTER)
        self.message = Gtk.Label()
        self.message.set_line_wrap(True)
        self.message.set_name("network-message")
        self.ap_button = Gtk.Button(label="Включить karaorangePi · 5 ГГц")
        self.ap_button.connect("clicked", self.toggle_ap)
        self.scan_button = Gtk.Button(label="Обновить сети")
        self.scan_button.connect("clicked", lambda _button: self.request("scan"))
        self.disconnect_button = Gtk.Button(label="Отключить Wi-Fi")
        self.disconnect_button.connect("clicked", lambda _button: self.request("disconnect"))
        self.exit_button = Gtk.Button(label="Назад в лаунчер")
        self.exit_button.connect("clicked", lambda _button: self.window.destroy())
        self.controls = [self.ap_button, self.scan_button, self.disconnect_button, self.exit_button]
        actions = Gtk.Box(spacing=16, homogeneous=True)
        for button in self.controls:
            actions.pack_start(button, True, True, 0)
        self.list = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        scroll = Gtk.ScrolledWindow()
        scroll.set_policy(Gtk.PolicyType.NEVER, Gtk.PolicyType.AUTOMATIC)
        scroll.add(self.list)
        self.scroll = scroll
        help_text = Gtk.Label(label="↑↓ Сети · ←→ Действия · OK Выбрать · Назад Закрыть\nWi-Fi подключение и своя точка доступа работают по очереди. Ethernet переключается автоматически только при включённом AP.")
        help_text.set_line_wrap(True)
        help_text.set_justify(Gtk.Justification.CENTER)
        layout = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=18)
        for widget in [self.title, self.summary, actions, self.message]:
            layout.pack_start(widget, False, False, 0)
        layout.pack_start(scroll, True, True, 0)
        layout.pack_start(help_text, False, False, 0)
        self.window.add(layout)
        css = Gtk.CssProvider()
        css.load_from_data(b"window, dialog { background: #101b30; color: #f1f3fc; } label { color: #f1f3fc; font-size: 18px; } #network-title { font-size: 36px; font-weight: bold; } #network-message { color: #ffcf70; } button { padding: 16px; background: #203653; color: #f1f3fc; border: 3px solid #435c79; border-radius: 12px; } button:focus { background: #28588e; border-color: #8adeff; } entry { font-size: 24px; padding: 12px; }")
        Gtk.StyleContext.add_provider_for_screen(self.window.get_screen(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        self.window.show_all()
        self.window.fullscreen()
        GLib.idle_add(self.fit_window)
        self.exit_button.grab_focus()
        self.request("scan")
        self.timer = GLib.timeout_add_seconds(5, self.refresh)

    def fit_window(self) -> bool:
        native = self.window.get_window()
        if native is not None:
            display = native.get_display()
            monitor = display.get_monitor_at_window(native)
            if monitor is not None:
                geometry = monitor.get_geometry()
                native.move_resize(geometry.x, geometry.y, geometry.width, geometry.height)
            native.set_cursor(Gdk.Cursor.new_for_display(display, Gdk.CursorType.BLANK_CURSOR))
            native.focus(Gdk.CURRENT_TIME)
        return False

    def close(self, _window) -> None:
        self.closed = True
        GLib.source_remove(self.timer)
        Gtk.main_quit()

    def refresh(self) -> bool:
        if not self.busy and not self.closed and not self.prompt_open:
            self.request("status", background=True)
        return not self.closed

    def request(self, action: str, background: bool = False, **values) -> None:
        if self.busy:
            return
        self.busy = True
        if not background:
            self.message.set_text("Поиск сетей…" if action == "scan" else "Подождите…")
        payload = json.dumps({"action": action, **values})
        def worker() -> None:
            try:
                result = subprocess.run(["/usr/bin/sudo", "-n", "/usr/local/libexec/tvbox-network-helper"],
                                        input=payload, capture_output=True, text=True, timeout=55)
                response = json.loads(result.stdout) if len(result.stdout) < 256 * 1024 else {}
                if not isinstance(response, dict):
                    raise ValueError("Invalid network response")
            except (OSError, ValueError, subprocess.SubprocessError):
                response = {"ok": False, "error": "Не удалось связаться с сетевой службой. Проверьте установку."}
            GLib.idle_add(self.accept, response, background)
        threading.Thread(target=worker, daemon=True).start()

    def accept(self, response: dict, background: bool) -> bool:
        self.busy = False
        if self.closed:
            return False
        if response.get("ok") is not True or not isinstance(response.get("result"), dict):
            self.message.set_text(str(response.get("error", "Сеть недоступна")))
            return False
        state = response["result"]
        if not background:
            self.message.set_text("")
        ap = state.get("ap_active") is True
        device = state.get("device")
        addresses = state.get("addresses", [])
        lines = [f"{item['interface']}: {item['address']}" for item in addresses]
        if not device:
            lines.insert(0, "Wi-Fi адаптер не найден. Проверьте USB-подключение и драйвер.")
        elif ap:
            role = "раздача адресов ноутбуку" if state.get("ethernet_role") == "lan" else "uplink / определение подключения"
            lines.insert(0, f"Точка доступа karaorangePi · 5 ГГц · Ethernet: {role}")
        else:
            connected = next((item["ssid"] for item in state.get("networks", []) if item.get("active")), None)
            lines.insert(0, f"Wi-Fi: {connected}" if connected else "Wi-Fi не подключён · точка доступа выключена")
        self.summary.set_text("\n".join(lines))
        self.ap_button.set_label("Выключить karaorangePi" if ap else "Включить karaorangePi · 5 ГГц")
        self.ap_button.set_sensitive(bool(device) and state.get("ap_supported") is True and state.get("ap_ready") is True)
        self.scan_button.set_sensitive(bool(device) and not ap)
        self.disconnect_button.set_sensitive(bool(device) and not ap)
        if state.get("networks") != self.state.get("networks") or ap != self.state.get("ap_active"):
            focused = self.window.get_focus()
            index = self.network_buttons.index(focused) if focused in self.network_buttons else None
            focused_id = self.state.get("networks", [])[index]["bssid"] if index is not None else None
            for child in self.list.get_children():
                child.destroy()
            self.network_buttons = []
            for item in ([] if ap else state.get("networks", [])):
                label = f"{'✓ ' if item['active'] else ''}{item['ssid']}    {item['signal']}% · {item['security']}"
                button = Gtk.Button(label=label)
                button.set_halign(Gtk.Align.FILL)
                button.set_sensitive(item.get("supported") is True)
                button.connect("clicked", lambda _button, network=item: self.choose(network))
                self.list.pack_start(button, False, False, 0)
                self.network_buttons.append(button)
            self.list.show_all()
            if index is not None:
                if self.network_buttons:
                    index = next((position for position, item in enumerate(state.get("networks", [])) if item["bssid"] == focused_id), min(index, len(self.network_buttons) - 1))
                    self.network_buttons[index].grab_focus()
                else:
                    self.exit_button.grab_focus()
        self.state = state
        self.buttons = [button for button in self.controls + self.network_buttons if button.get_sensitive()]
        return False

    def choose(self, network: dict) -> None:
        if self.busy:
            return
        if network["security"] == "Open":
            self.request("connect", bssid=network["bssid"], password="")
        else:
            self.prompt_open = True
            def entered(password) -> None:
                self.prompt_open = False
                if password is not None:
                    self.request("connect", bssid=network["bssid"], password=password)
            PasswordDialog(self.window, network["ssid"], entered)

    def toggle_ap(self, _button) -> None:
        if self.busy:
            return
        action = "ap-off" if self.state.get("ap_active") else "ap-on"
        if action == "ap-off":
            self.request(action)
            return
        self.prompt_open = True
        dialog = Gtk.MessageDialog(transient_for=self.window, modal=True, message_type=Gtk.MessageType.QUESTION,
                                   buttons=Gtk.ButtonsType.OK_CANCEL, text="Включить karaorangePi?")
        dialog.format_secondary_text("Подключение Wi-Fi к другой сети будет отключено. Ethernet с адресом от роутера останется uplink; без внешнего DHCP через ~30 секунд начнётся раздача адресов ноутбуку. После перезагрузки AP выключен.")
        def confirmed(widget, response) -> None:
            self.prompt_open = False
            widget.destroy()
            present_window(self.window)
            if response == Gtk.ResponseType.OK:
                self.request(action)
        dialog.connect("response", confirmed)
        dialog.connect("key-press-event", self.confirm_key)
        dialog.show_all()
        present_window(dialog)

    def confirm_key(self, dialog, event) -> bool:
        if event.keyval == Gdk.KEY_Escape:
            dialog.response(Gtk.ResponseType.CANCEL)
            return True
        if event.keyval in {Gdk.KEY_Left, Gdk.KEY_Right, Gdk.KEY_Up, Gdk.KEY_Down}:
            dialog.child_focus(Gtk.DirectionType.TAB_BACKWARD if event.keyval in {Gdk.KEY_Left, Gdk.KEY_Up} else Gtk.DirectionType.TAB_FORWARD)
            return True
        if event.keyval in {Gdk.KEY_Return, Gdk.KEY_KP_Enter}:
            focused = dialog.get_focus()
            if isinstance(focused, Gtk.Button):
                focused.clicked()
            return True
        return False

    def key_pressed(self, _window, event) -> bool:
        if event.keyval == Gdk.KEY_Escape:
            self.window.destroy()
            return True
        if event.keyval in {Gdk.KEY_Return, Gdk.KEY_KP_Enter}:
            focused = self.window.get_focus()
            if isinstance(focused, Gtk.Button) and focused.get_sensitive():
                focused.clicked()
            return True
        if event.keyval not in {Gdk.KEY_Up, Gdk.KEY_Down, Gdk.KEY_Left, Gdk.KEY_Right}:
            return False
        focused = self.window.get_focus()
        buttons = self.buttons
        if not buttons:
            return True
        networks = [button for button in self.network_buttons if button.get_sensitive()]
        if focused in self.controls:
            self.control_index = self.controls.index(focused)
            if event.keyval == Gdk.KEY_Down and networks:
                networks[0].grab_focus()
                return True
            if event.keyval == Gdk.KEY_Up:
                return True
        elif focused == (networks[0] if networks else None) and event.keyval == Gdk.KEY_Up:
            target = self.controls[self.control_index]
            (target if target.get_sensitive() else self.exit_button).grab_focus()
            return True
        if focused in self.controls and event.keyval in {Gdk.KEY_Left, Gdk.KEY_Right}:
            buttons = [button for button in self.controls if button.get_sensitive()]
        index = buttons.index(focused) if focused in buttons else 0
        step = -1 if event.keyval in {Gdk.KEY_Up, Gdk.KEY_Left} else 1
        button = buttons[max(0, min(len(buttons) - 1, index + step))]
        button.grab_focus()
        if button in self.network_buttons:
            adjustment = self.scroll.get_vadjustment()
            allocation = button.get_allocation()
            adjustment.clamp_page(allocation.y, allocation.y + allocation.height)
        return True


if __name__ == "__main__":
    application = NetworkApplication()
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, lambda: (application.window.destroy(), False)[1])
    Gtk.main()
