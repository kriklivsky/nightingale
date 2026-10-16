# Orange Pi TV applications

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
sudo install -m 0644 tools/tvbox/screen_app.py tools/tvbox/screen_audio.py \
  tools/tvbox/screen_receiver.py tools/tvbox/screen_server.py /usr/local/libexec/tvbox-screen/
sudo install -m 0755 tools/tvbox/tvbox-screen tools/tvbox/tvbox-screen-service \
  tools/tvbox/tvbox-screen-setup /usr/local/bin/
sudo cp -a client/screen-dist/. /usr/local/share/tvbox-screen/
sudo -u tvbox -H /usr/local/bin/tvbox-screen-setup 10.3.0.102
```

Build/install `tvbox-launcher` as described below. Do not restart the display
service: the new tile is available when the user next returns to the launcher.
The HTTPS listener binds the selected LAN IPv4 address on TCP 8091 while the
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
`server.key` to the laptop. Reserve the TV box's LAN address so its IP remains
covered by the certificate. The server also accepts an administrator-provided
certificate through its CLI flags.

The receiver owns a separate native UMC202HD monitor, mixing both input channels
to both speaker channels via ALSA `default`. It uses the launcher's saved
HDMI/Behringer route, not the WebRTC/laptop round trip. Microphone toggle controls
are on the TV. Independent optional settings live only in
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
the selected device's supported limits. Input and output adapt independently
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

The native Linux TV-box adapter prefers `openh264dec` for H.264 playback: the
installed `avdec_h264` decoded the first frame but failed on seeking in WebKit.
OpenH264 passed decoding, seeking and muted playback with the same downloaded
clip. This selects a decoder, not a transcode; other codecs and the microphone
monitor remain unchanged. An explicitly configured `GST_PLUGIN_FEATURE_RANK`
is respected instead of overriding the administrator's decoder selection.

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
