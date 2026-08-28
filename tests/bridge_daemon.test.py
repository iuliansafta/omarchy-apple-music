#!/usr/bin/env python3
"""Pure-logic tests for scripts/bridge-daemon (no live Chromium needed).

Runs with the standard library unittest runner:

    python3 tests/bridge_daemon.test.py
"""

import importlib.util
import os
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


class CloseClientTest(unittest.TestCase):
    def test_closes_and_clears(self):
        client = FakeClient()
        self.assertIsNone(bridge_daemon.close_client(client))
        self.assertTrue(client.closed)

    def test_none_is_safe(self):
        self.assertIsNone(bridge_daemon.close_client(None))


if __name__ == "__main__":
    unittest.main()
