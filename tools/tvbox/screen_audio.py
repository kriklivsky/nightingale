from __future__ import annotations

import asyncio
import logging
from pathlib import Path
import queue

import aiohttp

import gi

gi.require_version("Gst", "1.0")
from gi.repository import Gst


LOGGER = logging.getLogger("tvbox-screen")


class MicrophoneMonitor:
    def __init__(self, settings: dict, report, changed, disabled: bool = False) -> None:
        self.pipeline = None
        self.output = None
        self.source = None
        self.transmitting = False
        self.generation = -1
        self.frames = queue.Queue(maxsize=4)
        self.report = report
        self.changed = changed
        self.disabled = disabled
        self.gain = settings.get("microphone_gain", 0.1)
        if isinstance(self.gain, bool) or not isinstance(self.gain, (int, float)) or not 0 <= self.gain <= 1:
            raise ValueError("microphone_gain must be between 0 and 1")
        self.enabled = settings.get("microphone_monitoring", True)
        if not isinstance(self.enabled, bool):
            raise ValueError("microphone_monitoring must be true or false")
        self.enabled = self.enabled and not self.disabled
        self.available = not self.disabled and Path("/proc/asound/U192k").exists()

    def start(self) -> None:
        if self.disabled:
            self.enabled = False
            self.report("Захват микрофонов отключён параметром запуска")
            self.changed()
            return
        if not self.enabled and not self.transmitting:
            self.stop()
            self.report("Мониторинг выключен · захват по запросу ноутбука")
            self.changed()
            return
        self.available = Path("/proc/asound/U192k").exists()
        if not self.available:
            self.report("UMC202HD не подключён")
            self.changed()
            return
        if self.pipeline is None:
            self.pipeline = Gst.parse_launch(
                'alsasrc device="hw:CARD=U192k,DEV=0" buffer-time=21333 latency-time=5333 ! '
                'audioconvert ! audio/x-raw,format=S16LE,layout=interleaved,rate=48000,channels=2 ! '
                'appsink name=pcm emit-signals=true sync=false max-buffers=2 drop=true'
            )
            self.pipeline.get_by_name("pcm").connect("new-sample", self.sample)
            bus = self.pipeline.get_bus()
            bus.add_signal_watch()
            bus.connect("message::error", self.failed)
            if self.pipeline.set_state(Gst.State.PLAYING) == Gst.StateChangeReturn.FAILURE:
                self.stop()
                self.available = False
                self.report("Не удалось включить захват микрофонов")
                self.changed()
                return
        if self.enabled and self.output is None:
            self.output = Gst.parse_launch(
                'appsrc name=monitor is-live=true format=time do-timestamp=true '
                'block=false max-buffers=4 max-bytes=32768 leaky-type=downstream '
                'caps="audio/x-raw,format=S16LE,layout=interleaved,rate=48000,channels=2" ! '
                'audioconvert mix-matrix="<<(float)0.5,(float)0.5>,<(float)0.5,(float)0.5>>" ! '
                f'volume volume={self.gain} ! '
                'alsasink device=default buffer-time=21333 latency-time=5333 sync=false'
            )
            self.source = self.output.get_by_name("monitor")
            bus = self.output.get_bus()
            bus.add_signal_watch()
            bus.connect("message::error", self.output_failed)
            if self.output.set_state(Gst.State.PLAYING) == Gst.StateChangeReturn.FAILURE:
                self.stop_output()
                self.enabled = False
        if not self.enabled:
            self.stop_output()
            if not self.transmitting:
                self.stop()
        self.report("Мониторинг " + ("включён" if self.enabled else "выключен") +
                    (" · микрофоны → ноутбук" if self.transmitting else ""))
        self.changed()

    def sample(self, sink):
        sample = sink.emit("pull-sample")
        if sample is None:
            return Gst.FlowReturn.OK
        buffer = sample.get_buffer()
        source = self.source
        if source is not None:
            output = buffer.copy_deep()
            output.pts = Gst.CLOCK_TIME_NONE
            output.dts = Gst.CLOCK_TIME_NONE
            source.emit("push-buffer", output)
        if self.transmitting:
            data = buffer.extract_dup(0, buffer.get_size())
            for offset in range(0, len(data), 8192):
                try:
                    self.frames.put_nowait(data[offset:offset + 8192])
                except queue.Full:
                    try:
                        self.frames.get_nowait()
                    except queue.Empty:
                        pass
                    self.frames.put_nowait(data[offset:offset + 8192])
        return Gst.FlowReturn.OK

    async def publish(self, config: dict, stopped) -> None:
        headers = {"Authorization": "Bearer " + config["token"], "Origin": config["endpoint"]}
        async with aiohttp.ClientSession(headers=headers, timeout=aiohttp.ClientTimeout(total=3)) as client:
            while not stopped.is_set():
                if not self.transmitting:
                    await asyncio.sleep(0.1)
                    continue
                try:
                    async with client.ws_connect(config["endpoint"] + "/api/microphone-source?generation=" + str(self.generation),
                                                 heartbeat=5, max_msg_size=1024) as socket:
                        while self.transmitting and not stopped.is_set() and not socket.closed:
                            try:
                                frame = self.frames.get_nowait()
                            except queue.Empty:
                                await asyncio.sleep(0.005)
                                continue
                            await asyncio.wait_for(socket.send_bytes(frame), timeout=2)
                except (aiohttp.ClientError, OSError, TimeoutError):
                    LOGGER.warning("Microphone transfer unavailable; retrying")
                    await asyncio.sleep(0.5)

    def set_transmitting(self, enabled: bool) -> None:
        if self.transmitting == enabled:
            return
        self.transmitting = enabled
        while not self.frames.empty():
            try:
                self.frames.get_nowait()
            except queue.Empty:
                break
        self.start()

    def failed(self, _bus, message) -> None:
        error, _details = message.parse_error()
        LOGGER.warning("Microphone monitor unavailable: %s", error.message)
        self.stop()
        self.available = False
        self.enabled = False
        self.report("Микрофоны недоступны; проверьте UMC202HD")
        self.changed()

    def output_failed(self, _bus, message) -> None:
        error, _details = message.parse_error()
        LOGGER.warning("Microphone output unavailable: %s", error.message)
        self.stop_output()
        self.enabled = False
        if not self.transmitting:
            self.stop()
        self.report("Мониторинг недоступен; захват для ноутбука сохранён")
        self.changed()

    def toggle(self) -> None:
        self.enabled = not self.enabled
        self.start()

    def stop_output(self) -> None:
        self.source = None
        if self.output is not None:
            self.output.get_bus().remove_signal_watch()
            self.output.set_state(Gst.State.NULL)
            self.output = None

    def stop(self) -> None:
        self.stop_output()
        if self.pipeline is not None:
            self.pipeline.get_bus().remove_signal_watch()
            self.pipeline.set_state(Gst.State.NULL)
            self.pipeline = None
