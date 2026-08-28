const assert = require("node:assert/strict")
const model = require("../AppleMusicModel.js")

const apple = { dbusName: "org.mpris.MediaPlayer2.chromium.instance1234" }
const spotify = { dbusName: "org.mpris.MediaPlayer2.spotify" }

assert.equal(model.playerPid(apple), 1234)
assert.equal(model.playerPid(spotify), 0)
assert.equal(model.selectPlayer([spotify, apple], 1234), apple)
// Quickshell exposes Mpris.players.values as an array-like QML sequence,
// not a JavaScript Array. Detection must work without Array.isArray().
assert.equal(model.selectPlayer({ 0: apple, length: 1 }, 1234), apple)
assert.equal(model.selectPlayer([apple], 9999), null)
assert.equal(model.selectPlayer([apple], 0), null)

assert.equal(model.validLength(245), true)
assert.equal(model.validLength(0), false)
assert.equal(model.validLength(Number.MAX_SAFE_INTEGER), false)
assert.equal(model.progress(30, 120), 0.25)
assert.equal(model.progress(30, Number.MAX_SAFE_INTEGER), 0)
assert.equal(model.boundedPosition(130, 120), 120)
assert.equal(model.formatTime(0), "0:00")
assert.equal(model.formatTime(151), "2:31")
// Bridge state is only trusted when it names the same track MPRIS reports.
assert.equal(model.bridgeIsActive(null, "Nowhere Fast"), false)
assert.equal(model.bridgeIsActive({ ok: false, trackTitle: "Nowhere Fast" }, "Nowhere Fast"), false)
assert.equal(model.bridgeIsActive({ ok: true, trackTitle: "Nowhere Fast" }, "Nowhere Fast"), true)
assert.equal(model.bridgeIsActive({ ok: true, trackTitle: "Nowhere Fast" }, "With You"), false)
assert.equal(model.bridgeIsActive({ ok: true, trackTitle: "" }, ""), false)

assert.equal(model.upNextFromState(null).length, 0)
assert.equal(model.upNextFromState({ ok: true }).length, 0)
const historyLines = [
  JSON.stringify({ ts: 1, title: "A", artist: "X" }),
  JSON.stringify({ ts: 2, title: "B", artist: "Y", album: "Album", art: "b.jpg" }),
  "not json",
  JSON.stringify({ ts: 3, title: "C", artist: "Z" }),
  ""
].join("\n")
const history = model.parseHistoryLines(historyLines, 2)
assert.equal(history.length, 2)
assert.equal(history[0].title, "C")
assert.equal(history[1].title, "B")
assert.equal(history[1].album, "Album")
assert.equal(model.parseHistoryLines("", 10).length, 0)
// Repeated plays of the same song are distinct records when they carry
// distinct timestamps; startup loading must not collapse them.
const repeats = model.parseHistoryLines([
  JSON.stringify({ ts: 10, title: "A", artist: "X" }),
  JSON.stringify({ ts: 20, title: "A", artist: "X" })
].join("\n"), 10)
assert.equal(repeats.length, 2)
assert.equal(repeats[0].ts, 20)
// Legacy entries with missing optional fields stay readable.
const legacy = model.parseHistoryLines(JSON.stringify({ ts: 5, title: "Old" }), 5)
assert.equal(legacy.length, 1)
assert.equal(legacy[0].artist, "")
assert.equal(legacy[0].album, "")
assert.equal(legacy[0].art, "")

// The append script keeps the file bounded without leaving a torn line.
const script = model.historyAppendBashScript()
assert.ok(script.includes("printf"))
assert.ok(script.includes("tail -n 200"))
assert.ok(script.includes("mkdir -p"))

console.log("AppleMusicModel tests passed")
