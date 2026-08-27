import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Services.Mpris
import "AppleMusicModel.js" as Model

Item {
  id: root

  property var shell: null
  property int browserPid: 0
  property int positionRevision: 0

  // True when the dedicated Chromium Apple Music window is running. The
  // widget binds its visibility to this so a closed player does not reserve
  // bar space.
  readonly property bool running: browserPid > 0

  readonly property string launcherPath:
    Qt.resolvedUrl("scripts/apple-music").toString().replace(/^file:\/\//, "")
  readonly property var players: Mpris.players ? Mpris.players.values : []
  readonly property var activePlayer: Model.selectPlayer(players, browserPid)
  readonly property bool available: activePlayer !== null
  readonly property bool hasMedia: available && (title !== "" || artist !== "")
  readonly property bool playing: available && activePlayer.isPlaying
  readonly property string title: available ? (activePlayer.trackTitle || "") : ""
  readonly property string artist: available ? (activePlayer.trackArtist || "") : ""
  readonly property string album: available ? (activePlayer.trackAlbum || "") : ""
  readonly property string artUrl: available ? (activePlayer.trackArtUrl || "") : ""
  readonly property real position: {
    positionRevision
    return available && activePlayer.positionSupported
      ? Model.boundedPosition(activePlayer.position, trackLength) : 0
  }
  readonly property real trackLength: available ? Number(activePlayer.length) || 0 : 0
  readonly property bool hasValidLength: Model.validLength(trackLength)
  readonly property real progress: Model.progress(position, trackLength)
  readonly property bool canSeek: available && hasValidLength && activePlayer.canSeek
  readonly property string elapsedText: Model.formatTime(position)
  readonly property string lengthText: hasValidLength ? Model.formatTime(trackLength) : "--:--"

  function refreshBrowserPid() {
    if (!pidProcess.running) pidProcess.running = true
  }

  function openAppleMusic() {
    Quickshell.execDetached([launcherPath, "open"])
    delayedRefresh.restart()
  }

  function installLauncher() {
    Quickshell.execDetached([launcherPath, "install"])
  }

  function togglePlayback() {
    if (!available) {
      openAppleMusic()
      return
    }
    if (activePlayer.canTogglePlaying) activePlayer.togglePlaying()
    else if (activePlayer.isPlaying && activePlayer.canPause) activePlayer.pause()
    else if (activePlayer.canPlay) activePlayer.play()
  }

  function previous() {
    if (available && activePlayer.canGoPrevious) activePlayer.previous()
  }

  function next() {
    if (available && activePlayer.canGoNext) activePlayer.next()
  }

  function seekFraction(fraction) {
    if (!canSeek) return
    var bounded = Math.max(0, Math.min(1, Number(fraction) || 0))
    activePlayer.position = bounded * trackLength
    positionRevision += 1
  }

  Process {
    id: pidProcess
    command: [root.launcherPath, "pid"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.browserPid = parseInt(String(text || "").trim(), 10) || 0
    }
  }

  Timer {
    interval: 2000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refreshBrowserPid()
  }

  Timer {
    interval: 1000
    running: root.playing
    repeat: true
    onTriggered: root.positionRevision += 1
  }

  Timer {
    id: delayedRefresh
    interval: 1500
    repeat: false
    onTriggered: root.refreshBrowserPid()
  }

  IpcHandler {
    target: "iuliansafta.apple-music"

    function status(): string {
      return JSON.stringify({
        running: root.running,
        available: root.available,
        playing: root.playing,
        title: root.title,
        artist: root.artist,
        album: root.album,
        position: root.position,
        length: root.hasValidLength ? root.trackLength : null,
        canSeek: root.canSeek
      })
    }

    function open(): void { root.openAppleMusic() }
    function playPause(): void { root.togglePlayback() }
    function previous(): void { root.previous() }
    function next(): void { root.next() }
    function seek(fraction: real): void { root.seekFraction(fraction) }
  }
}
