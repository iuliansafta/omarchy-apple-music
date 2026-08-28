# Development

## Architecture

```text
AppleMusicWidget.qml
        │
        ▼
AppleMusicService.qml ── Quickshell.Services.Mpris
        │
        ▼
scripts/apple-music ── dedicated Chromium app/profile
        │
        ▼
extension/duration-bridge.js ── MusicKit → Media Session duration
```

The service selects only the Chromium MPRIS name whose `.instance<PID>` suffix matches the PID of the dedicated Hyprland window. It never falls back to the first Chromium player, preventing a normal YouTube tab from being mistaken for Apple Music.

## Local setup

Clone the repository and link it into Omarchy's user plugin directory:

```bash
git clone https://github.com/iuliansafta/omarchy-apple-music.git
cd omarchy-apple-music
ln -s "$PWD" ~/.config/omarchy/plugins/iuliansafta.apple-music
omarchy-shell shell rescanPlugins
omarchy plugin enable iuliansafta.apple-music center
```

Files stored directly below `~/.config/omarchy/plugins/` hot reload when saved. When using the development symlink above, filesystem events may not cross the symlink; restart the shell after source changes:

```bash
omarchy restart shell
```

Rescan after changing the manifest or adding the symlink:

```bash
omarchy-shell shell rescanPlugins
```

## Validation

```bash
omarchy plugin validate .
bash -n scripts/apple-music
node tests/model.test.js
node tests/duration-bridge.test.js
```

Check service state through shell IPC:

```bash
omarchy-shell iuliansafta.apple-music status
```

Check recent loader errors:

```bash
journalctl --user --since "2 minutes ago" | grep -Ei \
  'apple-music|qml.*(error|warn)|ReferenceError|TypeError'
```

## MPRIS debugging

List bus names without `playerctl`:

```bash
busctl --user list | grep org.mpris.MediaPlayer2
```

Inspect Chromium metadata, replacing `<pid>` with the value from the launcher:

```bash
pid=$(scripts/apple-music pid)
busctl --user get-property \
  "org.mpris.MediaPlayer2.chromium.instance$pid" \
  /org/mpris/MediaPlayer2 \
  org.mpris.MediaPlayer2.Player Metadata
```

The service considers a duration valid only when it is positive and shorter than 24 hours. This filters Chromium's `INT64_MAX` duration while preserving normal tracks and long-form audio.

For affected HLS tracks, the underlying `<audio>` element reports `Infinity`, which Chromium converts to `INT64_MAX`. `extension/duration-bridge.js` runs in the Apple Music page's main world, matches Chromium's current Media Session title/artist against MusicKit's queue, reads the matched item's `attributes.durationInMillis`, and republishes it with `navigator.mediaSession.setPositionState()`. Matching matters because MusicKit's `currentItem` can briefly remain on the previous track; publishing that stale duration pins progress at the wrong endpoint. The bridge does nothing when the media element already has a finite duration. It requires no extension permissions and matches only `https://music.apple.com/*`.

## Bridge reconnection

`scripts/bridge-daemon` keeps trying to recover on its own; there is no need to restart the shell after the dedicated browser closes or its page target is replaced:

- On any CDP session error the daemon closes the dead WebSocket, emits `{"ok": false}` for that poll cycle, and re-reads `DevToolsActivePort` plus `/json/list` on the next poll (1s), so both full browser restarts and in-place page-target replacement (reload/navigation) recover automatically.
- Pending command files under `bridge-commands/` survive the disconnect and are retried on the new session, up to `MAX_COMMAND_ATTEMPTS` (3). A command whose page execution succeeded is deleted immediately and never re-applied; the retry cap bounds re-execution when the response is lost mid-flight.
- Diagnostics go to stderr only (one JSON state object per line on stdout), and a disconnect logs one `session dropped` line, not a stream of dead-socket errors.

To watch a reconnect live (one `session dropped` line, then recovery):

```bash
journalctl --user -f | grep -Ei 'apple-music|bridge-daemon'
```

## Launcher

```bash
scripts/apple-music open          # focus or launch
scripts/apple-music focus         # focus only
scripts/apple-music pid           # dedicated window PID
scripts/apple-music install       # install a desktop entry
scripts/apple-music is-installed  # test for the desktop entry
```

The dedicated profile lives in `~/.local/share/omarchy-apple-music/chromium-profile`.

## Release

1. Update `version` in `manifest.json`.
2. Run all validation commands.
3. Test closed, playing, paused, next/previous, artwork changes, Spotify simultaneously, and a normal Chromium media tab.
4. Tag the release as `v<version>`.
