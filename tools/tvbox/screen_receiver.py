from __future__ import annotations

import logging
import queue

import gi

gi.require_version("Gst", "1.0")
gi.require_version("GstWebRTC", "1.0")
gi.require_version("GstSdp", "1.0")
from gi.repository import GLib, Gst, GstSdp, GstWebRTC


LOGGER = logging.getLogger("tvbox-screen")


class Receiver:
    def __init__(self, show_video, report) -> None:
        self.show_video = show_video
        self.report = report
        self.pipeline = None
        self.webrtc = None
        self.generation = -1
        self.answer_sent = False
        self.answers = queue.SimpleQueue()
        self.frames = 0
        self.video_size = ""
        self.sink = Gst.ElementFactory.make("gtkglsink")
        if self.sink is None:
            raise RuntimeError("Missing GStreamer GTK video sink")
        self.widget = self.sink.get_property("widget")

    def accept(self, offer: str, generation: int) -> None:
        self.stop()
        self.generation = generation
        self.answer_sent = False
        self.frames = 0
        self.pipeline = Gst.Pipeline.new(None)
        self.webrtc = Gst.ElementFactory.make("webrtcbin")
        if self.webrtc is None:
            self.report("WebRTC не установлен")
            return
        self.webrtc.set_property("bundle-policy", GstWebRTC.WebRTCBundlePolicy.MAX_BUNDLE)
        self.webrtc.set_property("latency", 50)
        self.webrtc.connect("pad-added", self.incoming_stream)
        self.webrtc.connect("notify::ice-gathering-state", self.ice_changed)
        self.webrtc.connect("notify::connection-state", self.connection_changed)
        self.pipeline.add(self.webrtc)
        bus = self.pipeline.get_bus()
        bus.add_signal_watch()
        bus.connect("message::error", self.pipeline_error)
        self.pipeline.set_state(Gst.State.PLAYING)
        result, message = GstSdp.SDPMessage.new_from_text(offer)
        if result != GstSdp.SDPResult.OK:
            self.report("Некорректные параметры трансляции")
            return
        description = GstWebRTC.WebRTCSessionDescription.new(GstWebRTC.WebRTCSDPType.OFFER, message)
        promise = Gst.Promise.new_with_change_func(self.remote_set, self.webrtc, None)
        self.webrtc.emit("set-remote-description", description, promise)

    def remote_set(self, promise, element, _extra) -> None:
        if element is not self.webrtc:
            return
        reply = promise.get_reply()
        if reply is not None and reply.has_field("error"):
            GLib.idle_add(self.report, "Не удалось принять параметры трансляции")
            return
        GLib.idle_add(self.create_answer, element)

    def create_answer(self, element) -> bool:
        if self.webrtc is element:
            promise = Gst.Promise.new_with_change_func(self.answer_created, element, None)
            self.webrtc.emit("create-answer", None, promise)
        return False

    def answer_created(self, promise, element, _extra) -> None:
        if element is not self.webrtc:
            return
        reply = promise.get_reply()
        if reply is None or not reply.has_field("answer"):
            GLib.idle_add(self.report, "Не удалось согласовать видео и звук")
            return
        # The promise owns its reply; GTK needs an owned description for its next iteration.
        answer = reply.get_value("answer").copy()
        GLib.idle_add(self.set_answer, element, answer)

    def set_answer(self, element, answer) -> bool:
        if self.webrtc is element:
            promise = Gst.Promise.new()
            self.webrtc.emit("set-local-description", answer, promise)
            promise.interrupt()
        return False

    def ice_changed(self, element, _property) -> None:
        if element is not self.webrtc or self.answer_sent:
            return
        if element.get_property("ice-gathering-state") == GstWebRTC.WebRTCICEGatheringState.COMPLETE:
            description = element.get_property("local-description")
            if description is not None:
                self.answer_sent = True
                self.answers.put((self.generation, description.sdp.as_text()))

    def connection_changed(self, element, _property) -> None:
        if element is self.webrtc and element.get_property("connection-state") == GstWebRTC.WebRTCPeerConnectionState.FAILED:
            GLib.idle_add(self.report, "Связь потеряна. Завершите трансляцию и подключитесь снова.")

    def incoming_stream(self, element, pad) -> None:
        if element is not self.webrtc or pad.get_direction() != Gst.PadDirection.SRC:
            return
        decoder = Gst.ElementFactory.make("decodebin")
        decoder.connect("pad-added", self.decoded_stream)
        self.pipeline.add(decoder)
        decoder.sync_state_with_parent()
        if pad.link(decoder.get_static_pad("sink")) != Gst.PadLinkReturn.OK:
            GLib.idle_add(self.report, "Не удалось подключить декодер")

    def decoded_stream(self, _decoder, pad) -> None:
        caps = pad.get_current_caps()
        if caps is None or self.pipeline is None or _decoder.get_parent() is not self.pipeline:
            return
        structure = caps[0]
        kind = structure.get_name()
        if kind.startswith("video/"):
            self.video_size = f'{structure.get_value("width")}×{structure.get_value("height")}'
            branch = Gst.parse_bin_from_description('queue max-size-buffers=3 max-size-bytes=0 max-size-time=0 ! glupload ! glcolorconvert', True)
            self.pipeline.add(branch)
            self.pipeline.add(self.sink)
            branch.link(self.sink)
            self.sink.sync_state_with_parent()
            branch.sync_state_with_parent()
            pad.add_probe(Gst.PadProbeType.BUFFER, self.video_frame, self.generation)
        elif kind.startswith("audio/"):
            branch = Gst.parse_bin_from_description('queue max-size-time=200000000 ! audioconvert ! audioresample ! alsasink name=screen_audio_output device=default buffer-time=40000 latency-time=10000', True)
            self.pipeline.add(branch)
            branch.sync_state_with_parent()
        else:
            return
        if pad.link(branch.get_static_pad("sink")) != Gst.PadLinkReturn.OK:
            GLib.idle_add(self.report, "Не удалось подключить видео или звук")

    def video_frame(self, _pad, _info, generation):
        if generation != self.generation or self.pipeline is None:
            return Gst.PadProbeReturn.OK
        self.frames += 1
        caps = _pad.get_current_caps()
        structure = caps[0] if caps is not None else None
        size = f'{structure.get_value("width")}×{structure.get_value("height")}' if structure is not None else self.video_size
        changed = size != self.video_size
        self.video_size = size
        if self.frames == 1 or changed:
            GLib.idle_add(self.show_frame, generation, self.video_size)
        return Gst.PadProbeReturn.OK

    def show_frame(self, generation: int, size: str) -> bool:
        if self.generation == generation and self.pipeline is not None:
            self.show_video(size)
        return False

    def pipeline_error(self, _bus, message) -> None:
        error, _details = message.parse_error()
        LOGGER.warning("Receiver pipeline failed: %s", error.message)
        self.report("Не удалось воспроизвести трансляцию. Отключитесь и повторите подключение.")

    def stop(self) -> None:
        self.generation = -1
        if self.pipeline is not None:
            self.pipeline.get_bus().remove_signal_watch()
            self.pipeline.set_state(Gst.State.NULL)
            if self.sink.get_parent() is self.pipeline:
                self.pipeline.remove(self.sink)
            self.pipeline = None
            self.webrtc = None
