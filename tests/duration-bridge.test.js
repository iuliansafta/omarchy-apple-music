const assert = require("node:assert/strict")
const bridge = require("../extension/chromium/duration-bridge.js")

assert.equal(
  bridge.appleMusicDurationSeconds({ attributes: { durationInMillis: 222551 } }),
  222.551
)
assert.equal(bridge.appleMusicDurationSeconds({ attributes: {} }), 0)
assert.equal(bridge.appleMusicDurationSeconds(null), 0)

// HLS-backed Apple Music tracks expose Infinity on the audio element even
// though MusicKit's catalog item contains the real duration.
assert.equal(bridge.needsDurationBridge(Infinity), true)
assert.equal(bridge.needsDurationBridge(0), true)
assert.equal(bridge.needsDurationBridge(257.247), false)

assert.equal(bridge.bridgedPosition(50, 200), 50)
assert.equal(bridge.bridgedPosition(-1, 200), 0)
assert.ok(bridge.bridgedPosition(250, 200) < 200)

const previous = {
  attributes: { name: "With You", artistName: "RealestK", durationInMillis: 123750 }
}
const current = {
  attributes: { name: "Nowhere Fast", artistName: "Lucky Daye", durationInMillis: 180000 }
}
const queue = {
  currentItem: previous,
  _queueItems: [{ item: previous }, { item: current }]
}

// MusicKit's currentItem can lag behind Media Session after a track change.
// Never publish the previous song's duration for the new MPRIS metadata.
assert.equal(
  bridge.musicKitItemForMetadata(queue, { title: "Nowhere Fast", artist: "Lucky Daye" }),
  current
)
assert.equal(
  bridge.musicKitItemForMetadata(queue, { title: "Unknown", artist: "Nobody" }),
  null
)

// Queue normalization and the up-next window carry absolute indices so the
// bar can jump to any entry after the current one.
const item = {
  attributes: {
    name: "Up Next Song",
    artistName: "Someone",
    durationInMillis: 200000,
    playParams: { id: "song-1", kind: "songs" }
  }
}
const entry = bridge.normalizeQueueEntry(item, 3)
assert.equal(entry.index, 3)
assert.equal(entry.id, "song-1")
assert.equal(entry.title, "Up Next Song")
assert.equal(entry.durationSeconds, 200)
assert.equal(bridge.normalizeQueueEntry(null, 0), null)
assert.equal(bridge.normalizeQueueEntry({ attributes: {} }, 0), null)

const queueItems = [
  { attributes: { name: "One", playParams: { id: "a" } } },
  { attributes: { name: "Two", playParams: { id: "b" } } },
  { attributes: { name: "Three", playParams: { id: "c" } } },
  null,
  { attributes: { name: "Five", playParams: { id: "e" } } }
]
const upNext = bridge.upNextEntries(queueItems, 1, 2)
assert.equal(upNext.length, 2)
assert.equal(upNext[0].index, 2)
assert.equal(upNext[1].index, 4)
assert.deepEqual(bridge.upNextEntries([], 0, 5), [])

assert.equal(bridge.ratingStateForValue(1), "like")
assert.equal(bridge.ratingStateForValue(null), "none")
assert.equal(bridge.ratingStateForValue("junk"), "unknown")
assert.equal(bridge.ratingStateForValue(0), "none")
assert.equal(bridge.ratingKind({ attributes: { playParams: { kind: "songs", id: "x" } } }), "songs")
assert.equal(bridge.ratingKind({ attributes: { playParams: { kind: "library-songs", id: "i.x" } } }), "library-songs")
assert.equal(bridge.playableId(item), "song-1")
assert.equal(bridge.playableId(null), "")

// Public queue is preferred over the private controller fallback.
const publicContext = bridge.queueContext({ player: { queue: { items: queueItems, position: 2 } } })
assert.equal(publicContext.items, queueItems)
assert.equal(publicContext.position, 2)
assert.equal(bridge.queueContext({ player: { queue: { items: [], position: null } } }), null)
assert.equal(bridge.queueContext(null), null)
const privateQueue = {
  _queueItems: [{ item: item }],
  currentItem: item
}
const privateContext = bridge.queueContext({ _playbackController: { _queue: privateQueue } })
assert.equal(privateContext.items.length, 1)
assert.equal(privateContext.position, 0)

// Without MusicKit the collector reports a dead bridge instead of throwing.
assert.deepEqual(bridge.collectBridgeState(), { ok: false })


// ---- Playback modes ----

// Every observed MusicKit repeat representation normalizes; anything else is
// "unknown", never a definite off.
assert.equal(bridge.normalizeRepeat(0), "none")
assert.equal(bridge.normalizeRepeat(1), "one")
assert.equal(bridge.normalizeRepeat(2), "all")
assert.equal(bridge.normalizeRepeat("none"), "none")
assert.equal(bridge.normalizeRepeat(" ONE "), "one")
assert.equal(bridge.normalizeRepeat(3), "unknown")
assert.equal(bridge.normalizeRepeat("bogus"), "unknown")
assert.equal(bridge.normalizeRepeat(null), "unknown")
assert.equal(bridge.normalizeRepeat(undefined), "unknown")
assert.equal(bridge.normalizeRepeat(NaN), "unknown")
assert.equal(bridge.normalizeRepeat(true), "unknown")

assert.equal(bridge.normalizeShuffle(0), false)
assert.equal(bridge.normalizeShuffle(1), true)
// The live setter clamps albums(2) back to songs(1); still "on" if it lands.
assert.equal(bridge.normalizeShuffle(2), true)
assert.equal(bridge.normalizeShuffle(true), true)
assert.equal(bridge.normalizeShuffle(false), false)
assert.equal(bridge.normalizeShuffle(3), null)
assert.equal(bridge.normalizeShuffle("yes"), null)
assert.equal(bridge.normalizeShuffle(null), null)
assert.equal(bridge.normalizeShuffle(undefined), null)

assert.equal(bridge.normalizeAutoplay(true), true)
assert.equal(bridge.normalizeAutoplay(false), false)
assert.equal(bridge.normalizeAutoplay(null), null)
assert.equal(bridge.normalizeAutoplay(undefined), null)
assert.equal(bridge.normalizeAutoplay("on"), null)

// Mode commands validate payloads before touching MusicKit: invalid ones
// leave the instance untouched, valid ones apply the documented mapping.
const modeStub = {}
global.window = { MusicKit: { getInstance: function() { return modeStub } } }

bridge.handleCommand({ action: "set-shuffle", enabled: "yes" })
assert.ok(!("shuffleMode" in modeStub))
bridge.handleCommand({ action: "set-shuffle", enabled: true })
assert.equal(modeStub.shuffleMode, 1)
bridge.handleCommand({ action: "set-shuffle", enabled: false })
assert.equal(modeStub.shuffleMode, 0)

bridge.handleCommand({ action: "set-repeat", mode: "all" })
assert.equal(modeStub.repeatMode, 2)
bridge.handleCommand({ action: "set-repeat", mode: "one" })
assert.equal(modeStub.repeatMode, 1)
bridge.handleCommand({ action: "set-repeat", mode: 2 })
assert.equal(modeStub.repeatMode, 1) // non-string mode rejected

bridge.handleCommand({ action: "set-autoplay", enabled: true })
assert.equal(modeStub.autoplayEnabled, true)
bridge.handleCommand({ action: "set-autoplay" })
assert.equal(modeStub.autoplayEnabled, true) // missing payload rejected

// collectBridgeState surfaces normalized mode state; a missing property
// stays null/unknown instead of masquerading as off.
modeStub.shuffleMode = 1
modeStub.repeatMode = 2
delete modeStub.autoplayEnabled
const modeState = bridge.collectBridgeState()
assert.equal(modeState.ok, true)
assert.equal(modeState.shuffle, true)
assert.equal(modeState.repeat, "all")
assert.equal(modeState.autoplay, null)

delete global.window

// ---- Replay descriptors ----

const catalogItem = {
  attributes: { name: "Dreams", playParams: { id: "594061856", kind: "song" } }
}
const libraryItem = {
  attributes: { name: "A Place for My Head", playParams: {
    id: "i.VNKLFZ7NoWV", kind: "song", isLibrary: true, catalogId: "590431786" } }
}

assert.deepEqual(bridge.playbackDescriptorOf(catalogItem), { kind: "song", id: "594061856" })
assert.deepEqual(bridge.playbackDescriptorOf(libraryItem), {
  kind: "song", id: "i.VNKLFZ7NoWV", catalogId: "590431786"
})
assert.equal(bridge.playbackDescriptorOf({ attributes: {} }), null)
assert.equal(bridge.playbackDescriptorOf(null), null)
assert.equal(bridge.playbackDescriptorOf({ attributes: { playParams: { id: "bad id!" } } }), null)

// Command validation: incomplete or malformed descriptors never reach the
// player, and unknown fields are dropped.
assert.deepEqual(bridge.validPlaybackDescriptor({ kind: "song", id: "594061856" }), {
  kind: "song", id: "594061856"
})
assert.deepEqual(bridge.validPlaybackDescriptor({ id: "i.abc", catalogId: "42" }), {
  kind: "song", id: "i.abc", catalogId: "42"
})
assert.equal(bridge.validPlaybackDescriptor(null), null)
assert.equal(bridge.validPlaybackDescriptor("594061856"), null)
assert.equal(bridge.validPlaybackDescriptor({}), null)
assert.equal(bridge.validPlaybackDescriptor({ id: "" }), null)
assert.equal(bridge.validPlaybackDescriptor({ id: "594 061856" }), null)
assert.equal(bridge.validPlaybackDescriptor({ id: "1", kind: "albums" }), null)
assert.equal(bridge.validPlaybackDescriptor({ id: "1", catalogId: "no good" }), null)

// playDescriptor replaces playback with the exact song: catalog twin wins for
// library items, and a failing setQueue surfaces as a safe error.
const queueStub = { setQueueCalls: [], setQueue: function(options) {
  queueStub.setQueueCalls.push(options)
  return Promise.resolve()
} }
bridge.playDescriptor(queueStub, { kind: "song", id: "i.abc", catalogId: "590431786" })
assert.deepEqual(queueStub.setQueueCalls[0], { songs: ["590431786"], startPlaying: true })
bridge.playDescriptor(queueStub, { kind: "song", id: "594061856" })
assert.deepEqual(queueStub.setQueueCalls[1], { songs: ["594061856"], startPlaying: true })

// handleCommand play-descriptor: rejects malformed payloads without touching
// the queue, and applies valid ones through setQueue.
const playStub = { setQueueCalls: [], setQueue: function(options) {
  playStub.setQueueCalls.push(options)
  return Promise.resolve()
} }
global.window = { MusicKit: { getInstance: function() { return playStub } } }
bridge.handleCommand({ action: "play-descriptor", descriptor: { id: "bad id" } })
assert.equal(playStub.setQueueCalls.length, 0)
bridge.handleCommand({ action: "play-descriptor", descriptor: { id: "i.abc", catalogId: "42" } })
assert.deepEqual(playStub.setQueueCalls[0], { songs: ["42"], startPlaying: true })
// A MusicKit without setQueue cannot replay; the safe error path is returned
// asynchronously (the call itself never throws).
bridge.playDescriptor({}, { kind: "song", id: "1" })
delete global.window

// ---- Library membership / add-to-library (mocked fetch, never live) ----

const CATALOG_ID = "6000001"
const catalogSong = {
  attributes: { name: "Some Song", playParams: { id: CATALOG_ID, kind: "song" } }
}
const librarySong = {
  attributes: { name: "Owned Song", playParams: {
    id: "i.owned", kind: "song", isLibrary: true, catalogId: "6000002" } }
}
const musicStub = { developerToken: "dev", musicUserToken: "user" }

assert.equal(bridge.librarySearchUrl(catalogSong),
  "https://api.music.apple.com/v1/me/library/search?term=Some%20Song&types=library-songs&limit=10")
assert.equal(bridge.libraryAddUrl(catalogSong),
  "https://api.music.apple.com/v1/me/library?ids%5Bsongs%5D=6000001")
assert.equal(bridge.libraryHits({
  results: { "library-songs": { data: [
    { attributes: { playParams: { catalogId: "6000001" } } },
    { attributes: { playParams: { catalogId: "6000009" } } }
  ] } }
}, "6000001").length, 1)
assert.equal(bridge.libraryHits({}, CATALOG_ID).length, 0)
assert.equal(bridge.libraryHits(null, CATALOG_ID).length, 0)

// fetch mock: records calls, programmable per-URL responses.
function makeFetchMock(respond) {
  const mock = function(url, options) {
    mock.calls.push({ url: url, method: (options && options.method) || "GET" })
    return respond(url, options)
  }
  mock.calls = []
  return mock
}
function searchResponse(hits) {
  return Promise.resolve({ ok: true, status: 200, json: function() {
    return Promise.resolve({ results: { "library-songs": { data: hits.map(function(cid) {
      return { attributes: { playParams: { catalogId: cid } } } }) } } })
  } })
}
const flush = function() { return new Promise(function(resolve) { setImmediate(resolve) }) }

;(async function() {
  // Queue-backed stub so collectBridgeState's current-track gating sees the
  // item under test (Media Session metadata is absent in Node, so the queue
  // item becomes the current item directly).
  const musicStub = {
    developerToken: "dev", musicUserToken: "user",
    player: { queue: { items: [], position: null } }
  }
  function setQueueItem(item) {
    musicStub.player.queue.items = item ? [item] : []
    musicStub.player.queue.position = item ? 0 : null
  }
  global.window = { MusicKit: { getInstance: function() { return musicStub } } }
  // Ratings fetches fire alongside library fetches; 404 = unrated.
  global.fetch = makeFetchMock(function(url, options) {
    if (String(url).indexOf("/ratings/") >= 0) {
      return Promise.resolve({ ok: false, status: 404 })
    }
    return searchResponse([])
  })

  // Identity: a library-kind song is trivially present, no request made.
  setQueueItem(librarySong)
  bridge.refreshLibraryCache(musicStub, librarySong)
  await flush()
  assert.equal(bridge.collectBridgeState().library, "present")

  // Catalog song absent from the library.
  setQueueItem(catalogSong)
  bridge.refreshLibraryCache(musicStub, null) // fresh cache for the scenario
  bridge.refreshLibraryCache(musicStub, catalogSong)
  await flush()
  assert.equal(bridge.collectBridgeState().library, "absent")

  // Membership normalization: with no current track the state is "unknown",
  // never a definite off.
  setQueueItem(null)
  assert.equal(bridge.collectBridgeState().library, "unknown")
  setQueueItem(catalogSong)

  // Already-present response: add reports success without any POST.
  global.fetch = makeFetchMock(function(url, options) {
    if (String(url).indexOf("/ratings/") >= 0) return Promise.resolve({ ok: false, status: 404 })
    return searchResponse([CATALOG_ID])
  })
  bridge.refreshLibraryCache(musicStub, null) // simulate a fresh lookup
  bridge.refreshLibraryCache(musicStub, null) // fresh cache for the scenario
  bridge.refreshLibraryCache(musicStub, catalogSong)
  await flush()
  const presentResult = await bridge.addToLibrary(musicStub, catalogSong)
  assert.deepEqual(presentResult, { ok: true, state: "present" })
  assert.equal(global.fetch.calls.filter(function(c) { return c.method === "POST" }).length, 0)

  // Successful add: absent → POST 202 → "adding" → confirmed present by
  // bounded membership polls.
  global.fetch = makeFetchMock(function(url, options) {
    if (String(url).indexOf("/ratings/") >= 0) return Promise.resolve({ ok: false, status: 404 })
    if (options && options.method === "POST") return Promise.resolve({ ok: true, status: 202 })
    return searchResponse([])
  })
  bridge.refreshLibraryCache(musicStub, null) // fresh cache for the scenario
  bridge.refreshLibraryCache(musicStub, catalogSong)
  await flush()
  const addingResult = await bridge.addToLibrary(musicStub, catalogSong)
  assert.deepEqual(addingResult, { ok: true, state: "adding" })
  assert.equal(bridge.collectBridgeState().library, "adding")
  // Duplicate write guard while pending.
  const duplicate = await bridge.addToLibrary(musicStub, catalogSong)
  assert.deepEqual(duplicate, { ok: false, error: "in-progress" })
  // Membership flips: the next confirmation poll adopts "present".
  global.fetch = makeFetchMock(function(url, options) {
    if (String(url).indexOf("/ratings/") >= 0) return Promise.resolve({ ok: false, status: 404 })
    return searchResponse([CATALOG_ID])
  })
  bridge.collectBridgeState() // runs a confirmation poll
  await flush()
  assert.equal(bridge.collectBridgeState().library, "present")

  // Stale-result protection: a pending add for track A must never apply to
  // track B after a track change.
  const songB = {
    attributes: { name: "Other Song", playParams: { id: "6000002", kind: "song" } }
  }
  global.fetch = makeFetchMock(function(url, options) {
    if (String(url).indexOf("/ratings/") >= 0) return Promise.resolve({ ok: false, status: 404 })
    if (options && options.method === "POST") return Promise.resolve({ ok: true, status: 202 })
    const isA = String(url).indexOf("Some%20Song") >= 0
    return searchResponse(isA ? [] : ["6000002"])
  })
  bridge.refreshLibraryCache(musicStub, null) // fresh cache for the scenario
  bridge.refreshLibraryCache(musicStub, catalogSong)
  await flush()
  await bridge.addToLibrary(musicStub, catalogSong) // A now "adding"
  setQueueItem(songB)                                // track change
  bridge.refreshLibraryCache(musicStub, songB)       // lookup for B starts
  await flush(); await flush()
  assert.equal(bridge.collectBridgeState().library, "present") // B's own state

  // HTTP failure surfaces as "error".
  global.fetch = makeFetchMock(function(url, options) {
    if (String(url).indexOf("/ratings/") >= 0) return Promise.resolve({ ok: false, status: 404 })
    if (options && options.method === "POST") return Promise.resolve({ ok: false, status: 500 })
    return searchResponse([])
  })
  setQueueItem(catalogSong)
  bridge.refreshLibraryCache(musicStub, null) // fresh cache for the scenario
  bridge.refreshLibraryCache(musicStub, catalogSong)
  await flush()
  const failed = await bridge.addToLibrary(musicStub, catalogSong)
  assert.deepEqual(failed, { ok: false, error: "http-500" })
  assert.equal(bridge.collectBridgeState().library, "error")

  // Network failure (timeout/abort/offline) surfaces as "error", too.
  global.fetch = makeFetchMock(function(url, options) {
    if (String(url).indexOf("/ratings/") >= 0) return Promise.resolve({ ok: false, status: 404 })
    if (options && options.method === "POST") return Promise.reject(new Error("aborted"))
    return searchResponse([])
  })
  setQueueItem(catalogSong)
  bridge.refreshLibraryCache(musicStub, null) // fresh cache for the scenario
  bridge.refreshLibraryCache(musicStub, catalogSong)
  await flush()
  const networkFail = await bridge.addToLibrary(musicStub, catalogSong)
  assert.deepEqual(networkFail, { ok: false, error: "network" })
  assert.equal(bridge.collectBridgeState().library, "error")

  // Missing current track: the command fails without any request.
  const noTrackCalls = global.fetch.calls.length
  const noTrack = await bridge.addToLibrary(musicStub, null)
  assert.deepEqual(noTrack, { ok: false, error: "no-track" })
  assert.equal(global.fetch.calls.length, noTrackCalls)

  delete global.window
  delete global.fetch

  console.log("duration bridge tests passed")
})().catch(function(error) {
  console.error(error)
  process.exit(1)
})
