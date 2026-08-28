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

// MPRIS metadata is untrusted. Bound it before it reaches QML rendering,
// persisted history, or a Process argv, and neutralize rich-text delimiters
// used by shared tooltip renderers. Controls become spaces rather than layout
// instructions so a metadata value remains a single display line.
function metadataText(value) {
  return String(value || "").slice(0, 512)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/</g, "‹").replace(/>/g, "›")
}

// Chromium normally publishes either an HTTPS cover or a canonical local
// file URI. Reject every other Image source scheme, remote file authorities,
// whitespace/control characters, and overlong URLs.
function artworkUrl(value) {
  var url = String(value || "")
  if (!url || url.length > 2048 || /[\u0000-\u0020\u007f]/.test(url)) return ""
  if (/^https:\/\/[^/?#]+(?:[/?#]|$)/i.test(url)) return url
  if (/^file:\/\/\/(?!\/)/i.test(url)) return url
  return ""
}

// History records may carry a "play" descriptor identifying the exact song,
// same shape the extension produces: { kind: "song", id, catalogId? }.
// Malformed or missing descriptors parse as null, keeping legacy records
// readable but non-replayable.
function historyPlaybackDescriptor(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  var id = typeof value.id === "string" ? value.id : ""
  if (!id || id.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) return null
  if (typeof value.kind !== "undefined" && value.kind !== "song") return null
  var descriptor = { kind: "song", id: id }
  if (typeof value.catalogId === "string" && value.catalogId !== "") {
    if (value.catalogId.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.catalogId)) return null
    descriptor.catalogId = value.catalogId
  }
  return descriptor
}

function historyLogKey(title, artist) {
  return metadataText(title).trim().toLowerCase() + "|" +
    metadataText(artist).trim().toLowerCase()
}

// Entries are already newest-first. Keep only the newest occurrence of each
// title/artist pair so replaying a song moves it to the top instead of adding
// another visible row. Title/artist also deduplicates legacy records that do
// not carry a MusicKit playback descriptor.
function uniqueHistoryEntries(entries, cap) {
  var limit = Number(cap) || 0
  var result = []
  var seen = {}
  var list = Array.isArray(entries) ? entries : []
  for (var i = 0; i < list.length && (!limit || result.length < limit); i++) {
    var entry = list[i]
    if (!entry) continue
    var key = historyLogKey(entry.title, entry.artist)
    if (seen[key]) continue
    seen[key] = true
    result.push(entry)
  }
  return result
}

function parseHistoryLines(text, cap) {
  var lines = String(text || "").split("\n")
  var entries = []
  for (var i = lines.length - 1; i >= 0; i--) {
    var line = lines[i].trim()
    if (!line) continue
    try {
      var entry = JSON.parse(line)
      var title = entry && typeof entry.title === "string"
        ? metadataText(entry.title) : ""
      if (title.trim() !== "") {
        entries.push({
          ts: Number(entry.ts) || 0,
          title: title,
          artist: metadataText(entry.artist),
          album: metadataText(entry.album),
          art: artworkUrl(entry.art),
          play: historyPlaybackDescriptor(entry.play)
        })
      }
    } catch (_) {
      // A torn or foreign line is skipped, never fatal.
    }
  }
  return uniqueHistoryEntries(entries, cap)
}

// File I/O below runs as `python3 -c <script> <args...>`. The history parent
// is pinned as a self-owned 0700 directory, then every bounded file operation
// is relative to that descriptor and verifies a self-owned regular final
// component opened with O_NOFOLLOW|O_NONBLOCK. Parent replacement, symlinks,
// and FIFOs can therefore neither redirect nor block history I/O.

// argv[1] = history path. Prints at most the last 1 MiB of the file; a
// missing/unreadable/foreign file prints nothing (empty history, no error).
function historyLoadPythonScript() {
  return [
    'import os, stat, sys',
    'parent, name = os.path.split(sys.argv[1])',
    'if not parent or not name:',
    '    sys.exit(0)',
    'try:',
    '    dirfd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)',
    'except OSError:',
    '    sys.exit(0)',
    'try:',
    '    dinfo = os.fstat(dirfd)',
    '    if dinfo.st_uid != os.geteuid():',
    '        sys.exit(0)',
    '    if stat.S_IMODE(dinfo.st_mode) != 0o700:',
    '        os.fchmod(dirfd, 0o700)',
    '        if stat.S_IMODE(os.fstat(dirfd).st_mode) != 0o700:',
    '            sys.exit(0)',
    '    try:',
    '        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=dirfd)',
    '    except OSError:',
    '        sys.exit(0)',
    '    try:',
    '        info = os.fstat(fd)',
    '        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid():',
    '            sys.exit(0)',
    '        limit = 1048576',
    '        if info.st_size > limit:',
    '            os.lseek(fd, info.st_size - limit, os.SEEK_SET)',
    '        total = 0',
    '        while total < limit:',
    '            chunk = os.read(fd, min(65536, limit - total))',
    '            if not chunk:',
    '                break',
    '            total += len(chunk)',
    '            sys.stdout.buffer.write(chunk)',
    '    finally:',
    '        os.close(fd)',
    'finally:',
    '    os.close(dirfd)'
  ].join('\n')
}

// argv[1] = entry JSON line, argv[2] = history path. Appends one line, then
// trims the file to its newest 200 lines once it exceeds 500 lines (or 1 MiB).
function historyAppendPythonScript() {
  return [
    'import os, stat, sys',
    'entry, path = sys.argv[1], sys.argv[2]',
    'if len(entry) > 65536 or "\\n" in entry:',
    '    sys.exit(0)',
    'parent, name = os.path.split(path)',
    'if not parent or not name:',
    '    sys.exit(0)',
    'os.makedirs(parent, mode=0o700, exist_ok=True)',
    'dirfd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)',
    'try:',
    '    dinfo = os.fstat(dirfd)',
    '    if dinfo.st_uid != os.geteuid():',
    '        sys.exit(0)',
    '    if stat.S_IMODE(dinfo.st_mode) != 0o700:',
    '        os.fchmod(dirfd, 0o700)',
    '        if stat.S_IMODE(os.fstat(dirfd).st_mode) != 0o700:',
    '            sys.exit(0)',
    '    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=dirfd)',
    '    try:',
    '        info = os.fstat(fd)',
    '        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid():',
    '            sys.exit(0)',
    '        os.fchmod(fd, 0o600)',
    '        os.write(fd, entry.encode() + b"\\n")',
    '    finally:',
    '        os.close(fd)',
    '    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=dirfd)',
    '    try:',
    '        info = os.fstat(fd)',
    '        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid():',
    '            sys.exit(0)',
    '        limit = 1048576',
    '        if info.st_size > limit:',
    '            os.lseek(fd, info.st_size - limit, os.SEEK_SET)',
    '        data = b""',
    '        while len(data) < limit:',
    '            chunk = os.read(fd, min(65536, limit - len(data)))',
    '            if not chunk:',
    '                break',
    '            data += chunk',
    '    finally:',
    '        os.close(fd)',
    '    lines = [line for line in data.split(b"\\n") if line]',
    '    if info.st_size > limit or len(lines) > 500:',
    '        tmp = "." + name + ".tmp." + str(os.getpid())',
    '        tfd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=dirfd)',
    '        try:',
    '            os.write(tfd, b"\\n".join(lines[-200:]) + b"\\n")',
    '        finally:',
    '            os.close(tfd)',
    '        try:',
    '            os.replace(tmp, name, src_dir_fd=dirfd, dst_dir_fd=dirfd)',
    '        finally:',
    '            try:',
    '                os.unlink(tmp, dir_fd=dirfd)',
    '            except FileNotFoundError:',
    '                pass',
    'finally:',
    '    os.close(dirfd)'
  ].join('\n')
}

// argv[1] = command JSON, argv[2] = command file path. O_EXCL never follows
// a symlink and never overwrites, so a planted file simply makes the write a
// no-op instead of redirecting it.
function commandWritePythonScript() {
  return [
    'import os, sys',
    'payload, path = sys.argv[1], sys.argv[2]',
    'if len(payload) > 65536:',
    '    sys.exit(0)',
    'os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)',
    'try:',
    '    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)',
    'except OSError:',
    '    sys.exit(0)',
    'try:',
    '    os.write(fd, payload.encode())',
    'finally:',
    '    os.close(fd)'
  ].join('\n')
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
    metadataText: metadataText,
    artworkUrl: artworkUrl,
    historyLogKey: historyLogKey,
    uniqueHistoryEntries: uniqueHistoryEntries,
    historyPlaybackDescriptor: historyPlaybackDescriptor,
    parseHistoryLines: parseHistoryLines,
    historyLoadPythonScript: historyLoadPythonScript,
    historyAppendPythonScript: historyAppendPythonScript,
    commandWritePythonScript: commandWritePythonScript
  }
}
