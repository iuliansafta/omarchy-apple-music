function playerPid(player) {
  var name = String(player && player.dbusName || "")
  var match = name.match(/\.instance(\d+)$/)
  return match ? Number(match[1]) : 0
}

function selectPlayer(players, browserPid) {
  var pid = Number(browserPid) || 0
  if (pid <= 0) return null

  var list = players || []
  for (var i = 0; i < list.length; i++) {
    if (playerPid(list[i]) === pid) return list[i]
  }
  return null
}

function validLength(length) {
  var seconds = Number(length)
  return isFinite(seconds) && seconds > 0 && seconds < 24 * 60 * 60
}

function boundedPosition(position, length) {
  var seconds = Math.max(0, Number(position) || 0)
  if (!validLength(length)) return seconds
  return Math.min(seconds, Number(length))
}

function progress(position, length) {
  if (!validLength(length)) return 0
  return boundedPosition(position, length) / Number(length)
}

function formatTime(seconds) {
  var value = Math.max(0, Math.floor(Number(seconds) || 0))
  var minutes = Math.floor(value / 60)
  var remainder = value % 60
  return minutes + ":" + (remainder < 10 ? "0" : "") + remainder
}

function sameTrack(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase() &&
    String(a || "").trim() !== ""
}

function bridgeIsActive(state, mprisTitle) {
  if (!state || state.ok !== true) return false
  return sameTrack(state.trackTitle, mprisTitle)
}

function upNextFromState(state) {
  return state && Array.isArray(state.upNext) ? state.upNext : []
}

function historyLogKey(title, artist) {
  return String(title || "").trim().toLowerCase() + "|" + String(artist || "").trim().toLowerCase()
}

function parseHistoryLines(text, cap) {
  var limit = Number(cap) || 0
  var lines = String(text || "").split("\n")
  var entries = []
  for (var i = lines.length - 1; i >= 0 && (!limit || entries.length < limit); i--) {
    var line = lines[i].trim()
    if (!line) continue
    try {
      var entry = JSON.parse(line)
      if (entry && typeof entry.title === "string" && entry.title.trim() !== "") {
        entries.push({
          ts: Number(entry.ts) || 0,
          title: String(entry.title),
          artist: String(entry.artist || ""),
          album: String(entry.album || ""),
          art: String(entry.art || "")
        })
      }
    } catch (_) {
      // A torn or foreign line is skipped, never fatal.
    }
  }
  return entries
}

function historyAppendBashScript() {
  return 'mkdir -p "$(dirname "$2")"; printf \'%s\\n\' "$1" >> "$2"; ' +
    'lines=$(wc -l < "$2"); ' +
    'if [ "$lines" -gt 500 ]; then tail -n 200 "$2" > "$2.tmp" && mv "$2.tmp" "$2"; fi'
}

if (typeof module !== "undefined") {
  module.exports = {
    playerPid: playerPid,
    selectPlayer: selectPlayer,
    validLength: validLength,
    boundedPosition: boundedPosition,
    progress: progress,
    formatTime: formatTime,
    sameTrack: sameTrack,
    bridgeIsActive: bridgeIsActive,
    upNextFromState: upNextFromState,
    historyLogKey: historyLogKey,
    parseHistoryLines: parseHistoryLines,
    historyAppendBashScript: historyAppendBashScript
  }
}
