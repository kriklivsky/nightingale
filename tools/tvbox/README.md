# Orange Pi TV applications

## HDMI after cold startup

The CEC bridge waits up to 60 seconds for a connected X11 output, a CEC address
and an awake TV. It queries the active source and makes one startup announcement
when the route matches Orange Pi/the soundbar, or when no device answers the
active-source request. A reported different source or a standby TV is left alone.
This repairs an input selected before the listener started; it does not change
the video mode or restart the launcher/Nightingale. Image View On and the
broadcast Active Source are separate commands. Startup and subsequent input
selection share the same recovery lock/throttle; ordinary remote keys never
request HDMI recovery. A silent active-source response cannot establish which
input the TV selected, so the once-per-service-start fallback can select Orange Pi
when the TV is awake but another source does not announce itself.

Install just this bridge without restarting the graphics session or analysis:

```sh
sudo install -m 0755 tools/tvbox/tvbox-cec.py /usr/local/libexec/tvbox-cec.py
sudo systemctl restart tvbox-cec.service
sudo journalctl -u tvbox-cec.service -n 30 --no-pager
```

## Wi-Fi and event hotspot

The launcher's bottom row includes **Wi-Fi / точка доступа**. Use arrows and OK
to scan and select a network, enter its password, disconnect, or explicitly
enable **karaorangePi**. USB/Bluetooth keyboards use a normal password field;
without one, a fixed-row on-screen keyboard supports arrows, OK, case,
punctuation, space and backspace. Back cancels without connecting. Saved client
networks reconnect normally; the hotspot never autostarts after a reboot.
Wi-Fi client and AP modes are mutually exclusive on this single adapter.
WPA/WPA2/WPA3 personal and open networks are supported; enterprise/WEP and
captive-portal login are not implemented in this screen.

The event hotspot uses WPA2/AES on 5 GHz channel 36 and `10.77.0.1/24`.
Configure its password locally as root during installation; it is kept only in
the root-readable NetworkManager profile, not in this repository, a command
argument, browser bundle or log. The UI does not reveal or change it.

Ethernet remains managed by the existing systemd-networkd/Netplan configuration.
While AP is enabled, an existing Ethernet IPv4 address is left alone and can
provide internet upstream. Without an address/external DHCP response for about
30 seconds after a cable is connected, a temporary networkd configuration makes
`end1` a routed LAN at `10.77.1.1/24`, with DHCP and IPv4 masquerading for a wired
laptop. The Wi-Fi and wired clients share access to the receiver, but are not
an Ethernet bridge. Removing the cable, disabling AP or detecting an external
DHCP server restores the original Ethernet configuration. The detector checks
for external DHCP while LAN mode is active. This is a DHCP-based heuristic,
not proof that an unknown wired network is isolated: do not connect it to an
unadministered static-only network. Existing routes overlapping either event
subnet prevent AP activation instead of being overwritten.

Install NetworkManager **only for Wi-Fi**, before starting it, so it cannot
take over the current Ethernet SSH connection:

```sh
sudo install -d -m 0755 /etc/NetworkManager/conf.d
sudo install -m 0644 tools/tvbox/90-tvbox-wifi.conf /etc/NetworkManager/conf.d/
sudo apt-get install --no-install-recommends network-manager dnsmasq-base nftables \
  usb-modeswitch usb-modeswitch-data
sudo systemctl start NetworkManager
sudo install -d -m 0755 /usr/local/libexec/tvbox-network
sudo install -m 0644 tools/tvbox/network_backend.py tools/tvbox/network_router.py \
  tools/tvbox/network_app.py tools/tvbox/tv_keyboard.py /usr/local/libexec/tvbox-network/
sudo install -m 0755 tools/tvbox/tvbox-network-helper /usr/local/libexec/
sudo install -m 0755 tools/tvbox/tvbox-network /usr/local/bin/
sudo visudo -cf tools/tvbox/tvbox-network.sudoers
sudo install -m 0440 tools/tvbox/tvbox-network.sudoers /etc/sudoers.d/tvbox-network
sudo install -m 0644 tools/tvbox/tvbox-event-router.service \
  tools/tvbox/tvbox-event-router.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tvbox-event-router.timer
```

The sudo rule deliberately grants `tvbox` only the no-argument helper, not a
shell, Python interpreter, nmcli or networkctl. Its bounded JSON input allows
only Wi-Fi status/scan/connect/disconnect and the preconfigured AP toggle.
Profile paths, Ethernet interface and router subnets are fixed. Passwords go
over stdin; the root-owned helper uses Python isolated mode and fixed commands.
Installing this rule is a persistent privilege grant and requires administrator
approval. Initial AP setup is denied when invoked through that TV-user rule.
The TV karaoke adapter uses GIO's `netlink` network monitor: NetworkManager's
own monitor reports offline when only networkd's unmanaged Ethernet is active,
which must not disable WebKit's local IPC/media requests.
At a root terminal, initialize it once without putting a password in history:

```sh
python3 -c 'import getpass,json; print(json.dumps({"action":"setup","password":getpass.getpass("AP password: ")}))' \
  | /usr/local/libexec/tvbox-network-helper
```

Build/install the launcher as below. Realtek adapters exposing a virtual CD-ROM
must first switch to their Wi-Fi identity. For the attached `0bda:1a2b` device,
the standard `usb_modeswitch -K -v 0bda -p 1a2b` sequence exposes `0bda:c811`;
the existing `rtl8821cu` driver supports managed/AP modes. The USB-mode database
handles subsequent insertions. A failed switch must be diagnosed before any
AP claim: a virtual CD-ROM is not a working Wi-Fi interface.

Nightingale's TV search also detects a physical USB/Bluetooth keyboard and
switches to normal text input; its on-screen keyboard remains available when
none is present. Hotplug is rechecked while search is open, and direct character
entry also works before detection completes. CEC's virtual keyboard is excluded.
Install `91-tvbox-keyboard.conf` into `/etc/X11/xorg.conf.d/` for persistent
US/Russian layouts and **Alt+Shift** switching. Apply them to an already running
TV session without restarting HDMI:

```sh
DISPLAY=:0 XAUTHORITY=/run/tvbox.Xauthority \
  setxkbmap -layout us,ru -option grp:alt_shift_toggle
```

## Local screen sharing: independent application

The launcher's **Экран ноутбука** tile opens a separate GTK/GStreamer WebRTC
receiver. It does not run, embed, rebuild or configure Nightingale and does not
read its library, analysis queue or settings. Its browser sender is built
separately from `client/screen/`; the karaoke frontend build is unchanged.

Open the HTTPS address displayed on the TV in desktop Chrome, enter the six-digit
TV code, then select a screen or tab. For music/video, select a Chrome tab and
enable sharing its audio. Whole-screen/system audio depends on the sender's OS
and browser. The page never requests the laptop microphone. Quality choices are
1080p30, 4K30 and up to 4K60; actual resolution cannot exceed the source and frame
rate depends on encoding, decoding and the LAN. The receiver shows the incoming
resolution. No cloud signaling, STUN/TURN relay or recording is used.

With the Rockchip `mppvideodec` plugin installed (see YouTube song clips below),
the receiver decodes H.264 in hardware: 1080p30 reaches the screen in about
8 ms instead of 21 ms (95th percentile 12 ms instead of 70 ms). 4K is decoded in
hardware too, but the upload of each 4K frame into OpenGL limits it to about
22 fps (software decoding: about 10 fps): the plugin emits legacy DMABuf caps
that GStreamer 1.26 `glupload` cannot import without a copy.

Both devices need direct LAN connectivity, including WebRTC UDP traffic; guest
Wi-Fi client isolation can prevent it. Only one laptop may pair at a time. TV
codes rotate after disconnect or expiry, pairing attempts are rate-limited and
session tokens stay in memory. Closing the receiver stops the HTTPS service and
microphone monitor. Back returns to the launcher; arrows select its controls.
The launcher remains running behind this separate application, so installing it
does not require restarting the HDMI session or the currently open Nightingale.

Build and validate the independent sender from the repository root:

```sh
pnpm --dir client exec tsc --project screen/tsconfig.json
pnpm --dir client exec oxlint screen
pnpm --dir client exec stylelint screen/style.css
pnpm --dir client exec vite build --config vite.screen.config.ts
```

On the TV box, install the runtime prerequisites and application files:

```sh
sudo apt-get install --no-install-recommends \
  python3-aiohttp python3-gi python3-gst-1.0 \
  gir1.2-gstreamer-1.0 gir1.2-gst-plugins-base-1.0 gir1.2-gst-plugins-bad-1.0 \
  gstreamer1.0-gtk3 gstreamer1.0-nice gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad gstreamer1.0-libav gstreamer1.0-gl gstreamer1.0-alsa
sudo install -d -m 0755 /usr/local/libexec/tvbox-screen /usr/local/share/tvbox-screen
sudo install -m 0644 tools/tvbox/screen_app.py tools/tvbox/screen_audio.py tools/tvbox/screen_network.py \
  tools/tvbox/screen_receiver.py tools/tvbox/screen_server.py \
  tools/tvbox/microphone_client.py /usr/local/libexec/tvbox-screen/
sudo install -m 0755 tools/tvbox/tvbox-screen tools/tvbox/tvbox-screen-service \
  tools/tvbox/tvbox-screen-setup /usr/local/bin/
sudo cp -a client/screen-dist/. /usr/local/share/tvbox-screen/
sudo -u tvbox -H /usr/local/bin/tvbox-screen-setup 10.3.0.102
```

Build/install `tvbox-launcher` as described below. Do not restart the display
service: the new tile is available when the user next returns to the launcher.
The HTTPS listener prefers the active Wi-Fi/AP IPv4 address, falling back to
Ethernet when Wi-Fi has no address, and binds TCP 8091 while the
application is open. The authenticated receiver API binds only 127.0.0.1:8092.
The standalone server defaults to loopback unless explicitly passed `--bind`.

### HTTPS and microphone settings

Chrome requires a secure context for screen capture. Setup creates a private
365-day local certificate in `/var/lib/tvbox/.config/tvbox-screen/`; it never
replaces an existing certificate. Trust the public `server.crt` on the laptop
using its OS/Chrome certificate manager and compare its SHA-256 fingerprint with
the one shown on the TV. Only this local certificate should be trusted; do not
disable certificate verification or browser security. The public certificate is
also available at the screen-sharing address's `/certificate` path. Never copy
`server.key` to the laptop. The local launcher signs a short-lived server
certificate for current addresses and both fixed event-router addresses using
that same private authority; the public certificate and its TV fingerprint
remain unchanged when DHCP changes the IP. Reopen screen sharing after switching
network modes. No internet route is required for the offline AP.
The server also accepts an administrator-provided
certificate through its CLI flags.

The receiver owns one UMC202HD capture stream. Its independent monitor mixes
both input channels to both speaker channels via ALSA `default`, using the
launcher's saved HDMI/Behringer route, not the WebRTC/laptop round trip.
**Мониторинг: вкл/выкл** on the TV and **Мониторинг в колонках** on the paired
laptop toggle only speaker monitoring; they do not mute screen audio or the
microphone feed to Python. The screen application's toggle lasts for this
application session. Set its startup default in
`/var/lib/tvbox/.config/tvbox-screen/settings.json`:

```json
{"microphone_monitoring": true, "microphone_gain": 0.1}
```

Gain is bounded to 0–1 and defaults conservatively to 0.1. Input/output request
5.33 ms periods and 21.33 ms buffers, subject to ALSA/device limits; these are not
end-to-end latency measurements. Missing/busy UMC202HD is reported without
preventing screen sharing. For diagnostics, run `tvbox-screen --no-microphones`.
Do not run the monitor concurrently with another application's exclusive USB
capture. Keep microphones away from speakers and start at low speaker volume.

With powered speakers connected to UMC202HD, enable its physical Direct Monitor
switch and disable software monitoring in each application to avoid a delayed
duplicate voice. Nightingale uses **OK / Enter / R** during active playback;
microphone scoring stays enabled and karaoke remembers the monitor setting.
Hardware direct monitoring does not send microphones to HDMI or back from the
laptop. Its physical switch and monitor mix remain under the user's control.

### Microphones on the laptop: Python / local processing

Open **Экран ноутбука**, pair the browser with the TV code, then choose
**Разрешить поток для Python** → **Скопировать временный ключ**. This does not
start a recording or laptop speaker playback. Download `microphone_client.py`
and the public certificate using the links in that section. Screen sharing is
optional: the paired page must remain open to keep the session alive.

Run on the laptop, using the HTTPS address shown on the TV:

```sh
python3 microphone_client.py \
  --url https://10.3.0.102:8091 --certificate orangepi-screen.crt \
  --channel 1 | your-local-audio-processor
```

Paste the temporary key at the hidden terminal prompt. Do not put it in a URL,
command argument, shell history, or log. No Python packages are required by this
client. Certificate verification stays enabled; verify the certificate's
fingerprint against the TV before trusting it.

Stdout is **raw signed 16-bit little-endian PCM at 48,000 Hz**, without a WAV
header. `--channel stereo` (default) retains UMC inputs 1 and 2 as separate
interleaved left/right channels; `--channel 1` or `--channel 2` extracts one mono
input without mixing in screen audio or applying monitor gain. The local
processor must consume that format. For an ASR engine needing mono 16 kHz:

```sh
python3 microphone_client.py \
  --url https://10.3.0.102:8091 --certificate orangepi-screen.crt --channel 1 \
  | ffmpeg -hide_banner -loglevel error -f s16le -ar 48000 -ac 1 -i pipe:0 \
      -f s16le -ar 16000 -ac 1 pipe:1 \
  | your-local-audio-processor
```

Audio uses a separate authenticated HTTPS PCM stream, so Python does not need
to act as a WebRTC/video receiver and the original WebRTC screen path stays
unchanged. Only one audio consumer is allowed. Slow consumers drop old frames
from bounded queues rather than delaying microphone monitoring or growing RAM.
Turning monitoring off leaves an active laptop feed captured; a failed speaker
output does not stop this capture. **Отозвать доступ к микрофонам**, disconnect,
session expiry, or closing the TV application revokes the key and ends the
stream. A silent/stalled source ends the stream after five seconds. Nothing is
recorded on the Orange Pi or made into a system microphone on the laptop;
virtual-device integration, if needed, belongs to the laptop audio setup.

## Select speaker output

The launcher's bottom row selects **HDMI / саундбар** or **UMC202HD / колонки**.
Press Down from the application tiles, Left/Right to select an output and OK to
save it. A checkmark identifies the saved output; Up returns to the application
tiles. The selection takes effect when the next application opens and persists
across reboots. A missing device or save error leaves the previous route intact.

Install `tvbox-audio` as `/usr/local/bin/tvbox-audio` with mode `0755`, and build
the GTK launcher on the TV box:

```sh
tvbox_build_dir=$(mktemp -d)
gcc -std=c11 -O2 -Wall -Wextra -Werror -pedantic \
  tools/tvbox/tvbox-launcher.c -o "${tvbox_build_dir}/tvbox-launcher" \
  $(pkg-config --cflags --libs gtk+-3.0)
sudo install -m 0755 "${tvbox_build_dir}/tvbox-launcher" /usr/local/bin/tvbox-launcher
```

Set `audio = default` in `/etc/tvbox/moonlight.conf` (the accompanying
`moonlight.conf` retains this box's existing 4K60 settings). The launcher updates
only the TV user's `.asoundrc`, preserving its original version once as
`.asoundrc.pre-tvbox-audio`; unknown custom ALSA configurations are not replaced.
Device names use ALSA card IDs, not USB-sensitive numeric card positions. Both
routes provide shared stereo playback at 48 kHz, so backing tracks and native
microphone monitoring can play together. Microphone selection and monitor gain
remain Nightingale settings. No test tones are played when changing output.

Connect active speakers to the UMC202HD's rear OUTPUTS 1(L) / 2(R) and initially
turn down its OUTPUT knob and the speakers' gain. Hardware **DIRECT MONITOR** is
separate from Nightingale monitoring: enabling both adds a second microphone
path. This selector does not change that hardware switch or microphone gain.

## Local library ownership

Nightingale and `tvbox-songs-web.service` run as `tvbox:tvbox`. Local songs and
their directories under `/var/lib/tvbox/songs` must be writable by that account.
Reading a root-owned library can work while Delete fails with `Permission
denied`: deletion first renames each source file inside its parent directory,
which requires write and search access to that directory. Do not run
Nightingale as root or grant world-writable permissions to work around this.

Files may also be imported as root: install the recurring repair below to
assign them to `tvbox` automatically. The existing web uploader already runs
as `tvbox`; its uploads do not need a root-owned import step.

```sh
sudo install -m 0755 tools/tvbox/tvbox-fix-song-permissions /usr/local/bin/
sudo install -m 0644 tools/tvbox/tvbox-song-permissions.cron \
  /etc/cron.d/tvbox-song-permissions
sudo /usr/local/bin/tvbox-fix-song-permissions
```

The root cron job runs **every minute**, with low CPU/I/O priority and a lock
to prevent overlapping runs. Deleting a newly root-uploaded song may therefore
require waiting up to a minute after its directory/file becomes visible to
the scan, or running the helper manually. The helper changes only incorrect
owners/groups of directories and singly linked regular files within this
fixed library. Already-correct entries are left alone; symlinks, multiply
linked files and other filesystems are skipped. It uses directory/file
descriptors and no-follow opens rather than following imported paths, never
runs `chmod`, and does not alter song contents. Root uploads using restrictive
directory modes such as `0500` still need owner write access to allow deletion.
Errors appear under `journalctl -t tvbox-song-permissions`; successful runs are
silent. Cron must be running; no application or HDMI restart is needed.

Run `sudo /usr/local/bin/tvbox-fix-song-permissions` to repair immediately
without waiting for cron. Verify access as the actual application user (from
a directory that account can enter):

```sh
cd /var/lib/tvbox
sudo -u tvbox find /var/lib/tvbox/songs -xdev -type d ! -writable -print
```

No output means every scanned directory is writable by `tvbox`.

## Retry failed song analysis

Install `tools/tvbox/tvbox-retry-failed` as `/usr/local/bin/tvbox-retry-failed`
with mode `0755`. While Nightingale is open and its analysis queue is idle, run:

```sh
sudo /usr/local/bin/tvbox-retry-failed
```

The command refuses to interrupt active or queued analysis. It closes only
Nightingale, backs up `songs.db`, changes failed jobs to queued, then reopens
karaoke through the TV launcher so normal startup resumes them. Successful
analysis and original media are unchanged; HDMI and the TV session stay running.
Avoid operating the launcher during the short restart. Missing synchronized
lyrics can still fail again until they are available on LRCLIB or provided
manually. Database backups remain beside `songs.db`.

## Delete failed songs

Install `tools/tvbox/tvbox-clean-failed` as `/usr/local/bin/tvbox-clean-failed`
with mode `0755`. Preview the exact source-file paths and total size first:

```sh
sudo /usr/local/bin/tvbox-clean-failed
```

To confirm permanent deletion, keep Nightingale open and run:

```sh
sudo /usr/local/bin/tvbox-clean-failed --delete
```

This briefly closes only Nightingale, snapshots the current failed songs,
backs up its SQLite database, saves a JSON deletion manifest beside it, stages
the files and removes their library rows in one transaction. Original source
files are unlinked only after the transaction commits. If the transaction
fails, staged files are restored. Database backups do **not** contain audio or
video: deleted source files cannot be restored from them.

Only failed, unanalyzed local songs inside `/var/lib/tvbox/songs` are eligible.
Remote/UltraStar songs, symlinks, hardlinks, missing files and files referenced
by retained songs are protected and reported as skipped. Use the application's
Delete action for UltraStar bundles. Album artwork, sidecars, models and caches
are left alone. Playlist memberships cascade with deleted song rows; favorites
and failed queue entries are removed only when their hash has no remaining
songs. Other queued/interrupted analysis resumes when Nightingale reopens.
Avoid using the launcher or uploading/replacing files during cleanup. HDMI and
the TV session are not restarted.

## Microphone monitoring

Nightingale sends the USB microphone mix to the default ALSA output natively;
the frontend pitch display and microphone latency compensation are not in the
speaker-monitor signal path.

For low-latency monitoring while songs are analyzed, install the Linux real-time
audio scheduling service on the TV box:

```sh
sudo apt-get install --no-install-recommends rtkit
```

CPAL requests real-time scheduling for its input and output workers through
RTKit. No real-time priority is granted to the analyzer or UI. The service can be
activated by D-Bus on demand. Verify the running application's audio workers
with `ps -T -p <Nightingale PID> -o tid,comm,cls,rtprio`; `cpal_alsa_in` and
`cpal_alsa_out` should show the `RR` scheduling class. A failed promotion is logged
and audio still starts with normal scheduling.

Some vendor kernels enable `CONFIG_RT_GROUP_SCHED` while using the cgroup v2 CPU
controller. Real-time scheduling can then fail with `Operation not permitted`
for services outside the root CPU cgroup, even when RTKit is installed. Verify
the scheduling class instead of assuming installation enabled real-time audio.
Do not disable system-wide CPU resource controls or move the whole application
outside its service's cgroup just to hide the failed promotion. See the
[kernel cgroup documentation](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html#cpu).

Both streams initially request a 512-frame period (10.7 ms at 48 kHz), subject to
the selected device's supported limits. Monitor startup prefill is 256 frames
(5.3 ms); this does not change the hardware period or measured end-to-end delay.
Input and output adapt independently
after stream errors. After a stable run they retry a smaller period; an unstable
recovery delays another attempt by 5–15 minutes instead of blocking recovery
until the app restarts. Logs distinguish input/output failures and show requested
periods. Restarting streams briefly interrupts monitoring.

Requested period sizes and hardware buffer capacities are not measurements of
the complete microphone-to-speaker delay. ALSA plugins, HDMI and the soundbar
also contribute. Inspect the active devices under `/proc/asound/` and use an
acoustic measurement when verifying end-to-end latency.

## YouTube song clips

The X11 TV session uses `picom` with the XRender backend and VSync to present
complete frames instead of tearing during video playback. Install it with
`sudo apt-get install --no-install-recommends picom`. The session owns the
compositor, skips it in headless mode, and stops it before handing DRM to
Moonlight. It leaves HDMI at native 3840×2160@60 and does not change microphone
monitoring. The GLX backend of picom 12.5 requires OpenGL 3.3; this TV box exposes
OpenGL 3.1, so use XRender rather than forcing GLX.

Linux WebKit video playback needs the system GStreamer parsers, decoders and
video sinks; the bundled FFmpeg used for analysis does not provide them. On
Debian/Ubuntu TV boxes install:

```sh
sudo apt-get install --no-install-recommends \
  gstreamer1.0-plugins-good gstreamer1.0-plugins-bad \
  gstreamer1.0-libav gstreamer1.0-gl
```

Verify `gst-inspect-1.0 fakevideosink`, `gst-inspect-1.0 h264parse`,
`gst-inspect-1.0 avdec_h264` and `gst-inspect-1.0 avdec_aac`, then restart
Nightingale. A successfully downloaded H.264/AAC clip can still fail in WebKit
when these plugins are missing; downloading another clip does not repair this.

The native Linux TV-box adapter prefers the Rockchip hardware decoder
`mppvideodec` (H.264, H.265, VP8, VP9, AV1), then `openh264dec` for H.264: the
installed `avdec_h264` decoded the first frame but failed on seeking in WebKit,
and software OpenH264 decodes a 1080p60 clip at about 10 fps. With
`mppvideodec` the same clip plays at 60 fps without dropped frames and seeks in
about 0.4 s instead of 5 s. Debian does not package it for the RK3588 vendor
kernel (`/dev/mpp_service`), so build Rockchip MPP and the GStreamer plugin into
`/usr/local`:

```sh
sudo apt-get install --no-install-recommends cmake ninja-build meson pkg-config \
  libdrm-dev libgstreamer1.0-dev libgstreamer-plugins-base1.0-dev
git clone --depth 1 -b develop https://github.com/rockchip-linux/mpp.git
cmake -S mpp -B mpp/build -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX=/usr/local -DBUILD_TEST=OFF
sudo ninja -C mpp/build install && sudo ldconfig
git clone --depth 1 -b gstreamer-rockchip https://github.com/JeffyCN/mirrors.git gst-rockchip
PKG_CONFIG_PATH=/usr/local/lib/pkgconfig meson setup gst-rockchip/build gst-rockchip \
  --prefix=/usr/local --buildtype=release -Drockchipmpp=enabled -Drga=disabled \
  -Dkmssrc=disabled -Dvpxalphadec=disabled -Drkximage=disabled
sudo ninja -C gst-rockchip/build install
```

The TV session adds `/usr/local/lib/aarch64-linux-gnu/gstreamer-1.0` to
`GST_PLUGIN_PATH`. MPP allocates frame buffers from `/dev/dma_heap`, which is
root-only by default; give the `video` group (which includes `tvbox`) access to
the decoder and the system heaps in `/etc/udev/rules.d/99-tvbox.rules`:

```udev
KERNEL=="mpp_service", SUBSYSTEM=="mpp_class", GROUP="video", MODE="0660"
SUBSYSTEM=="dma_heap", KERNEL=="system|system-uncached", GROUP="video", MODE="0660"
```

Without heap access WebKit selects `mppvideodec` but every buffer allocation
fails and the clip stalls. Verify with
`GST_PLUGIN_PATH=/usr/local/lib/aarch64-linux-gnu/gstreamer-1.0 gst-inspect-1.0 mppvideodec`.
Without the plugin playback falls back to OpenH264. This selects a decoder, not
a transcode; the microphone monitor is unchanged. An explicitly configured
`GST_PLUGIN_FEATURE_RANK` is respected instead of overriding the
administrator's decoder selection.

Song analysis runs at Linux background CPU priority (`nice=10`, or an existing
lower priority). RKNN normally boosts its caller to `nice=-19` when initializing
a context; Nightingale reapplies the background priority to the analyzer's
threads after each initialization. Subprocesses inherit this priority. This
does not change models, NPU core selection or decoded media quality, and is not
a hard CPU or memory limit; GPU/memory contention can still affect playback.

Open a local song's **YouTube video** action, search by artist/title (or title
only), and choose a result to download. Search results are sorted by duration
distance; selection remains manual. The first implementation downloads H.264
MP4 up to 1080p, 20 minutes and 512 MiB. It does not change the native 4K UI or
replace the local song audio. Existing source/UltraStar videos are overridden
only after an explicit download selection; removing that selection restores
the original background.

Setup installs `yt-dlp[default]==2026.8.19`, including its packaged YouTube
challenge solver. Existing installations can add that package to their vendor
Python environment without reinstalling analysis models. A supported Node.js
or Deno runtime must also be available to the application's process. Remote
solver downloads, browser cookies and account credentials are not used.

Offset matching compares the first five minutes of the unmodified local audio
with the downloaded clip, using independent spectral windows. It accepts a
constant offset only when at least two windows agree; different edits, live
recordings and weak matches fall back to explicit manual timing. This is not
time warping and cannot fix cuts or changing tempo in a different recording.

Use **Play preview**, ±10-second seek and ±0.1/±1-second offset controls, then
**Save offset**. The preview plays the original local song with a muted clip;
karaoke continues to use its existing instrumental/guide mix. The mapping is:

```text
video time (seconds) = playback time × song tempo ratio + video offset
```

A positive offset skips extra introduction in the video; a negative offset
holds the video until the song reaches its first frame. Video is hidden before
its start and after its end. All controls support arrows/OK/Back. Downloads
continue if the dialog closes and have a 15-minute timeout. Only one YouTube
worker runs at a time. Clearing the video cache removes downloaded clips and
their saved offsets, without deleting original library files. Download only
videos you are permitted to use.

For the self-hosted web adapter, explicitly configure `NIGHTINGALE_VIDEO_TOKEN`
with a private, random 32–256-character value and enter it in the video dialog.
Without it, search/download/offset/removal endpoints are disabled. The token is
kept only in the open dialog, not URLs or persistent browser storage. Use HTTPS
or a trusted private tunnel for remote access; other pre-existing server
endpoints do not gain authentication from this video-specific token.
