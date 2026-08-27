# Omarchy Apple Music

Apple Music Web as a first-class [Omarchy 4.0](https://omarchy.org/) bar widget.

The plugin keeps authentication, DRM, library access, and playback in the official Apple Music web player. It uses Quickshell's native MPRIS integration for now-playing information and controls.

## Features

- Dedicated Chromium app/profile for reliable Apple Music detection
- Hides itself from the bar when Apple Music is not running
- Launch or focus Apple Music from the bar
- Track title, artist, album, and artwork
- Previous, play/pause, and next controls
- Elapsed time
- Progress and seeking, including HLS tracks whose duration Chromium normally loses
- Coexists with Spotify and other MPRIS players

## Requirements

- Omarchy 4.0
- Chromium
- An Apple Music subscription

`playerctl` is not required.

## Install

```bash
omarchy plugin add https://github.com/iuliansafta/omarchy-apple-music.git --enable
```

Add the widget to the bar if your Omarchy version does not place it automatically:

```bash
omarchy plugin enable iuliansafta.apple-music center
```

Click the Apple Music widget to launch the dedicated web app, then sign in. This profile is intentionally separate from the normal Chromium profile so Apple Music has its own MPRIS player.

By default the widget hides itself when Apple Music is not running, so on a fresh install it is not visible in the bar until the app is launched once. Start it with either of:

```bash
~/.config/omarchy/plugins/iuliansafta.apple-music/scripts/apple-music open
omarchy-shell iuliansafta.apple-music open
```

After the window opens the widget appears automatically (within a couple of seconds). To keep the widget reserved in the bar even when Apple Music is closed, set `hideWhenNotRunning` to `false` in the widget's shell.json entry or via Omarchy's settings UI.

To also add Apple Music to the application launcher:

```bash
~/.config/omarchy/plugins/iuliansafta.apple-music/scripts/apple-music install
```

## Controls

- Click while closed: launch/focus Apple Music
- Click while connected: open the player panel
- Middle-click: play/pause
- Scroll up/down: previous/next

## Progress handling

Some Apple Music HLS tracks expose `Infinity` as the HTML audio duration even though MusicKit's queue contains the real catalog duration. Chromium converts that infinity to the maximum signed 64-bit MPRIS value.

The plugin bundles a minimal extension, restricted to `https://music.apple.com/*`, that republishes MusicKit's `durationInMillis` through the standard Media Session API. This restores MPRIS progress and seeking. It uses Apple Music's private MusicKit queue object, so a future Apple Music Web update may require an adjustment. Invalid values still fall back safely to elapsed time with `--:--`.

## Remove

```bash
omarchy plugin remove iuliansafta.apple-music
```

The isolated browser profile remains at:

```text
~/.local/share/omarchy-apple-music/chromium-profile
```

Remove it manually only if you also want to delete its Apple Music login and browser data.

## Development

See [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## License

[MIT](LICENSE)
