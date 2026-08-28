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

  // Bridge state relayed by scripts/bridge-daemon: rating + queue context for
  // the current track. Only trusted while it names the track MPRIS reports.
  property var bridgeState: null
  property var recentTracks: []
  property string lastHistoryKey: ""
  property int commandSequence: 0
  // False until the persisted history file has been read once at startup;
  // the merge in loadHistoryFinished() keeps entries appended in the
  // meantime instead of letting the slower read overwrite them.
  property bool historyLoaded: false
  readonly property int recentCap: 30

  readonly property string dataRoot:
    (Quickshell.env("XDG_DATA_HOME") || Quickshell.env("HOME") + "/.local/share") + "/omarchy-apple-music"
  readonly property string profileDir: dataRoot + "/chromium-profile"
  readonly property string bridgeCommandsDir: dataRoot + "/bridge-commands"
  readonly property string historyPath: dataRoot + "/history.jsonl"
  readonly property string bridgeDaemonPath:
    Qt.resolvedUrl("scripts/bridge-daemon").toString().replace(/^file:\/\//, "")
  // Playback modes from the bridge (MusicKit is the single authoritative
  // source). null/"unknown" means the real state is unavailable — the UI
  // must never render that as a definite off.
  readonly property var shuffleMode:
    bridgeActive && bridgeState && typeof bridgeState.shuffle === "boolean"
    ? bridgeState.shuffle : null
  readonly property string repeatMode:
    bridgeActive && bridgeState && bridgeState.repeat ? String(bridgeState.repeat) : "unknown"
  readonly property var autoplay:
    bridgeActive && bridgeState && typeof bridgeState.autoplay === "boolean"
    ? bridgeState.autoplay : null
  readonly property string libraryState:
    bridgeActive && bridgeState && bridgeState.library ? String(bridgeState.library) : "unknown"

  readonly property bool bridgeActive: available && Model.bridgeIsActive(bridgeState, title)
  readonly property string rating:
    bridgeActive && bridgeState.rating ? String(bridgeState.rating) : "unknown"
  readonly property var upNext: bridgeActive ? Model.upNextFromState(bridgeState) : []

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
  readonly property string title: available
    ? Model.metadataText(activePlayer.trackTitle) : ""
  readonly property string artist: available
    ? Model.metadataText(activePlayer.trackArtist) : ""
  readonly property string album: available
    ? Model.metadataText(activePlayer.trackAlbum) : ""
  // Chromium republishes MPRIS metadata several times per track switch, each
  // time pointing mpris:artUrl at a new /tmp file and deleting the previous
  // one within ~600ms. Binding an Image directly to that churn loads files
  // that are already gone and flashes the artwork fallback. Adopt the URL
  // only once it stops changing, so only the surviving final file is used.
  readonly property string rawArtUrl: available
    ? Model.artworkUrl(activePlayer.trackArtUrl) : ""
  property string artUrl: ""
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

  function sendBridgeCommand(command) {
    if (!bridgeActive) return
    commandSequence += 1
    bridgeCommandProc.command = [
      "python3", "-c", Model.commandWritePythonScript(),
      JSON.stringify(command), bridgeCommandsDir + "/cmd-" + commandSequence + ".json"
    ]
    bridgeCommandProc.running = true
  }

  function rate(value) {
    sendBridgeCommand({ action: "rate", value: Number(value) })
  }

  function toggleLike() {
    rate(rating === "like" ? 0 : 1)
  }

  function toggleDislike() {
    rate(rating === "dislike" ? 0 : -1)
  }

  function setShuffle(enabled) {
    sendBridgeCommand({ action: "set-shuffle", enabled: !!enabled })
  }

  // Cycles Off → Repeat All → Repeat One → Off using the normalized string
  // state, never numeric enum ordering. An unknown state simply starts the
  // cycle at its beginning ("all" comes first after Off).
  function cycleRepeat() {
    var next = repeatMode === "all" ? "one" : repeatMode === "one" ? "none" : "all"
    sendBridgeCommand({ action: "set-repeat", mode: next })
  }

  function setAutoplay(enabled) {
    sendBridgeCommand({ action: "set-autoplay", enabled: !!enabled })
  }

  function jumpToQueueIndex(index) {
    sendBridgeCommand({ action: "jump", index: Number(index) || 0 })
  }

  function addToLibrary() {
    sendBridgeCommand({ action: "add-to-library" })
  }

  function appendHistory() {
    if (!hasMedia) return
    var key = Model.historyLogKey(title, artist)
    if (key === lastHistoryKey) return
    lastHistoryKey = key
    var entry = {
      ts: Date.now(),
      title: Model.metadataText(title),
      artist: Model.metadataText(artist),
      album: Model.metadataText(album),
      art: Model.artworkUrl(artUrl),
      // Exact-song descriptor from the matched MusicKit item; null (kept
      // non-replayable) while the bridge is not actively matching MPRIS.
      play: Model.historyPlaybackDescriptor(
        bridgeActive && bridgeState ? bridgeState.play : null)
    }
    var payload = JSON.stringify(entry)
    // Keep the process argument bounded in QML; the helper repeats this check
    // as defense in depth, after the process boundary.
    if (payload.length > 65536) return
    recentTracks = Model.uniqueHistoryEntries([entry].concat(recentTracks), recentCap)
    historyAppendProc.command = [
      "python3", "-c", Model.historyAppendPythonScript(), payload, historyPath
    ]
    historyAppendProc.running = true
  }

  // Replays an exact song from a history record via the bridge. Old records
  // without a descriptor stay passive (the widget focuses Apple Music).
  function replayTrack(entry) {
    if (!bridgeActive || !entry || !entry.play) return
    sendBridgeCommand({ action: "play-descriptor", descriptor: entry.play })
  }

  // One-shot load of history.jsonl at service startup. A missing, empty, or
  // unreadable file yields empty output and an empty history — never a
  // per-poll warning. Text → entries stays in Model.parseHistoryLines.
  function loadHistoryFinished(text) {
    // Newest in-memory entries (created while the startup read was in
    // flight) win. The model then keeps only the latest occurrence of each
    // song, including legacy records without a playback descriptor.
    recentTracks = Model.uniqueHistoryEntries(
      recentTracks.concat(Model.parseHistoryLines(text, 0)), recentCap)
    historyLoaded = true
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

  // MPRIS title/artist can land a tick apart; the debounce lets both settle
  // before the entry is written, and lastHistoryKey collapses the result.
  onTitleChanged: historyLogTimer.restart()

  onRawArtUrlChanged: {
    if (rawArtUrl === "") {
      artSettleTimer.stop()
      artUrl = ""
    } else {
      artSettleTimer.restart()
    }
  }

  Timer {
    id: artSettleTimer
    interval: 600
    repeat: false
    onTriggered: root.artUrl = root.rawArtUrl
  }

  Timer {
    id: delayedRefresh
    interval: 1500
    repeat: false
    onTriggered: root.refreshBrowserPid()
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
    id: historyLogTimer
    interval: 1200
    repeat: false
    onTriggered: root.appendHistory()
  }

  Process {
    id: bridgeDaemon
    command: ["python3", root.bridgeDaemonPath, root.profileDir, root.bridgeCommandsDir]
    running: true
    onExited: function(exitCode, exitStatus) {
      console.warn("iuliansafta.apple-music bridge-daemon exited:", exitCode, exitStatus)
    }
    onStarted: console.log("iuliansafta.apple-music bridge-daemon started")
    stdout: SplitParser {
      onRead: function(line) {
        var text = String(line || "")
        // The daemon caps its own output; treat anything larger as a broken
        // or substituted daemon rather than feeding it to JSON.parse.
        if (text.length > 2097152) {
          root.bridgeState = null
          return
        }
        try {
          root.bridgeState = JSON.parse(text)
        } catch (_) {
          root.bridgeState = null
        }
      }
    }
    stderr: SplitParser {
      onRead: function(line) {
        console.warn("iuliansafta.apple-music bridge-daemon:", String(line || "").trim())
      }
    }
  }
  Process {
    id: historyLoadProc
    command: ["python3", "-c", Model.historyLoadPythonScript(), root.historyPath]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.loadHistoryFinished(String(text || ""))
    }
  }

  Component.onCompleted: historyLoadProc.running = true

  Process { id: bridgeCommandProc }
  Process { id: historyAppendProc }
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
        canSeek: root.canSeek,
        rating: root.rating,
        shuffle: root.shuffleMode,
        repeat: root.repeatMode,
        autoplay: root.autoplay,
        library: root.libraryState,
        bridgeActive: root.bridgeActive,
        upNext: root.upNext,
        recentTracks: root.recentTracks
      })
    }

    function open(): void { root.openAppleMusic() }
    function playPause(): void { root.togglePlayback() }
    function previous(): void { root.previous() }
    function next(): void { root.next() }
    function seek(fraction: real): void { root.seekFraction(fraction) }
    function setRating(value: int): void { root.rate(value) }
    function like(): void { root.toggleLike() }
    function dislike(): void { root.toggleDislike() }
    function setShuffle(enabled: bool): void { root.setShuffle(enabled) }
    function cycleRepeat(): void { root.cycleRepeat() }
    function setAutoplay(enabled: bool): void { root.setAutoplay(enabled) }
    function addToLibrary(): void { root.addToLibrary() }
    function jumpTo(index: int): void { root.jumpToQueueIndex(index) }
  }
}
