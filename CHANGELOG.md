# Changelog

All notable changes to Nightingale are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The release pipeline (`.github/workflows/release.yml`) extracts the section
matching the pushed tag (e.g. `v0.6.0` -> `## [0.6.0]`) and uses it as the
GitHub Release body. If a section is missing the release is still created
with a fallback body, but ideally every tagged version has its own entry
below.

## [Unreleased]

### Features

- Add an OLED-friendly menu screensaver: after five idle minutes in the song menu a dim clock and date on black appear and move every minute; any remote, keyboard, gamepad or pointer input dismisses it without acting on the menu.
- Add a Russian/English interface with a language setting (following the system language by default) across the karaoke app, and localize the laptop screen-sharing page to the browser language.
- Make playback easier to control from a TV remote: the pause menu now holds Start over, volume, guide vocals, microphone, monitoring and background controls; OK performs Skip intro/outro while offered; volume and setting changes show a brief on-screen indicator; secondary HUD details fade when idle; a progress bar along the bottom edge of the screen marks the sung passages; and readable disclaimers explain AI timing and orange estimated words.
- Add a note lane that shows upcoming melody notes with your detected pitch on top, with the previous compact meter selectable in Settings; scoring is unchanged.
- Fill sung words from left to right in a highlight colour, count the score up on the results screen and mark new personal bests.
- Simplify the library toolbar for the remote with a Ready to sing toggle, a combined Filters menu (including USDX) and a single view switch; label the Multiplayer and Add to queue buttons, confirm additions to the queue, show a loading skeleton, simplify sidebar counts and move Missing metadata to the end of the sidebar. Profile deletion is confirmed with a second press instead of an unreachable popover.
- Keep YouTube clips aligned without frame skipping or stalls: the clip plays at the song tempo, drift beyond 0.35 s is corrected by an occasional seek that leads by the measured seek time, the default background is shown before the clip starts and after it ends, and a clip that fails to decode is replaced by the background instead of freezing.

- Add launcher Wi-Fi settings, a manually enabled WPA2 event hotspot and automatic Ethernet uplink/direct-laptop detection, with remote-controlled password entry and USB/Bluetooth keyboard detection. Prefer Wi-Fi/AP addresses for the separate WebRTC receiver and retain the trusted HTTPS authority when its IP changes. Allow direct hardware-keyboard typing in TV karaoke search and US/Russian hardware layouts with Alt+Shift.

- Mark songs with an attached, available YouTube clip in both table and grid views, refreshing tags after attachment, removal and video-cache clearing. Show lazy-loaded YouTube thumbnails in clip search, with a fallback when a preview is unavailable and unchanged remote-button navigation.

- Toggle microphone speaker monitoring with OK / Enter during karaoke without disabling input or scoring; keep pause/results confirmation separate and retain the R shortcut and saved monitor preference.
- Add independent monitor controls on the TV and paired screen-sharing page, plus an opt-in, authenticated two-channel UMC202HD PCM feed and a certificate-verifying Python client for local laptop processing. Revoking access or ending the paired session stops the feed; screen audio and Nightingale remain separate.

- Backport Nightingale 1.3.0 features onto the TV-box fork: local multiplayer for two to four singers, independent solo/multiplayer channel-combining controls, shared hardware capture with separate channel scores, remembered player assignments and ranked per-player reports. Retain native low-latency monitoring, TV navigation, favorites, confirmed deletion, the scoring worker and synchronized YouTube clips.
- Add custom image/shader/silent-video backgrounds, background selection and playback master volume in Settings, folder browsing and artist/album trees, remote/keyboard queue reordering, a song loading screen and persisted desktop/playback window sizes.
- Import adjacent LRC/ELRC into the lyric editor without modifying files until Save, align words inside authored line windows, support custom reading annotations and optional CJK romanization, and discover completed shared-cache analyses on rescan. Preserve LRCLIB/Lyricsfile analysis and Rockchip RKNN processing.

- Add a separate, paired LAN-only WebRTC screen-sharing application to the TV launcher, with an HTTPS browser sender, independent microphone monitoring on the selected ALSA output, rotating TV codes and no cloud relay or recording; Nightingale remains unchanged.

- Add a remote-controlled HDMI / Behringer UMC202HD output selector to the TV launcher. Persist the shared ALSA route for karaoke music, native microphone monitoring and Moonlight, without changing microphone capture or restarting HDMI.

- Add a preview-first TV-box cleanup command for failed local songs, with explicit permanent deletion, database backup and manifest, shared-file protection, transactional staging, and resumption of other analysis jobs.

- Add a TV-box command to retry failed song analysis with a database backup and an application-only restart; refuse to interrupt active or queued analysis.

- Add remote-friendly YouTube clip search and downloads for local songs, duration-ranked results, conservative audio-based offset matching, and a silent video preview with manual timing adjustments. Shared playback keeps video synchronized through pause, seek and tempo changes; original media and karaoke audio remain unchanged. Self-hosted video operations require a separately configured access token.

- Replace distracting live pitch traces and rapidly changing messages with a calm, fixed-scale pitch meter. End-of-song results now include measured pitch accuracy, voice detection, above/below deviations and a remote-paged lyric-line report; reports are kept only for the current performance and score calculation remains unchanged.

- TV-box song search keeps its on-screen keyboard in fixed rows below the visible song list and updates search results after each entered character, without a Search confirmation button.

- TV-box song search now opens a remote-controlled on-screen keyboard with Cyrillic, Latin, digits, space, backspace and clear actions; browser and desktop text entry remain unchanged.

- TV-focused layout and defaults: song details open on Play or the first available action, its controls and metadata are easier to read, Settings show remote directions, and larger pause/results dialogs keep their primary actions prominent. When a queue has a next song, the results screen selects Next Song first.

- Made the library usable with a TV remote: search, filters, sorting, queue and view controls are reachable with arrows; empty-library setup and rescan actions can be selected with OK. Song-row actions now move left one step at a time, selection opens details, and clearer focus states and on-screen hints show the available navigation. Dialog arrows stop at the edge instead of wrapping unexpectedly.

- Added a confirmed Delete button beside Favorite and Play for local songs in the desktop app. UltraStar deletion includes referenced media and artwork; shared files and songs undergoing analysis are protected.

- Added persistent song favorites with a top-level Favorites library view, plus remote-focusable Favorite and Play buttons on each song row and grid card. Grid cards now let the TV remote move Right through Favorite, Play, and the next card. TV-box sessions now hide the native mouse pointer.

- LRCLIB lyric search now retries by song title and matches Cyrillic/Latin artist spellings (for example, «Монеточка» and «Monetochka») while retaining synchronized-lyrics and duration checks.

- Automatic analysis now uses synchronized LRCLIB lyrics instead of Whisper transcription. It prefers Lyricsfile word timestamps and otherwise aligns words from timed LRC; songs without timed lyrics stop before stem separation with an actionable error.

- TV-remote navigation now hides the idle mouse cursor and hover highlight, ignores stationary pointer events, keeps the selected sidebar row after playback, and uses Left/Right to enter or leave expanded sidebar sections.
- During playback, the Up/Down arrows (keyboard, gamepad D-pad/stick, and CEC remote) now adjust the speaker output volume of the backing mix while a song is playing, and the level is remembered between sessions. The microphone monitor gain stays a separate control. Outside playback the arrows keep their normal navigation behavior.
- During playback, the Left/Right arrows (keyboard, gamepad D-pad/stick, and CEC remote) now adjust the guide vocal volume while a song with guide vocals is playing — right is louder, left is quieter — and the level is remembered between sessions. When guide vocals are unavailable or the song is paused, the arrows keep their normal navigation behavior; the `G` toggle and `+` / `-` hotkeys still work as before.

### Fixes

- Decode YouTube clips and video backgrounds on the TV box with the Rockchip hardware decoder when its GStreamer plugin is installed: 1080p60 clips no longer play as a slideshow and corrective seeks take about 0.4 s instead of several seconds. Laptop screen sharing uses the same decoder, lowering 1080p display latency and raising 4K from about 10 to 22 fps.

- Fix word timing of LRC-timed lyrics: lines containing a sentence break (`?`, `!`, `.`) no longer shift every later line onto another line's words, adjacent lines that claim the same audio are re-aligned together, authored lines are no longer split after ten words, and lines no longer overlap. Re-analyze affected songs to apply it.
- Align LRC-timed lyrics with the Qwen3 forced aligner in chunks of several verses cut at vocal pauses, correcting LRC files that run a second or more ahead of or behind the recording, so line endings are no longer pressed into the next line's timestamp. On RK3588 boards with the converted model bundle the aligner runs on the NPU (about a minute per song instead of 15–20 minutes on the CPU); its timestamps match the reference model exactly. Lines sung only by a choir or backing vocals, which the separator puts in the instrumental, are aligned against the original mix instead of a silent vocal stem. A chunk that locks onto a repeated chorus no longer shifts the rest of the song: lines that end up squashed, overlapping or seconds away from their LRC time are re-aligned on their own, and the few that still cannot be placed are highlighted per line at their LRC time instead of with wrong word timings. Realign keeps each line's timing as an anchor instead of aligning the whole song as one text.

- Recover the TV-box HDMI source once after cold startup, even when the TV input was selected before the CEC listener started. Send Image View On and Active Source separately without a startup mode switch; skip a standby TV or another reported active source and share the existing recovery throttle.

- Keep TV karaoke networking available with split NetworkManager Wi-Fi / networkd Ethernet management by using the kernel-route GIO monitor, including when AP is disabled. Fit the independent network settings window to native TV geometry without requiring a window manager.

- Automatically repair root-imported TV-box song ownership every minute through a low-priority, non-overlapping cron job, without following links, modifying song contents or restarting applications.

- Repair TV-box library ownership after root-owned imports so Nightingale can stage and delete local songs without `Permission denied`; retain file contents and permission modes, and document ownership requirements for future imports.

- Keep TV controls inside a small safe area without changing native 4K output, and give song titles flexible width and two lines before secondary table columns when a side panel is open.
- Reject low-confidence microphone noise and expire stale pitch readings so a silent or disconnected multiplayer input cannot keep earning points from its last note. Channel capture and speaker monitoring stay independent of scoring gates.
- Reduce native monitor startup prefill to 256 frames without shrinking the proven 512-frame input/output periods or disabling independent adaptive recovery.

- Reuse active native capture capabilities when listing channels or adding another singer, so an exclusively opened USB microphone remains selectable without reopening it.
- Initialize multiplayer channel assignments from the preferred interface instead of unrelated onboard or virtual inputs.
- Keep the proven CPAL 0.17.3 native audio backend while adding shared multichannel capture; avoid CPAL 0.18 ALSA regressions in saved device IDs, fixed HDMI periods and repeated monitor underruns.

- Suspend song/queue sidebar navigation while multiplayer setup covers it, preventing the parent panel from stealing remote focus from the modal.

- Save multiplayer profile scores in one batch rather than racing independent profile-file writes, and protect active/queued analysis jobs during shared-cache reconciliation. Preserve existing output-volume settings and window geometry when saving configuration.
- Keep the audio callback lock-free and allocation-free, independent adaptive input/output periods and 48 kHz USB/HDMI preferences.

- Resume karaoke audio only once when confirming Continue in the pause dialog, and do not resume it while exiting to the menu.

- Bound analyzer startup and IPC messages, distinguish heartbeat liveness from stage progress, and restart unresponsive or stalled workers instead of leaving the queue blocked indefinitely. The stage timeout defaults to 30 minutes and can be set with `NIGHTINGALE_ANALYZER_STALL_TIMEOUT_SECS` (300–86400 seconds).

- Wait out LRCLIB's shared rate-limit cooldown before each analyzer lyric request, retry HTTP 429 up to three times without restarting a successful search step, and avoid immediately failing the remaining queue; waiting remains cancellable and interactive searches still fail promptly.

- Serialize batch cancellation with enqueue and progress updates, commit cancellation before changing memory, and keep queue database errors from being treated as empty queues during recovery or file deletion.

- Mark analysis jobs for missing library songs as failed instead of leaving them queued forever, and keep source-video conversion outside the analysis queue lock.

- Reject non-regular ALSA configuration files before reading them, preventing a named pipe from freezing the launcher's audio selector.

- Make library search Unicode-aware across song title, artist, album and path, including Cyrillic case-insensitivity and ё/е equivalence without rewriting tags. Database failures now produce an explicit, remote-retryable error instead of an empty song list.

- Persist analysis batches atomically before exposing them to the worker, avoid quadratic duplicate checks, propagate enqueue failures, and allow explicitly filtered failed songs to be retried while automatic scanning still skips failures.

- Ignore symlinked video-cache subdirectories when calculating clearable bytes or clearing clips, preventing deletion through links outside the cache.

- Share canonical media-path validation between desktop and web adapters, including explicitly configured song caches so relocated stems remain playable. Prepare source video and resolve media files outside UI/async request threads.

- Default the standalone web server to loopback and warn when explicitly exposing its unauthenticated API; Docker and installer listener overrides remain unchanged.

- Require valid JSON command bodies before dispatching web API actions, so malformed requests and ordinary cross-site HTML form posts cannot trigger no-argument cache-clearing commands.

- Restore the HDMI mode before announcing the selected CEC source, preventing soundbar wake announcements from being sent on the link that is about to be retrained.

- Run a VSync-enabled XRender compositor in the HDMI TV session to remove horizontal tearing, with no compositor in headless mode or during direct-DRM Moonlight playback.

- Prepare the source clip and its initial offset while karaoke audio loads, keeping the same video element when playback starts instead of loading it late and repeatedly seeking to catch up.

- Wait for a valid positive media duration before the first video seek, avoiding repeated zero-duration seeks during WebKit's initial media setup.

- Serve native local media with an explicit `Content-Length` instead of automatic chunked transfer, fixing WebKit/GStreamer seeks that hang on attached clips. Stream files and bounded byte ranges directly from disk; invalid or unsatisfiable ranges return HTTP 416 instead of allocating an invalid buffer.

- Preload source clips explicitly and wait for WebKit/GStreamer preroll before the initial seek; keep positive-offset clips hidden until the requested frame is ready. Wait for pending seeks or buffering before correcting drift, and throttle large corrections too, preventing per-tick seek storms in karaoke and previews.

- Install the missing WebKit/GStreamer video plugins on the Orange Pi and prefer OpenH264 in native Linux TV-box sessions to avoid reproducible `avdec_h264` seek failures. Document playback dependencies separately from the analyzer's bundled FFmpeg; preserve explicit decoder-rank overrides.

- Keep microphone capture and speaker-monitor buffer adaptation independent, identify the failing stream in logs, and retry smaller periods after a bounded cooldown instead of permanently retaining a high-latency recovery floor. Native CPAL audio workers now request real-time scheduling; Linux TV-box deployment uses RTKit.

- On TV source selection, retrain an already-active 4K60 HDMI link at 59.94→60 Hz. When the TV first selects only the soundbar, wait for the Orange Pi's CEC address before activating its HDMI input; remote button presses do not trigger retraining.

- Restore native 3840×2160 at 60 Hz on TV-box startup and ignore brief connector renegotiations before restarting the display session.

- Select the Orange Pi HDMI route with separate CEC commands before retraining the soundbar input; a CEC timeout no longer aborts the display-wake sequence.

- Keep analyzer progress readable by suppressing only known harmless RKNN static-shape/layout diagnostics and weight-loading spinners; each song start now logs its artist, title, and number of songs still queued.

- On the Orange Pi TV box, restore the native 4K HDMI picture when the TV selects its soundbar/Orange Pi CEC route. Use the confirmed working 30 Hz mode and a soft refresh-rate retrain because the soundbar reports "No signal" at 60 Hz after wake; retry CEC address allocation until TV remote navigation returns. Power-on and remote button presses do not trigger source switching or HDMI retraining.

- Align timed LRCLIB lyrics one line at a time, release RKNN memory before word alignment, resume interrupted analysis queues after restart, and retry unfinished LRC songs with word alignment instead of silently accepting line-only timings.
- Keep RKNN song analysis below Orange Pi memory limits by streaming its 19 model components and limiting PyTorch CPU workers; an analyzer OOM no longer tears down the TV session.

- Prevent RK3588 UVR inference from producing non-finite output on silent audio by using an FP16-safe band-normalization floor during model export.

- Preserve failed analysis statuses across restarts and reject missing or empty transcripts before processing audio.
- Recover the configured microphone monitor when a USB audio interface appears after startup, and refresh the open microphone selector automatically.
- If RKNN karaoke separation returns non-finite audio, restart the analyzer and retry on CPU so album analysis can continue without retaining NPU memory.

- Report completed UVR separation chunks during analysis instead of displaying 20% for the entire separation stage.
- Analysis status sorting now orders ready songs by the transcript source shown in their status badge.
- The "Measure latency" button in Settings now sits on its own row below the latency slider, so a TV remote can reach it with the arrow keys instead of it being trapped in the slider's row.

### Performance

- Reuse RKNN transformer worker threads across chunks and expose context-initialization cost in optional RKNN profiling; retain single-chunk inference, model integrity checks and the existing model/overlap-add behavior.

- Virtualize song tables and card grids while preserving global TV-remote navigation and scroll restoration; keep per-song action callbacks stable so moving focus does not rerender every visible song.

- Prepare pitch-scoring reference duration in a cancellable Web Worker before starting music, and reuse the pitch detector between renders without changing scoring calculations.

- Move cache scans and cleanup off desktop UI/server async threads, cache statistics for one minute, and refresh them immediately after explicit cleanup or cache-path changes.

- Use bounded single-producer/single-consumer microphone buffers and mix samples directly in native audio callbacks, avoiding callback allocations and blocking queue locks; size monitoring queues for both capture and output periods.

- Move library reads and analysis actions off the desktop UI and server async workers. Refresh library pages only when scan metadata or analysis status changes, not on each percentage update or unchanged incomplete scan.

- Run Linux song analysis at background CPU priority (`nice=10`), including existing worker threads and subprocesses; restore it after each RKNN context initialization instead of retaining the runtime's automatic `nice=-19` boost.

- Run independent RK3588 UVR transformer slices across three NPU cores in streamed mode on the Orange Pi TV box, reducing measured per-chunk inference time while preserving the serial path elsewhere.

- Key detection now decodes audio with ffmpeg directly, avoiding an unnecessary WhisperX import on the automatic LRCLIB path.
- Lowered the microphone monitor round-trip latency by targeting a 512-frame ALSA period (~10.7 ms) instead of the previous fixed 2048-frame buffer. If USB xruns or POLLERR storms return, the buffer now escalates automatically (512 → 1024 → 2048 → 4096 frames) and steps back down after stable runs, so the monitor degrades to a stable size instead of dropping audio.
- Bound the live microphone's shared PCM queue to two capture periods so USB/HDMI clock drift cannot accumulate into growing vocal delay; skip the HDMI monitor stream when monitoring is disabled.

## [1.2.0] - 2026-09-02

### Features

- Added a playback queue to the song browser with a queue count, compact next-up sidebar, per-song removal, confirmed queue clearing, and keyboard and gamepad navigation.
- Added Session playback mode, which opens playback in a dedicated desktop window or browser tab while the menu remains available for live queue management.
- Playback settings now have a dedicated tab with a proportional live preview, lyric placement controls, and 50–250% lyric and pitch-graph scaling (100% by default).
- Added bulk song actions and a Refresh Metadata action for reloading metadata from the library source.
- Queued or in-progress song analysis can now be cancelled per song or in bulk across filtered songs.
- Added compact sortable song-table headers with persisted multi-level priorities, immediate list reordering, displayed-duration tie-breaking, and stable duplicate-file rendering.

### Improvements

- Source setup now warns that changing the data source clears the current library and its analysis state, with confirmation before choosing a replacement folder.
- Leaderboard entries now show when each score was achieved beneath the profile name.
- Long gaps between lyric lines now show a compact countdown beneath the song details, while the circular three-second countdown bubble stays beside the lyric line as the next line approaches. The next lyric block is no longer previewed across an instrumental break.
- Changed "AI generated" to "AI transcribed" in the song list.
- Added Windows ASIO microphone support and a microphone recording/playback test in Settings.
- Analyzer setup now installs the released `transformers` 5.13+ package instead of cloning a pinned Git commit.

### Fixes

- Analyzer setup now keeps WhisperX on a release compatible with `transformers` 5, preventing Windows lyrics analysis failures in pyannote.
- Video files now use audio-stream title metadata, preventing subtitle titles from replacing song names.
- The lyrics editor now allows re-aligning analyzed songs without requiring a lyrics change.
- Empty transcription results now finish without attempting forced alignment.

### Documentation

- Updated the website and user guide for the v1.2.0 queue, Session mode, playback customization, bulk library actions, and multi-level sorting.

## [1.1.0] - 2026-08-14

### Features

- Leaderboards — open a global top-10 ranking across every profile and song from the profile menu, or open a song-specific leaderboard to compare each profile's personal best. Scored songs expose the per-song board directly from their details panel.
- Personal-best ratings — song cards, table rows, and song details now show the active profile's best score as a five-star rating, with the exact score available on hover.

### Improvements

- Instant key and tempo controls — stepper changes are now staged immediately, then prepared together when playback starts. The Play button shows preparation progress and enters playback only after the adjusted audio is ready.
- Prebuilt Docker distribution — release tooling can publish multi-architecture CPU images and CUDA images to Docker Hub and GHCR. The Docker quick start now uses the published image, a persistent named data volume, and host port `64448`, while local builds remain supported.
- Theme-aware scrollbars — scrollable app surfaces now use compact scrollbar colors that follow the active light or dark theme.

### Fixes

- Setup errors now wrap and scroll within the modal instead of overflowing the dialog.
- UVR stem separation now converts source audio to WAV before loading it, preventing failures on input formats the separator cannot read directly.

## [1.0.0] - 2026-07-25

🎉 **Nightingale 1.0 is here!** Reaching this milestone means a great deal to me. I'm incredibly proud of the app Nightingale has become and grateful to everyone who has tried it, shared feedback, reported issues, contributed, or simply cheered the project on. Thank you for being part of the journey — I hope you enjoy this release as much as I've enjoyed building it.

### Features

- Provide your own lyrics — paste timed **LRC / Enhanced LRC** to skip transcription (optionally skipping stem separation to play over the original mix), or plain lyrics to run alignment. Available on un-analyzed songs via a new **Provide LRC** action and in the existing lyrics editor; LRCLIB matches now include plain-text results. No-stems songs still detect key for key/tempo shifts, hide the guide control, and score pitch against the original mix (flagged as less accurate).
- Plex Media Server provider — authorize through Plex's hosted PIN flow with account server discovery, or connect a LAN-only PMS directly with its URL and token. Choose one or more music libraries; Nightingale syncs their tracks and associated playable clips, metadata, covers, and read-only audio playlists. Playback and analysis lazily cache original media, video uses the authenticated range proxy, and every normal provider request goes directly to the selected PMS rather than app.plex.tv. Tokens are encrypted at rest and never placed in frontend media URLs.
- Playlist browsing — open existing Plex, Jellyfin, Navidrome, `.m3u`, `.m3u8`, and `.pls` playlists from the sidebar.

### Improvements

- Redesigned song browser — switch between a compact table and an artwork-first grid, scan clearer status and metadata at a glance, and select a song to open a dedicated details sidebar before playback. The sidebar brings the cover, analysis state, key/tempo controls, lyrics and language tools, analysis actions, and Play button into one focused view.
- Jellyfin library selection — choose which Jellyfin music libraries Nightingale syncs instead of importing every library.
- Analysis queue navigation — Quick Filters now includes a **Queued** view that shows the active track first followed by pending tracks in queue order. Sidebar counts use one compact segmented badge for total, queued, analysing, and analysed tracks, with matching status colors on song cards.
- Song list filtering — the responsive top toolbar can filter songs by analysis status and transcript type (**Generated**, **AI Aligned**, or **LRC**). Filters combine with search and sidebar selections, and **Analyze all** now respects the complete filtered view.

## [0.9.0] - 2026-07-06

### Features

- Docker support for self-hosted web mode — a multi-stage [`docker/Dockerfile`](docker/Dockerfile) and [`docker/compose.yaml`](docker/compose.yaml) build the `server` binary (with the React bundle embedded) into a container that runs without the systemd/Caddy/Avahi installer. The same Dockerfile produces both a CPU image (`debian:bookworm-slim`) and a CUDA/GPU image (via `--build-arg RUNTIME_BASE=nvidia/cuda:...` plus the NVIDIA Container Toolkit). The ML toolchain still bootstraps on first launch into the mounted `/data` volume, so the image stays small and dependencies persist across recreates. The data folder is fixed to `/data` (the setup wizard skips the data-folder step) and the music library follows a `/songs` convention via a new `NIGHTINGALE_LIBRARY_PATH` env var (defaulted in the image) — mount your music at `/songs` and Nightingale pins a folder source there on startup and hides the in-app source pickers, so nothing needs typing in the browser. Mic scoring still needs a TLS reverse proxy for a secure context. See [docs/docker](https://nightingale.cafe/docs/docker.html).
- Cantonese (`yue`) lyric support — Cantonese now joins Japanese, Mandarin, and Korean as a first-class CJK language. It rides the same per-character forced-alignment path as Mandarin (reusing the Chinese wav2vec2 model and jieba tokenization, since Cantonese is written in the same Han characters), works with the Qwen alignment backend, and shows [Jyutping](https://github.com/CanCLID/ToJyutping) romanized readings above each token. The per-song language override now lists **Mandarin** and **Cantonese** separately (the former "Chinese" label). Existing installs should re-run setup so the new Cantonese romanization dependency is installed.
- Experimental CTC forced-alignment backend — **Settings → Analysis → Forced alignment** can now use torchaudio's `forced_align` C++/CUDA kernel instead of WhisperX's pure-Python Viterbi. It computes each word's start/end points with a different algorithm, and is much faster on CUDA GPUs and Apple Silicon (where WhisperX alignment runs on the CPU). It also speeds up LRCLIB lyrics alignment and automatically falls back to WhisperX on error. Defaults to WhisperX, so existing behavior is unchanged unless you opt in.
- Experimental Qwen forced-alignment backend — **Settings → Analysis → Forced alignment** can also use [Qwen3-ForcedAligner-0.6B](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B-hf), a non-autoregressive model that timestamps every token in one forward pass from audio + transcript (no wav2vec2, no phonetic step). It's fast and covers 11 languages, runs on CUDA and Apple Silicon MPS (as well as CPU), and falls back to WhisperX for unsupported languages, over-length audio, or any error. Timing quality varies song to song, but it can do better on CJK. Defaults to WhisperX, so existing behavior is unchanged unless you opt in. Existing installs should re-run setup so the new Qwen dependencies are installed.
- Adjustable vocal-detection sensitivity — **Settings → Analysis → Vocal detection sensitivity** exposes the RMS threshold that decides where a song's vocals start and end. Lower it when quiet intros, outros, or soft singing get trimmed; raise it to cut more silence. Defaults to 15%, matching previous behavior.

### Improvements

- Clearer analysis settings — the vocal separator, transcription model, and alignment model options now have plain-language descriptions explaining what each choice actually changes.
- Smoother lyrics display across short pauses — a finished line now stays on screen with its already-sung word colors until the next line's lead-in begins, instead of vanishing the moment it ends. Longer gaps still show the countdown as before.

### Fixes

- Fixed Settings page focus rings: tabs, buttons, and the beam/batch number pickers no longer show clipped borders or a brief shrink flicker on hover. The page now uses the same focus-ring style as the rest of the app (removing the `ring-offset` that got clipped by the scroll containers) and the number pickers have room for the ring.

## [0.8.0] - 2026-06-08

### Highlights

- Flexible cache folders — cache, video, model, and vendor directories can be separated from the main data folder, with guarded migration of existing contents.
- Auto-analysis — when enabled, scans queue newly discovered unanalyzed songs automatically.
- Playback polish — touch devices get on-screen playback controls, lyrics can be placed top/center/bottom and left/center/right, and the menu/playback UI adapts better to small screens.

### Improvements

- Settings moved from a modal into a dedicated page, keeping the existing controls easier to browse and navigate.

## [0.7.2] - 2026-05-28

### Highlights

- Donations — Nightingale is open-source, free, and built by one person. You can now support development with recurring monthly backing on [Patreon](https://www.patreon.com/cw/nightingalekaraoke) or a one-off tip on [Ko-fi](https://ko-fi.com/nightingalekaraoke). A new **Donate** entry under the sidebar avatar (heart icon) opens a dialog with both options. Until it's opened once, the avatar shows a pink badge — the existing green update dot still takes priority. The marketing site also gained a matching `Support Nightingale` section and `Donate` nav link.

## [0.7.1] - 2026-05-27

### Fixes

- Folder libraries now detect `.opus` audio files and serve them with an Ogg audio MIME type for browser playback.
- Changing a song's language can now realign existing lyrics without forcing a fresh transcription, and the selected language is preserved for the alignment pass.
- Edited lyrics keep the song's previous language hint when re-running alignment, avoiding accidental language resets.
- The self-hosted update/install command no longer pipes the installer through `sudo`, matching the script's own privilege handling.

### Improvements

- Polished the language-selection dialog with explicit force-transcribe vs realign choices and controlled selection state.
- Tightened the library sidebar scroll/layout behavior around the main navigation list.

## [0.7.0] - 2026-05-20

### Highlights

- Self-hosted web mode (v1) — Nightingale now ships a second binary, `server`, that runs the same app over HTTP on a Linux box on the LAN. The React bundle is embedded into the binary via `rust-embed`, browsers on phones/laptops/tablets/TVs all open the app at `http://<hostname>.local`. A one-shot `scripts/install.sh` drops a systemd unit, a Caddy front-door (HTTP on `:80`, opt-in HTTPS via Caddy's local CA on `:443` for mic capture), and an avahi advertisement onto the host so it's reachable without DNS. See [docs/self-hosted](https://nightingale.cafe/docs/self-hosted.html).
- Jellyfin media provider — connect the library to a Jellyfin server from the sidebar. Items are scanned via paginated `GET /Items` with `SortName` for stable enumeration; bytes are downloaded lazily on first analysis into `cache/sources/<file_hash>.<container>` and rekeyed to a true Blake3 hash, so the rest of the karaoke pipeline (stems, transcription, shifts) behaves identically to a folder library.
- Navidrome / Subsonic media provider — same shape as Jellyfin, but talking the [Subsonic API](http://www.subsonic.org/pages/api.jsp). Audio-only (Navidrome doesn't serve video). Auth uses per-call `MD5(password + salt)` tokens; the password is encrypted at rest in `config.json`.
- Lyrics editor with LRCLIB browser — every song now has an "Edit lyrics" entry that opens an editor seeded with the current transcript. When LRCLIB returns multiple candidate matches, a second tab lets you carousel through them and apply one with a single click. Saving re-runs alignment with your edits, so timing stays accurate.
- Sidebar restructure — Library actions (folder picker, Jellyfin/Navidrome connect, rescan), cache actions (clear all / videos / models), and the theme toggle moved out of the avatar dropdown into dedicated clusters. The Library row exposes its source buttons inline with live status badges (green/grey/amber) and tooltips showing the reachable hostname or the connection error. The avatar dropdown is now Profile / Settings / Update / About / Exit / Re-run Setup.

### Improvements

- Persistent scroll — sidebar and song-list scroll positions are preserved when navigating away and back, via a new `usePersistentScroll` hook keyed by panel id.
- Higher-contrast sidebar surfaces — various sidebar/menu surfaces had their contrast bumped after the cluster restructure, mostly for the badges and the focused/hovered ring states.
- `app-core` crate extraction — all cross-runtime logic (config, scanner, library DB, vendor bootstrap, sources, secrets, media server) was lifted out of `client/src-tauri` into a new `app-core` crate consumed by both the Tauri desktop client and the new self-hosted `server`. Drops a chunk of duplicated code and removes the few client/server divergences that had crept in.
- `library_db` modularization — the single 1k-line `library_db.rs` was split into `connection`, `migrations`, `queries`, `songs`, `analysis_queue`, `remote`, and `rebase`. Remote-source helpers live in `library_db::remote` so Jellyfin/Navidrome share the prune/upsert plumbing.
- Single-focus refactor — `use-menu-nav.ts` was split into `menu-nav/{use-menu-nav-input, use-menu-nav-refs, use-mouse-menu-focus, use-nav-lock, use-scroll-to-song, use-tab-panel-switch}`. Resolves a pile of edge cases where focus could land in two panels at once or get stuck after dialog dismissal.
- `mic_mirroring` → `mic_monitoring` — the setting and its config keys are renamed (`mic_monitoring`, `mic_monitor_gain`, `mic_active`). Older configs with `mic_mirroring` / `mic_mirror_gain` are read transparently via serde aliases and rewritten under the new names on next save. Existing UI hotkeys (`R` to toggle, etc.) are unchanged.

### Documentation

- New [Self-Hosted Web Mode](https://nightingale.cafe/docs/self-hosted.html) page with the full install / HTTPS / firewall / co-existing-with-your-own-Caddy story.
- New [Library Sources](https://nightingale.cafe/docs/library-sources.html) page covering the Folder / Jellyfin / Navidrome options and the at-rest credential envelope.
- Updated [Lyrics & Transcription](https://nightingale.cafe/docs/lyrics.html) page with a section on the in-app lyrics editor and the LRCLIB candidate browser.
- Updated [Configuration](https://nightingale.cafe/docs/configuration.html) page with the new `library_source` key and the `mic_monitor_gain` rename.

## [0.6.0] - 2026-05-10

### Highlights

- CJK lyric support — Japanese, Chinese, and Korean songs now go through a per-character forced-alignment path with romanized readings (Hepburn / pinyin / Revised Romanization) shown above each token. Japanese uses a hiragana-vocab wav2vec2 model fed through fugashi, which sidesteps the dense kanji vocabulary and matches natural speech far better than the default checkpoint.
- Parakeet v3 ASR (experimental) — alternative to Whisper for ~25 European languages. NeMo on CUDA, ONNX Runtime on CPU and Apple Silicon. Switchable from Settings → Analysis. Falls back to Whisper automatically if Parakeet returns no usable words.
- UltraStar Deluxe songs (experimental) — drop USDX bundles (.txt or .usdx plus sibling audio/vocals/instrumental/video) into your library and play them with their built-in pitch and lyric data. No analyzer pass needed; stem separation is skipped entirely when #VOCALS and #INSTRUMENTAL are provided. See [docs/usdx](https://nightingale.cafe/docs/usdx.html).
- Audio-reactive shader backgrounds — the 5-shader lineup is now 10 (Plasma, Waves, Nebula, Starfield, Sonar, Voronoi, Vortex, Metaballs, Spectrum, Oscilloscope) and they all react to your microphone input in real time when the mic is enabled.
- Persistent analyzer server — the Python analyzer is now a long-lived process talking to the app over a token-authenticated loopback TCP socket using NDJSON.
- In-app updater (macOS and Windows) — Nightingale now checks for new releases and can download and install updates from inside the app. A new **Update** entry lives in the sidebar actions menu, with progress reporting and a one-click relaunch when the install finishes. Linux still ships the menu entry but opens the GitHub Releases page since the updater plugin isn't compiled in for Linux builds.

### Improvements

- Mic monitor gain slider — the live mic-mirror volume is now a 0–200% slider in Settings, replacing the previous fixed level.
- Cleaner client architecture — playback state lives in dedicated React contexts (transport, transcript, mic, theme) instead of being prop-drilled through playback-inner. The shader visualizer was also extracted from the old monolithic video-background component.
- Pitch and reactive analysis moved to the client — both run in TypeScript over raw PCM samples streamed from Tauri, dropping a chunk of native code and making them easier to tune.
- Single GPU model at a time — Whisper, Parakeet, the alignment model, and the stem separator are now loaded one at a time and freed between stages, lowering peak VRAM and reducing OOMs on smaller GPUs.
- Alignment robustness — several edge cases in the WhisperX alignment path were fixed, including better handling of silence-bounded segments and tokens that fall outside the model vocab.

### Fixes

- Various typo and copy fixes in playback UI strings.

### Documentation

- New [UltraStar Deluxe](https://nightingale.cafe/docs/usdx.html) docs page covering detection, supported tags, the BPM/GAP timing model, and limitations.
- Expanded [Lyrics & Transcription](https://nightingale.cafe/docs/lyrics.html) docs with ASR engine selection and a CJK languages section.
- Updated [Backgrounds](https://nightingale.cafe/docs/backgrounds.html), [Configuration](https://nightingale.cafe/docs/configuration.html), and [How It Works](https://nightingale.cafe/docs/how-it-works.html) pages.

## [0.5.0] - 2026-04-06

Initial public release tracked in this changelog. See the
[v0.5.0 release notes](https://github.com/rzru/nightingale/releases/tag/v0.5.0)
on GitHub for the full artifact list.
