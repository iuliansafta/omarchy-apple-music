# AGENTS.md

Omarchy bar plugin (Quickshell/QML + a Chromium extension). No `package.json`, no build step, no lint/typecheck — validation is a set of explicit commands.

## Validate before finishing

Run all four; all must pass:

```bash
omarchy plugin validate .          # manifest + plugin structure
bash -n scripts/apple-music        # launcher script syntax
node tests/model.test.js           # AppleMusicModel.js pure logic
node tests/duration-bridge.test.js # extension/duration-bridge.js pure logic
```

Tests are plain `node:test`/`assert` scripts — no runner config. Add a new pure function to `AppleMusicModel.js` or `extension/duration-bridge.js`? Add assertions to the matching test file.

## Dev setup & reload

```bash
ln -s "$PWD" ~/.config/omarchy/plugins/iuliansafta.apple-music
omarchy-shell shell rescanPlugins
omarchy plugin enable iuliansafta.apple-music center
```

Files stored directly under `~/.config/omarchy/plugins/` hot reload on save, but **filesystem events do not cross the dev symlink** — after editing source, restart the shell:

```bash
omarchy restart shell
```

Rescan only after changing `manifest.json` or adding the symlink: `omarchy-shell shell rescanPlugins`.

Inspect runtime state / errors:

```bash
omarchy-shell iuliansafta.apple-music status
journalctl --user --since "2 minutes ago" | grep -Ei 'apple-music|qml.*(error|warn)|ReferenceError|TypeError'
```

## Architecture that is not obvious from filenames

- `AppleMusicWidget.qml` (bar widget) → `AppleMusicService.qml` (service) → Quickshell `Mpris` → dedicated Chromium app → `extension/duration-bridge.js` (injected into `music.apple.com`).
- The service selects the MPRIS player whose D-Bus name ends in `.instance<PID>` where PID matches the dedicated Hyprland window. **It never falls back to the first Chromium player** — a normal YouTube tab must not be mistaken for Apple Music. Preserve this when editing `Model.selectPlayer`.
- `Mpris.players.values` is a QML sequence, not a JS `Array`. `Array.isArray()` is unreliable on it; `Model.selectPlayer` iterates by index. Don't "fix" it to use array methods.
- The Chromium profile is isolated at `~/.local/share/omarchy-apple-music/chromium-profile`, separate from the user's normal Chromium. `playerctl` is not required.
- Ratings and queue data bypass MPRIS: the extension exposes `window.__omarchyAppleMusic` on the page, and `scripts/bridge-daemon` (python3 stdlib, spawned by the service) relays state/commands over Chromium's DevTools protocol (the launcher passes `--remote-debugging-port=0`; the port comes from `DevToolsActivePort` in the profile dir). The service trusts bridge state only while its `trackTitle` matches MPRIS's, and sends commands as JSON files under `~/.local/share/omarchy-apple-music/bridge-commands/` that the daemon consumes.

## Bar widget conventions

- Widgets extend `BarWidget` (in `/usr/share/omarchy/shell/Ui/BarWidget.qml`), which injects `bar`, `moduleName`, `settings`. Read user-tunable values via `setting(key, fallback)`.
- Per-widget settings are declared in `manifest.json` under `barWidget.defaults` **and** `barWidget.schema`. Add a setting in both places or it won't surface in the Omarchy settings UI.
- **Slot collapse:** Omarchy's `Bar.qml` sizes a module slot to 0 width/height when its `activeItem.visible` is `false`. Bind the widget's `visible` to hide it without reserving bar space (used by `hideWhenNotRunning`).
- Popups use the shared `PopupCard` component; open state is owned by the widget via `popupOpen` + `open()`/`close()`/`toggle()`. Reset `popupOpen` if the widget can be hidden while open.

## HLS duration bridge gotcha

Some Apple Music HLS tracks report `Infinity` as the `<audio>` duration; Chromium converts that to `INT64_MAX` over MPRIS. `extension/duration-bridge.js` runs in the page main world on `https://music.apple.com/*`, matches Chromium's current Media Session title/artist against MusicKit's queue, and republishes `attributes.durationInMillis` via `navigator.mediaSession.setPositionState()`. Matching matters because `MusicKit.currentItem` can lag a track change — never publish a stale previous track's duration. `Model.validLength` rejects durations ≥ 24h as a safety fallback.

## Release

1. Bump `version` in `manifest.json`.
2. Run all four validation commands.
3. Manually test: closed, playing, paused, next/previous, artwork change, Spotify simultaneous, a normal Chromium media tab.
4. Tag `v<version>`.

No commit/PR conventions are documented; ask before committing or pushing.
