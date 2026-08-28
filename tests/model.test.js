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
// Recently played is unique by normalized title/artist. The newest play wins,
// including for legacy entries that do not carry a playback descriptor.
const repeats = model.parseHistoryLines([
  JSON.stringify({ ts: 10, title: "A", artist: "X" }),
  JSON.stringify({ ts: 15, title: "B", artist: "Y" }),
  JSON.stringify({ ts: 20, title: " a ", artist: "x" })
].join("\n"), 10)
assert.equal(repeats.length, 2)
assert.equal(repeats[0].ts, 20)
assert.equal(repeats[1].title, "B")
// The cap counts unique songs, so duplicate lines do not hide older distinct
// entries that still fit in the visible list.
const cappedUnique = model.parseHistoryLines([
  JSON.stringify({ ts: 1, title: "Older", artist: "Artist" }),
  JSON.stringify({ ts: 2, title: "Repeat", artist: "Artist" }),
  JSON.stringify({ ts: 3, title: "Repeat", artist: "Artist" })
].join("\n"), 2)
assert.deepEqual(cappedUnique.map(entry => entry.title), ["Repeat", "Older"])
const movedToTop = model.uniqueHistoryEntries([
  { ts: 4, title: "Older", artist: "Artist" },
  { ts: 3, title: "Repeat", artist: "Artist" },
  { ts: 1, title: "Older", artist: "Artist" }
], 10)
assert.deepEqual(movedToTop.map(entry => entry.ts), [4, 3])
// Legacy entries with missing optional fields stay readable.
const legacy = model.parseHistoryLines(JSON.stringify({ ts: 5, title: "Old" }), 5)
assert.equal(legacy.length, 1)
assert.equal(legacy[0].artist, "")
assert.equal(legacy[0].album, "")
assert.equal(legacy[0].art, "")

// History entries may carry a playback descriptor; malformed ones parse as
// null so the row stays readable but non-replayable.
const withPlay = model.parseHistoryLines([
  JSON.stringify({ ts: 30, title: "Dreams", artist: "Fleetwood Mac",
    play: { kind: "song", id: "594061856" } }),
  JSON.stringify({ ts: 31, title: "Lib", play: {
    kind: "song", id: "i.abc", catalogId: "42" } }),
  JSON.stringify({ ts: 32, title: "Broken", play: { kind: "song", id: "" } }),
  JSON.stringify({ ts: 33, title: "WrongKind", play: { kind: "albums", id: "1" } }),
  JSON.stringify({ ts: 34, title: "Junk", play: "594061856" }),
  JSON.stringify({ ts: 35, title: "Legacy" })
].join("\n"), 10)
assert.equal(withPlay.length, 6)
assert.deepEqual(withPlay[5].play, { kind: "song", id: "594061856" })
assert.deepEqual(withPlay[4].play, { kind: "song", id: "i.abc", catalogId: "42" })
assert.equal(withPlay[3].play, null)
assert.equal(withPlay[2].play, null)
assert.equal(withPlay[1].play, null)
assert.equal(withPlay[0].play, null)
assert.equal(model.historyPlaybackDescriptor({ id: "1", extra: "x" }).extra, undefined)

// The file scripts run through python3 with bounded no-follow descriptors.
// Exercise them for real against a temp dir: append + load round-trip works,
// and a symlink planted at the path never redirects a write.
const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "am-model-test-"))
try {
  const historyFile = path.join(tmp, "state", "history.jsonl")
  const entry = JSON.stringify({ ts: 1, title: "Song", artist: "Artist" })
  execFileSync("python3", ["-c", model.historyAppendPythonScript(), entry, historyFile])
  execFileSync("python3", ["-c", model.historyAppendPythonScript(), entry, historyFile])
  const loaded = execFileSync("python3", ["-c", model.historyLoadPythonScript(), historyFile]).toString()
  assert.equal(loaded, entry + "\n" + entry + "\n")
  // Missing file: silent empty output, exit 0.
  assert.equal(execFileSync("python3", ["-c", model.historyLoadPythonScript(), historyFile + ".nope"]).toString(), "")

  // A symlink at the history path must not be followed by append or load.
  const victim = path.join(tmp, "victim")
  fs.writeFileSync(victim, "untouched\n")
  const link = path.join(tmp, "link.jsonl")
  fs.symlinkSync(victim, link)
  assert.throws(() => execFileSync("python3", ["-c", model.historyAppendPythonScript(), entry, link], { stdio: "pipe" }))
  assert.equal(fs.readFileSync(victim, "utf8"), "untouched\n")
  // Load treats a symlink like a missing file: empty output, no error.
  assert.equal(execFileSync("python3", ["-c", model.historyLoadPythonScript(), link]).toString(), "")

  // Command write: creates exclusively, refuses to overwrite or follow links.
  const cmdFile = path.join(tmp, "cmds", "cmd-1.json")
  execFileSync("python3", ["-c", model.commandWritePythonScript(), '{"action":"rate"}', cmdFile])
  assert.equal(fs.readFileSync(cmdFile, "utf8"), '{"action":"rate"}')
  execFileSync("python3", ["-c", model.commandWritePythonScript(), '{"action":"other"}', cmdFile])
  assert.equal(fs.readFileSync(cmdFile, "utf8"), '{"action":"rate"}')
  const cmdLink = path.join(tmp, "cmds", "cmd-2.json")
  fs.symlinkSync(victim, cmdLink)
  execFileSync("python3", ["-c", model.commandWritePythonScript(), '{"action":"evil"}', cmdLink])
  assert.equal(fs.readFileSync(victim, "utf8"), "untouched\n")

  // Trim: >500 lines collapses to the newest 200.
  const trimFile = path.join(tmp, "trim.jsonl")
  const bulk = Array.from({ length: 600 }, (_, i) => JSON.stringify({ ts: i, title: "t" + i })).join("\n") + "\n"
  fs.writeFileSync(trimFile, bulk)
  execFileSync("python3", ["-c", model.historyAppendPythonScript(), JSON.stringify({ ts: 601, title: "last" }), trimFile])
  const trimmed = fs.readFileSync(trimFile, "utf8").trim().split("\n")
  assert.equal(trimmed.length, 200)
  assert.equal(JSON.parse(trimmed[trimmed.length - 1]).title, "last")
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log("AppleMusicModel tests passed")
