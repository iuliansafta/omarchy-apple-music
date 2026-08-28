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

// ---------------------------------------------------------------------------
// Now Playing+: queue/rating state for the bar and commands from the bar.
// Transport is the bridge daemon (scripts/bridge-daemon), which evaluates
// collect()/command() over Chromium's DevTools protocol and relays JSON.
// ---------------------------------------------------------------------------

function playParamsOf(item) {
  return (item && item.attributes && item.attributes.playParams) || null
}

function playableId(item) {
  return String((playParamsOf(item) && playParamsOf(item).id) || "")
}

// Ratings live at /v1/me/ratings/{songs|library-songs}/{id}; the kind must
// match where the id points (library ids start with "i.").
function ratingKind(item) {
  var kind = String((playParamsOf(item) && playParamsOf(item).kind) || "songs")
  return kind === "library-songs" ? "library-songs" : "songs"
}

function ratingStateForValue(value) {
  var number = Number(value)
  if (number === 1) return "like"
  if (number === -1) return "dislike"
  if (number === 0) return "none"
  return "unknown"
}

// Playback modes (shuffle/repeat/autoplay). Verified against the live web
// player (MusicKit JS 3.2632.1): shuffleMode and repeatMode are writable
// numeric prototype accessors on the instance (0 = none, 1 = songs/one,
// 2 = albums/all; the setter clamps shuffle 2 back to 1), autoplayEnabled is
// a boolean. No public enums are exposed in this build, so the mapping is
// pinned here and every read is normalized before the UI sees it.
var REPEAT_MODES = { none: 0, one: 1, all: 2 }

function normalizeShuffle(value) {
  if (typeof value === "boolean") return value
  if (typeof value === "number" && (value === 0 || value === 1 || value === 2)) {
    return value !== 0
  }
  return null
}

function normalizeRepeat(value) {
  if (typeof value === "string") {
    var key = value.trim().toLowerCase()
    return REPEAT_MODES.hasOwnProperty(key) ? key : "unknown"
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    for (var mode in REPEAT_MODES) {
      if (REPEAT_MODES[mode] === value) return mode
    }
  }
  return "unknown"
}

function normalizeAutoplay(value) {
  return typeof value === "boolean" ? value : null
}


// ---------------------------------------------------------------------------
// Replay descriptors: stable primitive fields identifying the current MusicKit
// item, stored in history records and round-tripped through the play command.
// Verified against the live web player (MusicKit JS 3.2632.1):
// setQueue({songs:[id], startPlaying:true}) accepts catalog ids and library
// "i." ids; library items carry attributes.playParams.catalogId pointing at
// the catalog twin, which is preferred for replay (catalog playback gives
// full-quality streaming and normal continuation behavior).
var DESCRIPTOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

function playbackDescriptorOf(item) {
  var params = playParamsOf(item)
  var id = params && params.id ? String(params.id) : ""
  if (!id || !DESCRIPTOR_ID_PATTERN.test(id)) return null
  var descriptor = { kind: "song", id: id }
  var catalogId = params.catalogId ? String(params.catalogId) : ""
  if (catalogId && DESCRIPTOR_ID_PATTERN.test(catalogId)) {
    descriptor.catalogId = catalogId
  }
  return descriptor
}

// Command-boundary validation: only fully-formed descriptors reach the
// player, and unknown fields are dropped rather than passed through.
function validPlaybackDescriptor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  var id = typeof value.id === "string" ? value.id : ""
  if (!id || !DESCRIPTOR_ID_PATTERN.test(id)) return null
  if (typeof value.kind !== "undefined" && value.kind !== "song") return null
  var descriptor = { kind: "song", id: id }
  var catalogId = typeof value.catalogId === "string" ? value.catalogId : ""
  if (catalogId) {
    if (!DESCRIPTOR_ID_PATTERN.test(catalogId)) return null
    descriptor.catalogId = catalogId
  }
  return descriptor
}

// Replaces playback with the exact song (never title/artist matching) and
// lets Apple Music establish its normal continuation behavior.
function playDescriptor(music, descriptor) {
  if (typeof music.setQueue !== "function") {
    return Promise.resolve({ ok: false, error: "no-queue-api" })
  }
  var songId = descriptor.catalogId || descriptor.id
  return music.setQueue({ songs: [songId], startPlaying: true })
    .then(function() { return { ok: true } })
    .catch(function() { return { ok: false, error: "play-failed" } })
}

function normalizeQueueEntry(item, index) {
  var attributes = item && item.attributes
  if (!attributes || !attributes.name) return null
  var durationMillis = Number(attributes.durationInMillis)
  return {
    index: index,
    id: playableId(item),
    title: String(attributes.name || ""),
    artist: String(attributes.artistName || ""),
    durationSeconds: durationMillis > 0 ? durationMillis / 1000 : 0
  }
}

// ---------------------------------------------------------------------------
// Library membership. Endpoints verified against the live API from the page
// context (tokens MusicKit already holds):
// - membership: GET /v1/me/library/search?term=<song name>&types=library-songs
//   then match playParams.catalogId exactly against the catalog id (the
//   text only narrows candidates; the match is by stable id — filter[track_id]
//   is rejected with 400 by the API).
// - add: POST /v1/me/library?ids[songs]=<catalog id> → 202 Accepted, applied
//   asynchronously; success is only claimed once membership flips to present
//   within a bounded number of confirmation polls.
// - DELETE is CORS-blocked from the web origin, so this is add-only.
var LIBRARY_CONFIRM_POLLS = 5

var libraryCache = { id: "", state: "unknown" }
var libraryConfirm = 0

// Library items appear both as kind "library-songs" (queue items) and as
// kind "song" with isLibrary: true and an "i."-prefixed id (live API
// responses), so all three markers are checked.
function isLibraryItem(item) {
  if (ratingKind(item) === "library-songs") return true
  var params = playParamsOf(item)
  if (params && params.isLibrary === true) return true
  return playableId(item).indexOf("i.") === 0
}

function librarySearchUrl(item) {
  return "https://api.music.apple.com/v1/me/library/search?term=" +
    encodeURIComponent(item && item.attributes && item.attributes.name || "") +
    "&types=library-songs&limit=10"
}

function libraryAddUrl(item) {
  return "https://api.music.apple.com/v1/me/library?ids%5Bsongs%5D=" +
    encodeURIComponent(playableId(item))
}

function libraryHits(data, catalogId) {
  var section = data && data.results && data.results["library-songs"]
  var items = section && section.data ? section.data : []
  return items.filter(function(song) {
    var params = song.attributes && song.attributes.playParams
    return params && String(params.catalogId || "") === catalogId
  })
}

function queryLibraryMembership(music, item, id, onResult) {
  var controller = new AbortController()
  var timer = setTimeout(function() { controller.abort() }, 3000)
  fetch(librarySearchUrl(item), { headers: authHeaders(music), signal: controller.signal })
    .then(function(response) { return response.ok ? response.json() : null })
    .then(function(data) {
      if (libraryCache.id === id) onResult(libraryHits(data, id).length > 0)
    })
    .catch(function() {
      if (libraryCache.id === id) onResult(null)  // lookup failed, not absent
    })
    .then(function() { clearTimeout(timer) })
}

// Library lookups run once per track id, like ratings; collect() reports the
// cached state and never awaits the fetch. Library-kind items are trivially
// present. After a 202 add, bounded confirmation polls flip adding → present
// (or unknown when unconfirmed); every async completion is guarded by the
// cache id so a track change can never adopt another song's result.
function refreshLibraryCache(music, item) {
  var id = playableId(item)
  if (!id) {
    libraryCache = { id: "", state: "unknown" }
    libraryConfirm = 0
    return
  }
  if (libraryCache.id === id) {
    if (libraryCache.state === "adding" && libraryConfirm > 0) {
      libraryConfirm -= 1
      var remaining = libraryConfirm
      queryLibraryMembership(music, item, id, function(present) {
        if (libraryCache.id !== id || libraryCache.state !== "adding") return
        if (present) { libraryCache.state = "present"; return }
        if (remaining === 0) libraryCache.state = "unknown"
      })
    }
    return
  }
  libraryCache = { id: id, state: "unknown" }
  libraryConfirm = 0
  if (isLibraryItem(item)) {
    libraryCache.state = "present"
    return
  }
  queryLibraryMembership(music, item, id, function(present) {
    if (libraryCache.id !== id || libraryCache.state === "adding") return
    libraryCache.state = present === null ? "unknown" : present ? "present" : "absent"
  })
}

// Add the current (catalog) song to the library. Idempotency guards: no-op
// while a request for the same track is in flight, and an already-present
// track reports success without a write.
function addToLibrary(music, item) {
  var id = playableId(item)
  if (!id) return Promise.resolve({ ok: false, error: "no-track" })
  if (isLibraryItem(item)) {
    return Promise.resolve({ ok: true, state: "present" })
  }
  if (libraryCache.id === id && libraryCache.state === "adding") {
    return Promise.resolve({ ok: false, error: "in-progress" })
  }
  if (libraryCache.id === id && libraryCache.state === "present") {
    return Promise.resolve({ ok: true, state: "present" })
  }
  libraryCache = { id: id, state: "adding" }
  libraryConfirm = LIBRARY_CONFIRM_POLLS
  var controller = new AbortController()
  var timer = setTimeout(function() { controller.abort() }, 5000)
  return fetch(libraryAddUrl(item), { method: "POST", headers: authHeaders(music), signal: controller.signal })
    .then(function(response) {
      if (!response.ok) {
        if (libraryCache.id === id) { libraryCache.state = "error"; libraryConfirm = 0 }
        return { ok: false, error: "http-" + response.status }
      }
      // 202 Accepted: membership confirmations drive the final state.
      return { ok: true, state: "adding" }
    })
    .catch(function() {
      if (libraryCache.id === id) { libraryCache.state = "error"; libraryConfirm = 0 }
      return { ok: false, error: "network" }
    })
    .then(function(result) { clearTimeout(timer); return result })
}

var ratingCache = { id: "", state: "unknown" }

// {items, position} for the live queue. Prefers the public MusicKit.Queue
// (items + position); falls back to the private playback controller queue the
// duration bridge already relies on, locating the current item by identity.
function queueContext(music) {
  var publicQueue = music && music.player && music.player.queue
  var publicPosition = publicQueue ? Number(publicQueue.position) : NaN
  if (publicQueue && Array.isArray(publicQueue.items) &&
      publicQueue.position !== null && Number.isFinite(publicPosition)) {
    return { items: publicQueue.items, position: publicPosition }
  }

  var privateQueue = music && music._playbackController && music._playbackController._queue
  if (!privateQueue) return null

  var wrapped = Array.isArray(privateQueue._queueItems) ? privateQueue._queueItems : []
  var items = []
  for (var i = 0; i < wrapped.length; i++) items.push(wrapped[i] && (wrapped[i].item || wrapped[i]))

  var position = -1
  for (var j = 0; j < items.length; j++) {
    if (items[j] && items[j] === privateQueue.currentItem) { position = j; break }
  }
  return { items: items, position: position }
}

// First `max` entries after the currently playing item, each carrying its
// absolute queue index so jump-to-track survives the trim.
function upNextEntries(items, position, max) {
  var entries = []
  var start = Math.max(0, Number(position) || 0) + 1
  var limit = Number(max) || 20
  for (var i = start; i < items.length && entries.length < limit; i++) {
    var entry = normalizeQueueEntry(items[i], i)
    if (entry) entries.push(entry)
  }
  return entries
}

var ratingCache = { id: "", state: "unknown" }

function ratingsUrl(item) {
  return "https://api.music.apple.com/v1/me/ratings/" +
    ratingKind(item) + "/" + encodeURIComponent(playableId(item))
}

function authHeaders(music) {
  return {
    "Authorization": "Bearer " + music.developerToken,
    "Music-User-Token": music.musicUserToken,
    "Content-Type": "application/json"
  }
}

// Rating lookups only run on track change: one GET per id, cached until the
// id changes. collect() reports the cached state and never awaits the fetch.
function refreshRatingCache(music, item) {
  var id = playableId(item)
  if (!id) { ratingCache = { id: "", state: "unknown" }; return }
  if (ratingCache.id === id) return
  ratingCache = { id: id, state: "unknown" }

  var cacheId = id
  var controller = new AbortController()
  var timer = setTimeout(function() { controller.abort() }, 3000)
  fetch(ratingsUrl(item), { headers: authHeaders(music), signal: controller.signal })
    .then(function(response) {
      // An unrated song has no rating resource: the API answers 404, which
      // means "none", not "unknown" (unknown = lookup failed).
      if (response.status === 404) return { notFound: true }
      return response.ok ? response.json() : null
    })
    .then(function(data) {
      if (ratingCache.id !== cacheId) return
      if (data && data.notFound) { ratingCache.state = "none"; return }
      var value = data && data.data && data.data[0] &&
        data.data[0].attributes ? data.data[0].attributes.value : 0
      ratingCache.state = data ? ratingStateForValue(value) : "unknown"
    })
    .catch(function() {
      if (ratingCache.id === cacheId) ratingCache.state = "unknown"
    })
    .then(function() { clearTimeout(timer) })
}

function currentTrackItem(music) {
  var metadata = navigator.mediaSession && navigator.mediaSession.metadata
  var context = queueContext(music)
  if (!context) return null

  var current = context.position >= 0 ? context.items[context.position] : null
  // currentItem/position can lag a track change; Media Session metadata is
  // the authority for what is actually audible (same rule as duration).
  var matched = musicKitItemForMetadata(
    { currentItem: current, _queueItems: context.items }, metadata)
  return matched || current
}

function collectBridgeState() {
  try {
    var music = window.MusicKit && window.MusicKit.getInstance
      ? window.MusicKit.getInstance() : null
    if (!music) return { ok: false }

    var metadata = navigator.mediaSession && navigator.mediaSession.metadata
    var context = queueContext(music)
    var current = currentTrackItem(music)
    var trackId = current ? playableId(current) : ""
    if (trackId) refreshRatingCache(music, current)
    if (trackId) refreshLibraryCache(music, current)
    // MusicKit's queue position can go stale around jumps (playMediaItem),
    // so window the up-next list from where the matched current item
    // actually sits, falling back to the reported position.
    var position = context && current ? context.items.indexOf(current) : -1
    if (position < 0 && context) position = context.position

    return {
      ok: true,
      trackTitle: metadata ? String(metadata.title || "") : "",
      trackId: trackId,
      trackKind: current ? ratingKind(current) : "songs",
      rating: current && trackId && ratingCache.id === trackId
        ? ratingCache.state : "unknown",
      queuePosition: position,
      queueLength: context ? context.items.length : 0,
      upNext: context ? upNextEntries(context.items, position, 20) : [],
      shuffle: normalizeShuffle(music.shuffleMode),
      repeat: normalizeRepeat(music.repeatMode),
      autoplay: normalizeAutoplay(music.autoplayEnabled),
      play: current ? playbackDescriptorOf(current) : null,
      library: current && trackId && libraryCache.id === trackId
        ? libraryCache.state : "unknown"
    }
  } catch (_) {
    return { ok: false }
  }
}

function setRating(music, item, value) {
  var id = playableId(item)
  if (!id) return Promise.resolve({ ok: false, error: "no-track" })
  var state = ratingStateForValue(value)
  var cacheId = id
  var number = Number(value)

  // Clearing a rating is a DELETE: the API rejects PUT value 0, and the
  // rating resource only exists once a like/dislike was stored.
  var request
  if (number === 0) {
    request = fetch(ratingsUrl(item), { method: "DELETE", headers: authHeaders(music) })
  } else {
    request = fetch(ratingsUrl(item), {
      method: "PUT",
      headers: authHeaders(music),
      body: JSON.stringify({ type: "rating", attributes: { value: number } })
    })
  }

  return request.then(function(response) {
    if (!response.ok) return { ok: false, error: "http-" + response.status }
    if (ratingCache.id === cacheId) ratingCache.state = state
    return { ok: true, rating: state }
  }).catch(function() {
    return { ok: false, error: "network" }
  })
}

function handleCommand(payload) {
  try {
    var action = payload && payload.action
    var music = window.MusicKit && window.MusicKit.getInstance
      ? window.MusicKit.getInstance() : null
    if (!music) return Promise.resolve({ ok: false, error: "no-musickit" })

    if (action === "rate") {
      var current = currentTrackItem(music)
      if (!current) return Promise.resolve({ ok: false, error: "no-track" })
      return setRating(music, current, payload.value)
    }

    if (action === "jump") {
      var index = Number(payload.index)
      if (!Number.isInteger(index) || index < 0) {
        return Promise.resolve({ ok: false, error: "bad-index" })
      }
      // changeToMediaAtIndex hangs unresolved on the current web player
      // build, so jump by playing the queue item at the target index via
      // playMediaItem, which the player itself uses and begins playback.
      var context = queueContext(music)
      var target = context && context.items[index]
      if (!target) return Promise.resolve({ ok: false, error: "bad-index" })

      if (typeof music.playMediaItem === "function") {
        return music.playMediaItem(target)
          .then(function() { return { ok: true } })
          .catch(function() { return { ok: false, error: "jump-failed" } })
      }
      var player = music.player || music
      if (typeof player.changeToMediaAtIndex !== "function") {
        return Promise.resolve({ ok: false, error: "no-jump-api" })
      }
      return player.changeToMediaAtIndex(index)
        .then(function() { return { ok: true } })
        .catch(function() { return { ok: false, error: "jump-failed" } })
    }
    if (action === "set-shuffle") {
      if (typeof payload.enabled !== "boolean") {
        return Promise.resolve({ ok: false, error: "bad-payload" })
      }
      music.shuffleMode = payload.enabled ? 1 : 0
      return Promise.resolve({ ok: true })
    }

    if (action === "set-repeat") {
      var mode = typeof payload.mode === "string"
        ? payload.mode.trim().toLowerCase() : ""
      if (!REPEAT_MODES.hasOwnProperty(mode)) {
        return Promise.resolve({ ok: false, error: "bad-payload" })
      }
      music.repeatMode = REPEAT_MODES[mode]
      return Promise.resolve({ ok: true })
    }

    if (action === "set-autoplay") {
      if (typeof payload.enabled !== "boolean") {
        return Promise.resolve({ ok: false, error: "bad-payload" })
      }
      music.autoplayEnabled = payload.enabled
      return Promise.resolve({ ok: true })
    }

    if (action === "play-descriptor") {
      var descriptor = validPlaybackDescriptor(payload.descriptor)
      if (!descriptor) return Promise.resolve({ ok: false, error: "bad-descriptor" })
      return playDescriptor(music, descriptor)
    }

    if (action === "add-to-library") {
      var current = currentTrackItem(music)
      if (!current) return Promise.resolve({ ok: false, error: "no-track" })
      return addToLibrary(music, current)
    }
    return Promise.resolve({ ok: false, error: "unknown-action" })
  } catch (_) {
    return Promise.resolve({ ok: false, error: "exception" })
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  setInterval(bridgeAppleMusicDuration, 1000)
  document.addEventListener("visibilitychange", bridgeAppleMusicDuration)
  window.addEventListener("pageshow", bridgeAppleMusicDuration)

  if (!window.__omarchyAppleMusic) {
    window.__omarchyAppleMusic = {
      collect: collectBridgeState,
      command: handleCommand
    }
  }
}

if (typeof module !== "undefined") {
  module.exports = {
    appleMusicDurationSeconds: appleMusicDurationSeconds,
    bridgedPosition: bridgedPosition,
    itemMatchesMetadata: itemMatchesMetadata,
    musicKitItemForMetadata: musicKitItemForMetadata,
    needsDurationBridge: needsDurationBridge,
    playableId: playableId,
    isLibraryItem: isLibraryItem,
    ratingKind: ratingKind,
    ratingStateForValue: ratingStateForValue,
    playbackDescriptorOf: playbackDescriptorOf,
    validPlaybackDescriptor: validPlaybackDescriptor,
    playDescriptor: playDescriptor,
    librarySearchUrl: librarySearchUrl,
    libraryAddUrl: libraryAddUrl,
    libraryHits: libraryHits,
    refreshLibraryCache: refreshLibraryCache,
    addToLibrary: addToLibrary,
    normalizeShuffle: normalizeShuffle,
    normalizeRepeat: normalizeRepeat,
    normalizeAutoplay: normalizeAutoplay,
    normalizeQueueEntry: normalizeQueueEntry,
    queueContext: queueContext,
    upNextEntries: upNextEntries,
    collectBridgeState: collectBridgeState,
    handleCommand: handleCommand
  }
}
