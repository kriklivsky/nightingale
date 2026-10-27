from __future__ import annotations

from pathlib import Path

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
from gi.repository import Gdk, Gtk


def present_window(window: Gtk.Window) -> None:
    window.present()
    native = window.get_window()
    if native is not None:
        native.focus(Gdk.CURRENT_TIME)


def hardware_keyboard_available() -> bool:
    for device in Path("/sys/class/input").glob("event*/device"):
        if "/virtual/" in str(device.resolve()):
            continue
        try:
            if device.joinpath("id/bustype").read_text().strip() not in {"0003", "0005"}:
                continue
            keys = int(device.joinpath("capabilities/key").read_text().replace(" ", "").strip(), 16)
            if all(keys & (1 << key) for key in [28, 30, 44, 57]):
                return True
        except (OSError, ValueError):
            continue
    return False


class PasswordDialog:
    def __init__(self, parent: Gtk.Window, title: str, complete) -> None:
        self.parent = parent
        self.complete = complete
        self.dialog = Gtk.Dialog(title=title, transient_for=parent, modal=True)
        self.dialog.set_default_size(1050, 550)
        self.dialog.set_border_width(24)
        self.dialog.connect("key-press-event", self.key_pressed)
        self.dialog.connect("response", self.finished)
        box = self.dialog.get_content_area()
        box.set_spacing(16)
        heading = Gtk.Label(label=title)
        box.pack_start(heading, False, False, 0)
        self.entry = Gtk.Entry()
        self.entry.set_visibility(False)
        self.entry.set_max_length(128)
        self.entry.set_placeholder_text("Пароль сети · пусто для сохранённого пароля")
        self.entry.connect("activate", lambda _entry: self.dialog.response(Gtk.ResponseType.OK))
        box.pack_start(self.entry, False, False, 0)
        self.keyboard = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6)
        box.pack_start(self.keyboard, False, False, 0)
        self.shift = False
        self.symbols = False
        self.rows = []
        self.footer = []
        self.row, self.column = 1, 0
        self.render_keyboard()
        controls = Gtk.Box(spacing=12)
        self.show = Gtk.CheckButton(label="Показать пароль")
        self.show.connect("toggled", lambda button: self.entry.set_visibility(button.get_active()))
        controls.pack_start(self.show, False, False, 0)
        box.pack_start(controls, False, False, 0)
        cancel = self.dialog.add_button("Отмена", Gtk.ResponseType.CANCEL)
        connect = self.dialog.add_button("Подключиться", Gtk.ResponseType.OK)
        self.footer = [self.show, cancel, connect]
        self.rows.append(self.footer)
        self.dialog.show_all()
        present_window(self.dialog)
        if hardware_keyboard_available():
            self.keyboard.hide()
            self.entry.grab_focus()
        else:
            self.focus_key()

    def render_keyboard(self) -> None:
        for child in self.keyboard.get_children():
            child.destroy()
        letters = ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"]
        if self.symbols:
            letters = ["!@#$%^&*()", "-_+=[]{}\\|", ";:'\",.<>/?", "`~€№"]
        if self.shift:
            letters = [row.upper() for row in letters]
        self.rows = []
        for characters in letters:
            row = Gtk.Box(spacing=6, homogeneous=True)
            buttons = []
            for character in characters:
                button = Gtk.Button(label=character)
                button.connect("clicked", lambda _button, value=character: self.append(value))
                row.pack_start(button, True, True, 0)
                buttons.append(button)
            self.rows.append(buttons)
            self.keyboard.pack_start(row, False, False, 0)
        row = Gtk.Box(spacing=6, homogeneous=True)
        buttons = []
        for label, callback in [("⇧ ABC", self.toggle_shift), ("!?#", self.toggle_symbols),
                                ("Пробел", lambda: self.append(" ")), ("⌫", self.backspace),
                                ("Готово", lambda: self.dialog.response(Gtk.ResponseType.OK))]:
            button = Gtk.Button(label=label)
            button.connect("clicked", lambda _button, action=callback: action())
            row.pack_start(button, True, True, 0)
            buttons.append(button)
        self.rows.append(buttons)
        self.keyboard.pack_start(row, False, False, 0)
        if self.footer:
            self.rows.append(self.footer)
        self.keyboard.show_all()

    def append(self, value: str) -> None:
        position = self.entry.get_position()
        text = self.entry.get_text()
        self.entry.set_text((text[:position] + value + text[position:])[:128])
        self.entry.set_position(position + len(value))

    def backspace(self) -> None:
        position = self.entry.get_position()
        if position > 0:
            self.entry.delete_text(position - 1, position)

    def toggle_shift(self) -> None:
        self.shift = not self.shift
        self.render_keyboard()
        self.focus_key()

    def toggle_symbols(self) -> None:
        self.symbols = not self.symbols
        self.render_keyboard()
        self.focus_key()

    def focus_key(self) -> None:
        self.row = max(0, min(self.row, len(self.rows) - 1))
        self.column = max(0, min(self.column, len(self.rows[self.row]) - 1))
        self.rows[self.row][self.column].grab_focus()

    def key_pressed(self, _window, event) -> bool:
        if event.keyval == Gdk.KEY_Escape:
            self.dialog.response(Gtk.ResponseType.CANCEL)
            return True
        if not self.keyboard.get_visible():
            return False
        focused = self.dialog.get_focus()
        if focused == self.entry:
            if event.keyval == Gdk.KEY_Down:
                self.row = 0
                self.focus_key()
                return True
            return False
        if event.keyval in {Gdk.KEY_Up, Gdk.KEY_Down, Gdk.KEY_Left, Gdk.KEY_Right}:
            if event.keyval == Gdk.KEY_Up and self.row == 0:
                self.entry.grab_focus()
            else:
                self.row += -1 if event.keyval == Gdk.KEY_Up else 1 if event.keyval == Gdk.KEY_Down else 0
                self.column += -1 if event.keyval == Gdk.KEY_Left else 1 if event.keyval == Gdk.KEY_Right else 0
                self.focus_key()
            return True
        if event.keyval in {Gdk.KEY_Return, Gdk.KEY_KP_Enter}:
            if isinstance(focused, Gtk.Button):
                focused.clicked()
            return True
        if event.keyval == Gdk.KEY_BackSpace:
            self.backspace()
            return True
        character = Gdk.keyval_to_unicode(event.keyval)
        if character and chr(character).isprintable() and not event.state & (Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.MOD1_MASK):
            self.append(chr(character))
            return True
        return False

    def finished(self, _dialog, response) -> None:
        password = self.entry.get_text() if response == Gtk.ResponseType.OK else None
        self.entry.set_text("")
        self.dialog.destroy()
        present_window(self.parent)
        self.complete(password)
