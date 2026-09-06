#!/usr/bin/env python3
"""Tests for bin/new-site.

It is a script, not a module (no .py extension, has a shebang), so it is loaded
by path rather than imported. Everything tested here is pure.
"""
import importlib.machinery
import importlib.util
import sys
import pathlib
import shutil
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "bin" / "new-site"
spec = importlib.util.spec_from_loader(
    "new_site", importlib.machinery.SourceFileLoader("new_site", str(SCRIPT))
)
new_site = importlib.util.module_from_spec(spec)
# Register before executing: @dataclass resolves its own module out of
# sys.modules while the class body runs, and blows up with an opaque
# AttributeError on None if it is not there yet.
sys.modules["new_site"] = new_site
spec.loader.exec_module(new_site)


class Hints(unittest.TestCase):
    """The two Cloudflare failures whose own messages do not explain them."""

    def test_100117_points_at_the_leftover_dns_record(self):
        # Detaching from Pages leaves the CNAME; the attach then refuses it and
        # the site is already down. This cost kana a minute on 2026-09-05.
        hint = new_site._hint(400, [{"code": 100117, "message": "..."}])
        self.assertIn("dns_records", hint)
        self.assertIn("MIGRATE-FROM-PAGES.md", hint)

    def test_403_names_the_pages_scoped_token(self):
        self.assertIn("Pages-scoped", new_site._hint(403, [{"code": 10000}]))

    def test_unrelated_errors_get_no_hint(self):
        self.assertEqual(new_site._hint(500, [{"code": 1}]), "")
        self.assertEqual(new_site._hint(404, []), "")

    def test_100117_wins_over_the_status_hint(self):
        # A 403 carrying 100117 is the DNS problem, not a token problem.
        self.assertIn("dns_records", new_site._hint(403, [{"code": 100117}]))


class Substitution(unittest.TestCase):
    def test_applies_every_placeholder(self):
        out = new_site._apply_all(
            {"{{NAME}}": "kana", "{{DOMAIN}}": "kana.gfrm.in"},
            "name={{NAME}} host={{DOMAIN}} again={{NAME}}",
        )
        self.assertEqual(out, "name=kana host=kana.gfrm.in again=kana")

    def test_leaves_unknown_placeholders_alone(self):
        # So a template gaining a placeholder fails loudly (visible {{X}} in the
        # output) rather than silently producing an empty string.
        self.assertEqual(new_site._apply_all({}, "{{UNKNOWN}}"), "{{UNKNOWN}}")


class AnalyticsGate(unittest.TestCase):
    """--no-analytics must remove the gate cleanly, and only the gate."""

    def _scaffolded(self, body):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp)
        workflow = pathlib.Path(tmp) / ".github" / "workflows" / "deploy.yml"
        workflow.parent.mkdir(parents=True)
        workflow.write_text(body)
        return pathlib.Path(tmp), workflow

    def test_removes_both_gate_lines_and_keeps_the_rest(self):
        target, workflow = self._scaffolded(
            "jobs:\n"
            "  deploy:\n"
            "    with:\n"
            "      build: npm run build\n"
            "      require-vars: VITE_POSTHOG_KEY\n"
            "      build-must-match: 'phc_[A-Za-z0-9]{20,}'\n"
            "    secrets: inherit\n"
        )
        new_site.drop_analytics(target)
        out = workflow.read_text()

        self.assertNotIn("require-vars", out)
        self.assertNotIn("build-must-match", out)
        # Everything else survives, including the trailing line — a gate remover
        # that eats `secrets: inherit` breaks the deploy in a way that looks
        # nothing like analytics.
        self.assertIn("build: npm run build", out)
        self.assertIn("secrets: inherit", out)

    def test_is_a_no_op_when_the_gate_is_already_absent(self):
        # So a re-run, or a template that never had the gate, is harmless.
        body = "jobs:\n  deploy:\n    with:\n      build: npm run build\n"
        target, workflow = self._scaffolded(body)
        new_site.drop_analytics(target)
        self.assertEqual(workflow.read_text(), body)

    def test_does_not_match_a_variable_that_merely_mentions_the_name(self):
        # `require-vars` is matched as a key at the start of a line, so a build
        # command or comment containing the word is left alone.
        body = "    with:\n      build: echo require-vars is a key not a word\n"
        target, workflow = self._scaffolded(body)
        new_site.drop_analytics(target)
        self.assertEqual(workflow.read_text(), body)


if __name__ == "__main__":
    unittest.main(verbosity=2)
