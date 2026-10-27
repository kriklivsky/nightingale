# Controls

Nightingale supports keyboard, gamepad, and touch input. The UI adapts to your input method automatically.

## Navigation

| Action | Keyboard | Gamepad |
|---|---|---|
| Move | Arrow keys | D-pad / Left stick |
| Confirm / Select | Enter | A (South) |
| Back / Cancel | Escape | B (East) / Start |
| Switch panel | Tab | — |
| Search songs | Type to filter | — |

A TV remote that forwards HDMI-CEC keys uses the same arrow, Enter, and Escape controls. In the sidebar, Right opens a section and moves into its first item; Left returns to the section heading or closes it. Right on an item moves to the song list. The sidebar selection stays in place when you return from playback. The mouse cursor is hidden while navigating with arrows and reappears when the mouse moves.

## Playback

| Action | Keyboard | Gamepad |
|---|---|---|
| Pause / Resume | Space | Start |
| Exit to menu | Escape | B (East) |
| Toggle guide vocals | G | — |
| Guide volume up/down | ← / → or + / - | D-pad left/right |
| Speaker output volume up/down | ↑ / ↓ | D-pad up/down |
| Cycle background theme | T | — |
| Cycle video flavor | F | — |
| Toggle microphone | M | — |
| Next microphone | N | — |
| Toggle mic monitoring (keep scoring active) | Enter / R; TV remote OK | A (South) |
| Skip Intro / Skip Outro (while offered) | Enter; TV remote OK | A (South) |
| Toggle fullscreen | F11 | — |

Touch devices show a Pause button; every playback setting is then available in the pause menu.

The pause menu doubles as the playback control center for a TV remote: ↑/↓ choose a row, ←/→ change its value, OK selects and Back resumes. It offers Continue, **Start over** (restarts the song and discards the current attempt's score), volume, guide vocals, microphone and its device, monitoring, background and Pixabay video collection, and exit. Volume, guide, microphone, monitoring and background changes made during the song briefly show their new value on screen.

The song title, artist and clock fade out a few seconds after the last input and return on any key, remote button or pointer movement; the score and skip button stay visible. The progress bar along the bottom edge of the screen marks the sung passages, so long instrumental breaks are visible ahead of time.

While **Skip intro** or **Skip outro** is shown, OK / Enter performs the skip; otherwise it toggles microphone monitoring.

During an actively playing song, **OK / Enter** toggles only the microphone sound sent to the speakers. Microphone capture and each singer's scoring remain active; backing-track and guide volume do not change. Holding Enter does not repeatedly toggle the monitor. The pause and results dialogs keep their usual Confirm action. With speakers connected to UMC202HD and its hardware **Direct Monitor** enabled, turn software monitoring off to avoid a delayed second copy of your voice. This setting is remembered between karaoke sessions.

During playback, the Left/Right arrows adjust the guide vocal volume only while a song is playing with guide vocals available; otherwise they keep their normal navigation behavior (for example, moving between the Continue / Exit buttons in the pause dialog).

Key and tempo are adjusted from the song details sidebar after a song has been analyzed. Playback mode, lyric placement and scale, pitch display and its scale, interface language, preferred microphone, mic latency compensation, and analysis defaults live in **Settings**.

## Pitch display

By default a note lane shows the melody's notes scrolling toward a fixed line, with upcoming notes visible in advance, and draws your detected pitch on top: green when on pitch, blue when below and amber when above. Octaves are folded onto the melody, as in scoring. **Settings → Playback → Pitch display** switches to the compact Low/Target/High meter. The display does not change how the score is calculated.

## Interface language

**Settings → General → Interface language** switches between English and Russian, or follows the system language. The laptop screen-sharing page follows the browser language.

## YouTube clips

A synchronized YouTube clip keeps a constant offset from the song and is never time-stretched. Before the clip starts and after it ends, the default animated background is shown. The clip plays at the song's tempo; when it drifts more than about a third of a second it is re-seeked slightly ahead by the measured seek time, rather than sped up or slowed down, which stalls on GStreamer-based WebKit. A clip that fails to decode is replaced by the background.

## Screensaver

After five minutes without input in the song menu, the screen turns black with a dim clock and date that move to a new position every minute to protect OLED panels. Any remote button, key, gamepad input or mouse movement dismisses it; that first press only wakes the screen and does not act on the menu. Playback never shows the screensaver.

## Gamepad Notes

- Full navigation of menus, song selection, and settings via gamepad
- D-pad and left stick both work for navigation
- Face buttons map to confirm (A/South) and cancel (B/East)

## Multiple microphones

On desktop, Settings → General shows **Combine multi-channel** when an audio interface has several input channels. Disable it to select a single channel for solo scoring. With it enabled, scoring follows the strongest channel; microphone monitoring remains a separate control.

Open a song's details and choose **Play multiplayer** for two to four singers, or use the multiplayer button in the playback queue. Multiplayer has its own **Combine multi-channel** setting and remembers player assignments. For a Behringer UMC202HD with two microphones, disable this setting and assign **Channel 1** to one player and **Channel 2** to the other. They share one hardware capture stream but receive independent scores. Guests do not write scores to a saved profile.

Results show the ranking and let you switch between each singer's line-by-line report. For queued playback, **Change players** configures the next song. Native monitoring continues to use the selected HDMI/Behringer output independently of the backing-track volume.

Queue entries have **Move up** / **Move down** actions for the remote. With a keyboard, focus the drag handle and use **Alt+↑/↓**, or start dragging with Space and use arrows; pointer dragging is also supported.

## Settings Navigation

Settings use the same navigation model: move between General, Playback, and Analysis tabs, change sliders/selects/buttons, and close or restore defaults without a mouse.
