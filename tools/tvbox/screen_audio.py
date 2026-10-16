from __future__ import annotations

import logging
from pathlib import Path

import gi

gi.require_version("Gst", "1.0")
from gi.repository import Gst


LOGGER = logging.getLogger("tvbox-screen")


class MicrophoneMonitor:
    def __init__(self, settings: dict, report) -> None:
        self.pipeline = None
        self.report = report
        self.gain = settings.get("microphone_gain", 0.1)
        if isinstance(self.gain, bool) or not isinstance(self.gain, (int, float)) or not 0 <= self.gain <= 1:
            raise ValueError("microphone_gain must be between 0 and 1")
        self.enabled = settings.get("microphone_monitoring", True)
        if not isinstance(self.enabled, bool):
            raise ValueError("microphone_monitoring must be true or false")
        self.available = Path("/proc/asound/U192k").exists()

    def start(self) -> None:
        if not self.enabled:
            self.report("Микрофоны выключены")
            return
        if not self.available:
            self.report("UMC202HD не подключён")
            return
        self.pipeline = Gst.parse_launch(
            'alsasrc device="hw:CARD=U192k,DEV=0" buffer-time=21333 latency-time=5333 ! '
            'audio/x-raw,rate=48000,channels=2 ! '
            'audioconvert mix-matrix="<<(float)0.5,(float)0.5>,<(float)0.5,(float)0.5>>" ! '
            'audio/x-raw,format=F32LE,rate=48000,channels=2 ! '
            f'volume volume={self.gain} ! '
            'alsasink device=default buffer-time=21333 latency-time=5333 sync=false'
        )
        bus = self.pipeline.get_bus()
        bus.add_signal_watch()
        bus.connect("message::error", self.failed)
        if self.pipeline.set_state(Gst.State.PLAYING) == Gst.StateChangeReturn.FAILURE:
            self.stop()
            self.report("Не удалось включить микрофоны")
        else:
            self.report("Микрофоны → выбранный аудиовыход")

    def failed(self, _bus, message) -> None:
        error, _details = message.parse_error()
        LOGGER.warning("Microphone monitor unavailable: %s", error.message)
        self.stop()
        self.report("Микрофоны недоступны; проверьте UMC202HD")

    def toggle(self) -> None:
        self.enabled = not self.enabled
        self.stop()
        self.start()

    def stop(self) -> None:
        if self.pipeline is not None:
            self.pipeline.get_bus().remove_signal_watch()
            self.pipeline.set_state(Gst.State.NULL)
            self.pipeline = None
