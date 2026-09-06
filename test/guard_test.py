#!/usr/bin/env python3
"""Tests for the two config guards in .github/workflows/worker-deploy.yml.

These run the *shipped* shell, extracted from the workflow, rather than a copy
of it pasted into a test. A copy passes forever after the original drifts, and
the whole point of these guards is to catch drift.

No YAML parser: pyyaml is not guaranteed on a runner, and the extraction only
needs "the indented block under `run: |` after this step's name".
"""
import os
import pathlib
import subprocess
import tempfile
import textwrap
import unittest

WORKFLOW = pathlib.Path(__file__).resolve().parent.parent / ".github/workflows/worker-deploy.yml"


def run_block(step_name: str) -> str:
    """Return the shell body of the `run: |` block belonging to a named step."""
    lines = WORKFLOW.read_text().splitlines()
    start = next(i for i, l in enumerate(lines) if l.strip() == f"- name: {step_name}")
    run_at = next(i for i in range(start, len(lines)) if lines[i].strip() == "run: |")
    indent = len(lines[run_at]) - len(lines[run_at].lstrip())
    body = []
    for line in lines[run_at + 1:]:
        if line.strip() and (len(line) - len(line.lstrip())) <= indent:
            break
        body.append(line)
    return textwrap.dedent("\n".join(body))


def bash(script: str, env: dict) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", "-c", script], env={**os.environ, **env},
        capture_output=True, text=True,
    )


class RequireVars(unittest.TestCase):
    SCRIPT = None

    @classmethod
    def setUpClass(cls):
        cls.SCRIPT = run_block("Required variables are set")

    def test_passes_when_every_named_variable_is_set(self):
        r = bash(self.SCRIPT, {"REPO_VARS": '{"A":"x","B":"y"}', "REQUIRED": "A B"})
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_fails_and_names_every_missing_variable_at_once(self):
        # All of them, not just the first — a guard that reports one name per
        # run turns a three-variable fix into three failed deploys.
        r = bash(self.SCRIPT, {"REPO_VARS": '{"A":"x"}', "REQUIRED": "A B C"})
        self.assertEqual(r.returncode, 1)
        self.assertIn("B", r.stdout)
        self.assertIn("C", r.stdout)

    def test_treats_an_empty_string_as_missing(self):
        # This is the blazon shape exactly: the Variable exists, so a presence
        # check reads green, but there is no value in it.
        r = bash(self.SCRIPT, {"REPO_VARS": '{"VITE_POSTHOG_KEY":""}', "REQUIRED": "VITE_POSTHOG_KEY"})
        self.assertEqual(r.returncode, 1)
        self.assertIn("VITE_POSTHOG_KEY", r.stdout)

    def test_accepts_a_comma_separated_list(self):
        r = bash(self.SCRIPT, {"REPO_VARS": '{"A":"x","B":"y"}', "REQUIRED": "A,B"})
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


class BuildMustMatch(unittest.TestCase):
    SCRIPT = None

    @classmethod
    def setUpClass(cls):
        cls.SCRIPT = run_block("Build output carries what it must")

    def _dist(self, contents: str | None):
        tmp = tempfile.mkdtemp()
        self.addCleanup(__import__("shutil").rmtree, tmp)
        out = pathlib.Path(tmp) / "dist"
        out.mkdir()
        if contents is not None:
            (out / "index-abc123.js").write_text(contents)
        return str(out)

    def test_passes_when_the_pattern_is_in_the_bundle(self):
        out = self._dist('const k="phc_Lqf4aBcDeFgHiJkLmNoPqRsTuVwXyZ0123";')
        r = bash(self.SCRIPT, {"PATTERN": "phc_[A-Za-z0-9]{20,}", "OUT_DIR": out})
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)

    def test_fails_when_the_variable_was_exported_but_never_read(self):
        # The wrong-prefix case, and the reason this guard exists on top of
        # require-vars: POSTHOG_KEY is exported by the Build step and silently
        # ignored by Vite, so the name appears in the bundle and the value does
        # not. require-vars cannot see this; only the artifact can.
        out = self._dist('const k=import.meta.env.VITE_POSTHOG_KEY;')
        r = bash(self.SCRIPT, {"PATTERN": "phc_[A-Za-z0-9]{20,}", "OUT_DIR": out})
        self.assertEqual(r.returncode, 1)
        self.assertIn("never read", r.stdout)

    def test_fails_loudly_when_the_output_directory_is_wrong(self):
        # Silently passing on a missing directory would make the guard useless
        # for every Hugo site, whose output is ./public rather than ./dist.
        r = bash(self.SCRIPT, {"PATTERN": "x", "OUT_DIR": "/nonexistent-build-dir"})
        self.assertEqual(r.returncode, 1)
        self.assertIn("does not exist", r.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
