#!/usr/bin/env python3
"""Pure-logic tests for scripts/bridge-daemon (no live Chromium needed).

Runs with the standard library unittest runner:

    python3 tests/bridge_daemon.test.py
"""

import importlib.util
import json
import os
import stat
import tempfile
import unittest

DAEMON_PATH = os.path.join(os.path.dirname(__file__), "..", "scripts", "bridge-daemon")

spec = importlib.util.spec_from_loader(
    "bridge_daemon",
    importlib.machinery.SourceFileLoader("bridge_daemon", DAEMON_PATH),
)
bridge_daemon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge_daemon)


class FakeClient:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


class NoteCommandFailureTest(unittest.TestCase):
    def test_retry_is_bounded(self):
        attempts = {}
        for _ in range(bridge_daemon.MAX_COMMAND_ATTEMPTS - 1):
            self.assertFalse(bridge_daemon.note_command_failure("cmd-1.json", attempts))
        # Last allowed attempt returns True: drop the command.
        self.assertTrue(bridge_daemon.note_command_failure("cmd-1.json", attempts))
        # Counter cleared with the file, so a future command name starts fresh.
        self.assertEqual(attempts, {})

    def test_each_command_counts_separately(self):
        attempts = {}
        self.assertFalse(bridge_daemon.note_command_failure("cmd-1.json", attempts))
        self.assertFalse(bridge_daemon.note_command_failure("cmd-2.json", attempts))
        self.assertEqual(attempts, {"cmd-1.json": 1, "cmd-2.json": 1})


class SanitizeStateTest(unittest.TestCase):
    def test_non_dict_and_not_ok_become_not_ok(self):
        self.assertEqual(bridge_daemon.sanitize_state(None), {"ok": False})
        self.assertEqual(bridge_daemon.sanitize_state([1, 2]), {"ok": False})
        self.assertEqual(bridge_daemon.sanitize_state({"ok": "yes"}), {"ok": False})

    def test_strings_are_typed_and_capped(self):
        state = bridge_daemon.sanitize_state({
            "ok": True,
            "trackTitle": "x" * 10000,
            "trackId": 12345,          # wrong type -> empty
            "rating": {"nested": True},  # wrong type -> empty
            "queuePosition": "NaN",    # wrong type -> 0
            "queueLength": 3.7,
        })
        self.assertEqual(len(state["trackTitle"]), bridge_daemon.MAX_STATE_STRING)
        self.assertEqual(state["trackId"], "")
        self.assertEqual(state["rating"], "")
        self.assertEqual(state["queuePosition"], 0)
        self.assertEqual(state["queueLength"], 3)

    def test_upnext_is_whitelisted_and_capped(self):
        items = [{"index": i, "id": "i", "title": "t", "artist": "a",
                  "durationSeconds": 1, "evil": "x" * 100000} for i in range(500)]
        state = bridge_daemon.sanitize_state({"ok": True, "upNext": items})
        self.assertEqual(len(state["upNext"]), bridge_daemon.MAX_UPNEXT_ENTRIES)
        self.assertNotIn("evil", state["upNext"][0])
        # Entries without a title are dropped, as are non-dicts.
        state = bridge_daemon.sanitize_state({"ok": True, "upNext": ["junk", {"index": 1}]})
        self.assertEqual(state["upNext"], [])

    def test_tristate_booleans_only_forwarded_when_boolean(self):
        state = bridge_daemon.sanitize_state({"ok": True, "shuffle": "true", "autoplay": False})
        self.assertNotIn("shuffle", state)
        self.assertIs(state["autoplay"], False)

    def test_play_descriptor_validated(self):
        good = bridge_daemon.sanitize_state({"ok": True, "play": {"kind": "song", "id": "i.abc", "catalogId": "42"}})
        self.assertEqual(good["play"], {"kind": "song", "id": "i.abc", "catalogId": "42"})
        bad = bridge_daemon.sanitize_state({"ok": True, "play": {"kind": "song", "id": "../../etc"}})
        self.assertIsNone(bad["play"])


class CommandFileTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dirfd = bridge_daemon.open_private_dir(os.path.join(self.tmp.name, "cmds"))

    def tearDown(self):
        os.close(self.dirfd)
        self.tmp.cleanup()

    def _write(self, name, data):
        with open(os.path.join(self.tmp.name, "cmds", name), "w") as handle:
            handle.write(data)

    def test_reads_small_json_object(self):
        self._write("cmd-1.json", json.dumps({"action": "rate", "value": 1}))
        payload = bridge_daemon.read_command_file(self.dirfd, "cmd-1.json")
        self.assertEqual(payload, {"action": "rate", "value": 1})

    def test_rejects_non_object_payload(self):
        self._write("cmd-1.json", "[1, 2, 3]")
        with self.assertRaises(ValueError):
            bridge_daemon.read_command_file(self.dirfd, "cmd-1.json")

    def test_rejects_oversized_file(self):
        self._write("cmd-1.json", '{"pad": "' + "x" * (bridge_daemon.MAX_COMMAND_BYTES + 10) + '"}')
        with self.assertRaises(ValueError):
            bridge_daemon.read_command_file(self.dirfd, "cmd-1.json")

    def test_rejects_symlink(self):
        target = os.path.join(self.tmp.name, "target.json")
        with open(target, "w") as handle:
            handle.write("{}")
        os.symlink(target, os.path.join(self.tmp.name, "cmds", "cmd-1.json"))
        with self.assertRaises(OSError):
            bridge_daemon.read_command_file(self.dirfd, "cmd-1.json")

    def test_rejects_fifo_without_blocking(self):
        os.mkfifo(os.path.join(self.tmp.name, "cmds", "cmd-1.json"))
        with self.assertRaises((OSError, ValueError)):
            bridge_daemon.read_command_file(self.dirfd, "cmd-1.json")

    def test_command_name_pattern(self):
        self.assertTrue(bridge_daemon.COMMAND_NAME.match("cmd-12.json"))
        self.assertIsNone(bridge_daemon.COMMAND_NAME.match("cmd.json.swp"))
        self.assertIsNone(bridge_daemon.COMMAND_NAME.match(""))


class OpenPrivateDirTest(unittest.TestCase):
    def test_creates_with_0700_and_tightens_existing(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "cmds")
            fd = bridge_daemon.open_private_dir(path)
            try:
                self.assertEqual(stat.S_IMODE(os.fstat(fd).st_mode), 0o700)
            finally:
                os.close(fd)
            os.chmod(path, 0o777)
            fd = bridge_daemon.open_private_dir(path)
            try:
                self.assertEqual(stat.S_IMODE(os.fstat(fd).st_mode), 0o700)
            finally:
                os.close(fd)

    def test_rejects_symlinked_dir(self):
        with tempfile.TemporaryDirectory() as tmp:
            real = os.path.join(tmp, "real")
            os.mkdir(real)
            link = os.path.join(tmp, "link")
            os.symlink(real, link)
            with self.assertRaises(OSError):
                bridge_daemon.open_private_dir(link)

    def test_rejects_intermediate_symlink_without_tightening_target(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = os.path.join(tmp, "root")
            victim_commands = os.path.join(tmp, "victim", "commands")
            os.mkdir(root)
            os.makedirs(victim_commands)
            os.chmod(victim_commands, 0o755)
            os.symlink(os.path.join(tmp, "victim"), os.path.join(root, "redirect"))

            with self.assertRaises(OSError):
                bridge_daemon.open_private_dir(os.path.join(root, "redirect", "commands"))
            self.assertEqual(stat.S_IMODE(os.stat(victim_commands).st_mode), 0o755)


class FrameLimitTest(unittest.TestCase):
    def test_oversized_declared_frame_rejected_before_buffering(self):
        client = bridge_daemon.CdpClient.__new__(bridge_daemon.CdpClient)
        # 127-length header declaring an absurd 2**62-byte payload; only the
        # 10 header bytes exist, so acceptance would mean buffering forever.
        client._buf = bytes([0x81, 0x7F]) + (2 ** 62).to_bytes(8, "big")
        client._sock = None  # must never be touched: header is fully buffered
        with self.assertRaises(bridge_daemon.ProtocolError):
            client._read_frame(deadline=0)

    def test_fragment_total_is_capped(self):
        client = bridge_daemon.CdpClient.__new__(bridge_daemon.CdpClient)
        half = bridge_daemon.MAX_WS_MESSAGE_BYTES // 2 + 100

        def frame64(first, size):
            return bytes([first, 0x7F]) + size.to_bytes(8, "big") + b"x" * size
        client._buf = frame64(0x01, half) + frame64(0x80, half)  # text + fin-continuation
        client._sock = None
        with self.assertRaises(bridge_daemon.ProtocolError):
            client._read_message(deadline=0)


class CloseClientTest(unittest.TestCase):
    def test_closes_and_clears(self):
        client = FakeClient()
        self.assertIsNone(bridge_daemon.close_client(client))
        self.assertTrue(client.closed)

    def test_none_is_safe(self):
        self.assertIsNone(bridge_daemon.close_client(None))


class PageUrlTest(unittest.TestCase):
    def test_canonical_urls_match(self):
        for url in (
            "https://music.apple.com",
            "https://music.apple.com/",
            "https://music.apple.com/us/browse",
            "https://music.apple.com/?l=en",
            "https://music.apple.com#now",
        ):
            self.assertTrue(bridge_daemon.PAGE_URL.match(url), url)

    def test_lookalike_hosts_and_schemes_rejected(self):
        for url in (
            "https://music.apple.com.evil.test/",
            "https://music.apple.comx/",
            "https://music.apple.com:8443/",
            "http://music.apple.com/",
            "https://evil.test/https://music.apple.com",
            "https://music.apple.com\n",
            "",
        ):
            self.assertIsNone(bridge_daemon.PAGE_URL.match(url), url)


if __name__ == "__main__":
    unittest.main()
