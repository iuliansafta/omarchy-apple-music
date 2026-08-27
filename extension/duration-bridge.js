function appleMusicDurationSeconds(item) {
  var milliseconds = Number(item && item.attributes && item.attributes.durationInMillis)
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds / 1000 : 0
}

function bridgedPosition(currentTime, duration) {
  var position = Math.max(0, Number(currentTime) || 0)
  return Math.min(position, Math.max(0, duration - 0.001))
}

function normalized(value) {
  return String(value || "").trim().toLowerCase()
}

function itemMatchesMetadata(item, metadata) {
  var attributes = item && item.attributes
  if (!attributes || !metadata) return false

  var title = normalized(metadata.title)
  var artist = normalized(metadata.artist)
  if (!title || normalized(attributes.name) !== title) return false
  return !artist || normalized(attributes.artistName) === artist
}

function musicKitItemForMetadata(queue, metadata) {
  if (!queue) return null
  if (itemMatchesMetadata(queue.currentItem, metadata)) return queue.currentItem

  var queueItems = Array.isArray(queue._queueItems) ? queue._queueItems : []
  for (var i = 0; i < queueItems.length; i++) {
    var item = queueItems[i] && (queueItems[i].item || queueItems[i])
    if (itemMatchesMetadata(item, metadata)) return item
  }
  return null
}

function needsDurationBridge(mediaDuration) {
  var duration = Number(mediaDuration)
  return !Number.isFinite(duration) || duration <= 0
}

function activeAudio() {
  var audio = Array.from(document.querySelectorAll("audio"))
  for (var i = 0; i < audio.length; i++) if (!audio[i].paused) return audio[i]
  return audio.length > 0 ? audio[0] : null
}

function bridgeAppleMusicDuration() {
  try {
    var music = window.MusicKit && window.MusicKit.getInstance
      ? window.MusicKit.getInstance() : null
    var controller = music && music._playbackController
    var queue = controller && controller._queue
    var mediaSession = navigator.mediaSession
    var item = musicKitItemForMetadata(queue, mediaSession && mediaSession.metadata)
    var duration = appleMusicDurationSeconds(item)
    var audio = activeAudio()

    if (!audio || duration <= 0 || !needsDurationBridge(audio.duration)) return false
    if (!mediaSession || typeof mediaSession.setPositionState !== "function") return false

    mediaSession.setPositionState({
      duration: duration,
      position: bridgedPosition(audio.currentTime, duration),
      playbackRate: Number(audio.playbackRate) || 1
    })
    return true
  } catch (_) {
    // Apple Music can replace its player and queue while changing tracks.
    // The next interval retries after that transient state settles.
    return false
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  setInterval(bridgeAppleMusicDuration, 1000)
  document.addEventListener("visibilitychange", bridgeAppleMusicDuration)
  window.addEventListener("pageshow", bridgeAppleMusicDuration)
}

if (typeof module !== "undefined") {
  module.exports = {
    appleMusicDurationSeconds: appleMusicDurationSeconds,
    bridgedPosition: bridgedPosition,
    itemMatchesMetadata: itemMatchesMetadata,
    musicKitItemForMetadata: musicKitItemForMetadata,
    needsDurationBridge: needsDurationBridge
  }
}
