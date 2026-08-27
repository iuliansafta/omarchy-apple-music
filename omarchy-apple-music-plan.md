# Omarchy 4.0 Apple Music Plugin — Implementation Plan

## Goal

Build a native-feeling Apple Music integration for **Omarchy 4.0** that uses the official Apple Music web player for authentication and playback, while exposing playback information and controls through an Omarchy shell plugin.

The first version should avoid implementing a full Apple Music client or dealing directly with MusicKit authentication/DRM.

---

## Proposed Architecture

```text
                    Omarchy 4.0
                        │
             ┌──────────▼──────────┐
             │ Apple Music Plugin  │
             │   Quickshell / QML  │
             └──────────┬──────────┘
                        │
                     MPRIS
                        │
              ┌─────────▼─────────┐
              │ Chromium Web App │
              │ music.apple.com  │
              └─────────┬─────────┘
                        │
                   Apple Music
```

The plugin should use:

- **Omarchy / Quickshell / QML** for UI
- **MPRIS over D-Bus** for playback metadata and controls
- **Apple Music Web** for authentication, DRM, library access, streaming, and playback
- Chromium's `--app` mode or Omarchy's existing web-app mechanism to make Apple Music feel like a native application

---

# Phase 0 — Research and Prototype

## Objectives

Confirm how Apple Music behaves on Linux and how Omarchy 4.0 exposes shell-plugin APIs.

## Tasks

- [ ] Create a minimal Omarchy 4.0 shell plugin
- [ ] Verify plugin hot reload during development
- [ ] Identify the recommended Omarchy plugin directories and manifest schema
- [ ] Open `https://music.apple.com` as an Omarchy web app
- [ ] Log into Apple Music
- [ ] Start playback
- [ ] Inspect available MPRIS players

Useful commands:

```bash
playerctl -l
```

and:

```bash
playerctl metadata
```

Check whether Chromium exposes:

- track title
- artist
- album
- artwork URL
- playback state
- track length
- playback position

## Success Criteria

Running Apple Music in the browser/web-app produces an MPRIS-compatible player that can be controlled from Linux.

---

# Phase 1 — Repository Structure

Create the initial repository:

```text
omarchy-apple-music/
├── manifest.json
├── README.md
├── LICENSE
├── qml/
│   ├── AppleMusicWidget.qml
│   ├── AppleMusicPanel.qml
│   └── AppleMusicService.qml
├── scripts/
│   ├── launch-apple-music
│   └── install-webapp
├── assets/
│   └── apple-music.svg
└── docs/
    └── DEVELOPMENT.md
```

Keep UI, playback state, and launcher behavior separate.

---

# Phase 2 — Minimal MVP

## Goal

Ship the smallest useful Apple Music plugin.

## Features

The MVP should provide:

- Apple Music icon in the Omarchy bar
- click action to launch Apple Music
- detection of whether Apple Music is already running
- current playback state
- play/pause control
- current track title
- current artist

Example:

```text
  Digital Bath — Deftones   ▶
```

## Tasks

- [ ] Implement `manifest.json`
- [ ] Implement `AppleMusicWidget.qml`
- [ ] Implement Apple Music launcher
- [ ] Detect Chromium/Apple Music player via MPRIS
- [ ] Expose basic playback metadata
- [ ] Implement play/pause
- [ ] Hide metadata when nothing is playing
- [ ] Test plugin reload workflow

## Success Criteria

The user can:

1. install the plugin
2. launch Apple Music
3. play music
4. see the current track in Omarchy
5. pause/resume playback from the Omarchy bar

---

# Phase 3 — Playback Service

Create a dedicated service responsible for MPRIS interaction.

## `AppleMusicService.qml`

Responsibilities:

- discover available MPRIS players
- identify the player associated with Apple Music
- expose current player state
- normalize metadata
- expose playback actions

Suggested properties:

```text
available
playing
title
artist
album
artUrl
position
length
volume
```

Suggested actions:

```text
play()
pause()
togglePlayback()
next()
previous()
seek()
openAppleMusic()
```

The UI should never need to know the low-level D-Bus/MPRIS implementation.

---

# Phase 4 — Apple Music Player Detection

Browser MPRIS identities may not always be clean or stable.

Create detection logic based on some combination of:

- MPRIS player identity
- Chromium application identity
- metadata URLs containing `music.apple.com`
- track/player metadata
- browser profile
- launch command used by the plugin

Prefer deterministic identification over simply selecting the first Chromium media session.

## Edge Cases

Test:

- YouTube playing at the same time
- Spotify open simultaneously
- multiple Chromium windows
- Apple Music paused
- browser restarted
- Apple Music tab closed

---

# Phase 5 — Player Panel

Add a richer panel opened by clicking the bar widget.

Example:

```text
╭──────────────────────────────╮
│                              │
│        [ Album Art ]         │
│                              │
│        Digital Bath          │
│        Deftones              │
│        White Pony            │
│                              │
│         ◀   ❚❚   ▶           │
│                              │
│    ━━━━━━━━━●━━━━━━━━        │
│     02:31       04:15        │
│                              │
│      Open Apple Music        │
╰──────────────────────────────╯
```

## Features

- album artwork
- title
- artist
- album
- previous
- play/pause
- next
- progress bar
- elapsed time
- total duration
- launch/focus Apple Music button

Optional:

- volume slider
- mute
- repeat indicator
- shuffle indicator

---

# Phase 6 — Artwork

Try to obtain artwork directly from MPRIS metadata.

Possible source:

```text
mpris:artUrl
```

## Requirements

- handle HTTP/HTTPS artwork
- cache artwork locally if needed
- provide placeholder artwork
- avoid blocking the shell while downloading artwork
- handle artwork changing rapidly between tracks

---

# Phase 7 — Apple Music Web App Integration

The plugin should make installation easy.

Desired behavior:

```text
Apple Music is not installed.

[ Install Apple Music ]
```

Possible implementation:

1. detect whether the Apple Music web app exists
2. offer installation
3. create/launch the Omarchy web app pointing to:

```text
https://music.apple.com
```

Prefer using Omarchy's existing web-app infrastructure rather than maintaining a custom Chromium configuration.

---

# Phase 8 — Window Focus / Launch Behavior

Clicking the plugin should:

1. focus Apple Music if already open
2. launch Apple Music if not open

This may require integration with:

- Niri
- Omarchy shell helpers
- app/window IDs
- Chromium's app mode

Avoid spawning duplicate Apple Music windows.

---

# Phase 9 — Configuration

Add lightweight plugin configuration.

Possible options:

```text
showArtist = true
showTitle = true
showArtwork = true
compactMode = false
scrollLongTitles = true
preferredPlayer = "apple-music"
```

Later:

```text
widgetStyle = "compact"
panelArtworkSize = 220
showProgressInBar = false
```

Keep defaults aligned with Omarchy's visual style.

---

# Phase 10 — Error States

The plugin should gracefully handle:

### Apple Music not installed

```text
Apple Music
Not installed
```

### Installed but closed

```text
 Music
```

### Open but nothing playing

```text
 Apple Music
```

### Playing

```text
 Deftones — Digital Bath  ❚❚
```

### MPRIS unavailable

Do not crash or spam notifications.

---

# Phase 11 — Packaging

Target installation flow:

```bash
omarchy plugin add https://github.com/<username>/omarchy-apple-music.git --enable
```

Repository should contain:

- valid Omarchy plugin manifest
- README
- screenshots
- installation instructions
- troubleshooting section
- license
- compatibility requirements

---

# Phase 12 — Testing Matrix

Test at least:

| Scenario | Expected Result |
|---|---|
| Apple Music closed | launcher works |
| Apple Music open | window is focused |
| Track playing | metadata displayed |
| Track paused | pause state displayed |
| Next track | metadata updates |
| Previous track | metadata updates |
| Artwork changes | panel updates |
| YouTube also playing | Apple Music is selected |
| Spotify also running | Apple Music is selected |
| Chromium restarted | plugin reconnects |
| Omarchy shell restarted | state recovers |
| Network offline | plugin remains stable |

---

# Phase 13 — README and Developer Documentation

README should explain:

- what the plugin does
- screenshots
- requirements
- install command
- removal command
- known limitations
- supported Omarchy versions

`docs/DEVELOPMENT.md` should cover:

- development setup
- plugin directory
- hot reload workflow
- MPRIS debugging
- useful `playerctl` commands
- QML debugging
- release process

---

# Phase 14 — Release v0.1.0

## Scope

Version `0.1.0` should include only:

- Apple Music launcher
- Apple Music player detection
- track title
- artist
- play/pause
- next/previous
- basic panel
- album artwork if MPRIS exposes it reliably

Do **not** block the first release on:

- Apple Music API
- MusicKit
- playlists
- search
- lyrics
- library browsing
- queue management

---

# Phase 15 — Release v0.2.0

Potential improvements:

- progress bar
- seeking
- better artwork handling
- volume
- automatic web-app installation
- better window focusing
- configuration
- theme integration

---

# Phase 16 — Future: Native Apple Music Features

Only investigate MusicKit after the MPRIS-based plugin is mature.

Potential features:

- Apple Music search
- playlists
- library browsing
- recently played
- favorites
- queue management
- recommendations

Possible architecture:

```text
Omarchy Plugin
      │
      ├── MPRIS ─────────────► Playback
      │
      └── MusicKit/API ──────► Library / Search / Metadata
```

This hybrid model would allow the official web player to remain responsible for DRM playback while MusicKit provides deeper Apple Music functionality.

---

# Recommended Milestones

## Milestone 1 — Proof of Concept

```text
Apple Music Web App
        ↓
      MPRIS
        ↓
   playerctl
```

Confirm the Linux media integration works.

---

## Milestone 2 — Omarchy Widget

```text
 Artist — Track  ▶
```

Basic QML widget reading MPRIS.

---

## Milestone 3 — Playback Controls

```text
Previous | Play/Pause | Next
```

---

## Milestone 4 — Full Panel

Album artwork, track metadata, controls, and progress.

---

## Milestone 5 — Installer Experience

Plugin automatically detects and launches the Apple Music web app.

---

## Milestone 6 — Public Release

Publish:

```text
omarchy-apple-music v0.1.0
```

and submit it to the Omarchy plugin ecosystem.

---

# Recommended Technical Strategy

Start with:

```text
Omarchy / QML
      +
MPRIS / D-Bus
      +
Apple Music Web
```

Avoid starting with:

```text
MusicKit
Apple authentication
Apple Music API
Custom playback engine
DRM handling
```

The goal of the first release is not to recreate Apple Music.

The goal is to make **Apple Music feel like a first-class Omarchy application**.

---

# Immediate Next Steps

- [ ] Create GitHub repository `omarchy-apple-music`
- [ ] Create minimal Omarchy plugin manifest
- [ ] Install Apple Music as an Omarchy web app
- [ ] Verify Apple Music MPRIS metadata with `playerctl`
- [ ] Build `AppleMusicService.qml`
- [ ] Build minimal bar widget
- [ ] Add play/pause
- [ ] Add next/previous
- [ ] Add player panel
- [ ] Add album artwork
- [ ] Package v0.1.0
- [ ] Publish plugin
