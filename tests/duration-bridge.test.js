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

console.log("duration bridge tests passed")
