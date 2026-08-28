const assert = require("node:assert/strict")
const bridge = require("../extension/duration-bridge.js")

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
console.log("duration bridge tests passed")
