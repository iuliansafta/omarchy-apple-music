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

if (typeof module !== "undefined") {
  module.exports = {
    playerPid: playerPid,
    selectPlayer: selectPlayer,
    validLength: validLength,
    boundedPosition: boundedPosition,
    progress: progress,
    formatTime: formatTime
  }
}
