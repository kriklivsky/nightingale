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
| Toggle mic monitoring | R | — |
| Toggle fullscreen | F11 | — |
| Skip Intro / Skip Outro | On-screen buttons | A (South) |

Touch devices show on-screen playback controls for core actions instead of relying on keyboard shortcuts.

During playback, the Left/Right arrows adjust the guide vocal volume only while a song is playing with guide vocals available; otherwise they keep their normal navigation behavior (for example, moving between the Continue / Exit buttons in the pause dialog).

Key and tempo are adjusted from the song details sidebar after a song has been analyzed. Playback mode, lyric placement and scale, pitch-graph scale, preferred microphone, mic latency compensation, and analysis defaults live in **Settings**.

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
