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

// Untrusted MPRIS strings are bounded before they reach QML, history JSON,
// or process argv. Markup delimiters and controls cannot trigger rich text.
assert.equal(model.metadataText("Song <b>title</b>\nnext"), "Song ‹b›title‹/b› next")
assert.equal(model.metadataText("x".repeat(600)).length, 512)
assert.equal(model.artworkUrl("https://example.com/cover.jpg"), "https://example.com/cover.jpg")
assert.equal(model.artworkUrl("file:///tmp/cover.jpg"), "file:///tmp/cover.jpg")
assert.equal(model.artworkUrl("http://example.com/cover.jpg"), "")
assert.equal(model.artworkUrl("data:image/png;base64,AAAA"), "")
assert.equal(model.artworkUrl("file://remote/cover.jpg"), "")
assert.equal(model.artworkUrl("https://example.com/" + "x".repeat(2048)), "")

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

// Pause a generated worker immediately after its final parent descriptor is
// pinned. The orchestrator can then replace an intermediate ancestor before
// allowing the descriptor-relative file operation to continue.
function withPinnedParentBarrier(script, argumentCount) {
  const pinned = "dirfd = dirfds[-1]"
  const markerIndex = argumentCount + 1
  assert.equal(script.split(pinned).length, 2)
  return script
    .replace("import errno, os, stat, sys", "import errno, os, stat, sys, time")
    .replace(pinned, [
      pinned,
      'with open(sys.argv[' + markerIndex + '], "w") as marker:',
      '    marker.write("ready")',
      'while not os.path.exists(sys.argv[' + (markerIndex + 1) + ']):',
      '    time.sleep(0.001)'
    ].join("\n"))
}

function runAncestorSwap(script, workerArgs, live, moved, redirect, controlDir, label) {
  const worker = path.join(controlDir, label + "-worker.py")
  const marker = path.join(controlDir, label + "-ready")
  const release = path.join(controlDir, label + "-release")
  fs.writeFileSync(worker, withPinnedParentBarrier(script, workerArgs.length))
  const orchestrator = [
    'import json, os, subprocess, sys, time',
    'worker, worker_args_json, marker, release, live, moved, redirect = sys.argv[1:]',
    'worker_args = json.loads(worker_args_json)',
    'proc = subprocess.Popen(["python3", worker] + worker_args + [marker, release])',
    'try:',
    '    deadline = time.time() + 5',
    '    while not os.path.exists(marker):',
    '        if proc.poll() is not None:',
    '            raise RuntimeError("worker exited before pinning parent")',
    '        if time.time() >= deadline:',
    '            raise TimeoutError("worker did not pin parent")',
    '        time.sleep(0.001)',
    '    os.rename(live, moved)',
    '    os.symlink(redirect, live)',
    '    with open(release, "w"):',
    '        pass',
    '    status = proc.wait(timeout=5)',
    '    if status != 0:',
    '        raise RuntimeError("worker exited with status " + str(status))',
    'finally:',
    '    if proc.poll() is None:',
    '        with open(release, "a"):',
    '            pass',
    '        try:',
    '            proc.wait(timeout=1)',
    '        except subprocess.TimeoutExpired:',
    '            proc.kill()',
    '            proc.wait()'
  ].join("\n")
  return execFileSync("python3", ["-c", orchestrator, worker,
    JSON.stringify(workerArgs), marker, release, live, moved, redirect],
    { stdio: "pipe", timeout: 10000 }).toString()
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "am-model-test-"))
try {
  const historyFile = path.join(tmp, "state", "history.jsonl")
  const entry = JSON.stringify({ ts: 1, title: "Song", artist: "Artist" })
  execFileSync("python3", ["-c", model.historyAppendPythonScript(), entry, historyFile])
  execFileSync("python3", ["-c", model.historyAppendPythonScript(), entry, historyFile])
  const loaded = execFileSync("python3", ["-c", model.historyLoadPythonScript(), historyFile]).toString()
  assert.equal(loaded, entry + "\n" + entry + "\n")
  // The pinned history parent is private even if it was initially broad.
  const historyParent = path.dirname(historyFile)
  fs.chmodSync(historyParent, 0o755)
  assert.equal(execFileSync("python3", ["-c", model.historyLoadPythonScript(), historyFile]).toString(), loaded)
  assert.equal(fs.statSync(historyParent).mode & 0o777, 0o700)
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

  // A symlinked history parent must not redirect append, trim, or load.
  const parentVictim = path.join(tmp, "parent-victim")
  fs.mkdirSync(parentVictim)
  const parentVictimHistory = path.join(parentVictim, "history.jsonl")
  fs.writeFileSync(parentVictimHistory, "untouched\n")
  const parentLink = path.join(tmp, "parent-link")
  fs.symlinkSync(parentVictim, parentLink)
  const redirectedHistory = path.join(parentLink, "history.jsonl")
  assert.throws(() => execFileSync("python3", ["-c", model.historyAppendPythonScript(), entry, redirectedHistory], { stdio: "pipe" }))
  assert.equal(fs.readFileSync(parentVictimHistory, "utf8"), "untouched\n")
  assert.equal(execFileSync("python3", ["-c", model.historyLoadPythonScript(), redirectedHistory]).toString(), "")

  // A symlink earlier in the parent chain must also be rejected. In
  // particular, history access must not repair permissions on the self-owned
  // directory reached through that unverified chain.
  const intermediateRoot = path.join(tmp, "intermediate-root")
  const intermediateVictim = path.join(tmp, "intermediate-victim")
  const intermediateVictimParent = path.join(intermediateVictim, "state")
  fs.mkdirSync(intermediateRoot)
  fs.mkdirSync(intermediateVictimParent, { recursive: true })
  fs.chmodSync(intermediateVictimParent, 0o755)
  const intermediateVictimHistory = path.join(intermediateVictimParent, "history.jsonl")
  fs.writeFileSync(intermediateVictimHistory, "still untouched\n")
  const intermediateLink = path.join(intermediateRoot, "redirect")
  fs.symlinkSync(intermediateVictim, intermediateLink)
  const intermediateHistory = path.join(intermediateLink, "state", "history.jsonl")
  assert.throws(() => execFileSync("python3", ["-c", model.historyAppendPythonScript(), entry, intermediateHistory], { stdio: "pipe" }))
  assert.equal(fs.readFileSync(intermediateVictimHistory, "utf8"), "still untouched\n")
  assert.equal(fs.statSync(intermediateVictimParent).mode & 0o777, 0o755)
  assert.equal(execFileSync("python3", ["-c", model.historyLoadPythonScript(), intermediateHistory]).toString(), "")

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

  // Command creation also rejects symlinks earlier in its parent chain.
  const commandVictim = path.join(tmp, "command-victim")
  const commandVictimParent = path.join(commandVictim, "commands")
  fs.mkdirSync(commandVictimParent, { recursive: true })
  const commandLink = path.join(intermediateRoot, "command-redirect")
  fs.symlinkSync(commandVictim, commandLink)
  const intermediateCommand = path.join(commandLink, "commands", "cmd-3.json")
  execFileSync("python3", ["-c", model.commandWritePythonScript(), '{"action":"evil"}', intermediateCommand])
  assert.equal(fs.existsSync(path.join(commandVictimParent, "cmd-3.json")), false)

  // Once the history parent is pinned, replacing an intermediate ancestor
  // redirects the pathname but not the append operation or permission repair.
  const historyRaceRoot = path.join(tmp, "history-race")
  const historyRaceLive = path.join(historyRaceRoot, "live")
  const historyRaceMoved = path.join(historyRaceRoot, "moved")
  const historyRaceRedirect = path.join(historyRaceRoot, "redirect")
  const historyRaceOriginalParent = path.join(historyRaceLive, "state")
  const historyRaceRedirectParent = path.join(historyRaceRedirect, "state")
  fs.mkdirSync(historyRaceOriginalParent, { recursive: true })
  fs.mkdirSync(historyRaceRedirectParent, { recursive: true })
  fs.chmodSync(historyRaceOriginalParent, 0o700)
  fs.chmodSync(historyRaceRedirectParent, 0o755)
  const raceEntry = JSON.stringify({ ts: 700, title: "Pinned history" })
  const historyRaceFile = path.join(historyRaceOriginalParent, "history.jsonl")
  const historyRaceRedirectFile = path.join(historyRaceRedirectParent, "history.jsonl")
  const raceBulk = Array.from({ length: 600 }, (_, i) =>
    JSON.stringify({ ts: i, title: "race-" + i })).join("\n") + "\n"
  fs.writeFileSync(historyRaceFile, raceBulk)
  fs.writeFileSync(historyRaceRedirectFile, "redirect untouched\n")
  runAncestorSwap(model.historyAppendPythonScript(), [raceEntry,
    path.join(historyRaceLive, "state", "history.jsonl")], historyRaceLive,
    historyRaceMoved, historyRaceRedirect, tmp, "history-race")
  const raceTrimmed = fs.readFileSync(path.join(historyRaceMoved, "state", "history.jsonl"), "utf8").trim().split("\n")
  assert.equal(raceTrimmed.length, 200)
  assert.equal(JSON.parse(raceTrimmed[raceTrimmed.length - 1]).title, "Pinned history")
  assert.equal(fs.readFileSync(historyRaceRedirectFile, "utf8"), "redirect untouched\n")
  assert.equal(fs.statSync(historyRaceRedirectParent).mode & 0o777, 0o755)

  // Loading also reads from the pinned parent after an ancestor swap, never
  // from the replacement path now visible under the original pathname.
  const loadRaceRoot = path.join(tmp, "load-race")
  const loadRaceLive = path.join(loadRaceRoot, "live")
  const loadRaceMoved = path.join(loadRaceRoot, "moved")
  const loadRaceRedirect = path.join(loadRaceRoot, "redirect")
  fs.mkdirSync(path.join(loadRaceLive, "state"), { recursive: true })
  fs.mkdirSync(path.join(loadRaceRedirect, "state"), { recursive: true })
  fs.chmodSync(path.join(loadRaceLive, "state"), 0o700)
  fs.chmodSync(path.join(loadRaceRedirect, "state"), 0o755)
  fs.writeFileSync(path.join(loadRaceLive, "state", "history.jsonl"), "original history\n")
  fs.writeFileSync(path.join(loadRaceRedirect, "state", "history.jsonl"), "redirect history\n")
  const racedLoad = runAncestorSwap(model.historyLoadPythonScript(),
    [path.join(loadRaceLive, "state", "history.jsonl")], loadRaceLive,
    loadRaceMoved, loadRaceRedirect, tmp, "load-race")
  assert.equal(racedLoad, "original history\n")
  assert.equal(fs.readFileSync(path.join(loadRaceRedirect, "state", "history.jsonl"), "utf8"), "redirect history\n")
  assert.equal(fs.statSync(path.join(loadRaceRedirect, "state")).mode & 0o777, 0o755)

  // Command creation likewise stays inside its pinned directory after an
  // intermediate ancestor is replaced with a symlink.
  const commandRaceRoot = path.join(tmp, "command-race")
  const commandRaceLive = path.join(commandRaceRoot, "live")
  const commandRaceMoved = path.join(commandRaceRoot, "moved")
  const commandRaceRedirect = path.join(commandRaceRoot, "redirect")
  fs.mkdirSync(path.join(commandRaceLive, "commands"), { recursive: true })
  fs.mkdirSync(path.join(commandRaceRedirect, "commands"), { recursive: true })
  fs.chmodSync(path.join(commandRaceLive, "commands"), 0o700)
  fs.chmodSync(path.join(commandRaceRedirect, "commands"), 0o755)
  const raceCommand = '{"action":"pinned"}'
  runAncestorSwap(model.commandWritePythonScript(), [raceCommand,
    path.join(commandRaceLive, "commands", "cmd-race.json")], commandRaceLive,
    commandRaceMoved, commandRaceRedirect, tmp, "command-race")
  assert.equal(fs.readFileSync(path.join(commandRaceMoved, "commands", "cmd-race.json"), "utf8"), raceCommand)
  assert.equal(fs.existsSync(path.join(commandRaceRedirect, "commands", "cmd-race.json")), false)
  assert.equal(fs.statSync(path.join(commandRaceRedirect, "commands")).mode & 0o777, 0o755)

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
