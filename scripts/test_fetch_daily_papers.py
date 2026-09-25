"""Offline regression tests for arXiv pagination (stdlib only)."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit


spec = importlib.util.spec_from_file_location(
    "fetch_daily_papers", Path(__file__).with_name("fetch-daily-papers.py")
)
fetch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetch)


def atom(rows):
    entries = "".join(
        f"<entry><id>https://arxiv.org/abs/{pid}v1</id>"
        f"<published>{day}T12:00:00Z</published><title>Paper {pid}</title>"
        f'<arxiv:primary_category term="{category}"/></entry>'
        for pid, day, category in rows
    )
    return (
        '<feed xmlns="http://www.w3.org/2005/Atom" '
        f'xmlns:arxiv="http://arxiv.org/schemas/atom">{entries}</feed>'
    ).encode()


def rows(start, count, day="2026-09-24", category="cs.AI"):
    return [(f"2609.{i:05d}", day, category) for i in range(start, start + count)]


class ArxivPaginationTests(unittest.TestCase):
    def setUp(self):
        self.sleep = patch.object(fetch.time, "sleep").start()
        patch.object(fetch, "warn").start()
        # Small fixtures exercise the same full-page boundaries as production.
        patch.object(fetch, "ARXIV_PAGE_SIZE", 100).start()
        self.addCleanup(patch.stopall)

    def query(self, limit=50, day="2026-09-24"):
        return fetch.fetch_arxiv(day, ["cs.CL", "cs.LG", "cs.AI"], limit, ["cs.AI"])

    def test_does_not_request_failing_page_after_crossing_target_date(self):
        # The old script requested another page even though the target day was complete.
        feed = atom(rows(0, 10) + rows(10, 90, "2026-09-23"))
        with patch.object(fetch, "http_get", side_effect=[feed, SystemExit("HTTP 406")]) as get:
            self.assertEqual(len(self.query()), 10)
        self.assertEqual(get.call_count, 1)
        self.sleep.assert_not_called()

    def test_stops_when_limit_is_met(self):
        with patch.object(fetch, "http_get", return_value=atom(rows(0, 100))) as get:
            result = self.query()
        self.assertEqual(len(result), 50)
        self.assertEqual(result[-1]["id"], "2609.00049")
        self.assertEqual(get.call_count, 1)

    def test_keeps_paging_when_target_day_spans_pages(self):
        pages = [atom(rows(0, 100)), atom(rows(100, 30) + rows(130, 70, "2026-09-23"))]
        with patch.object(fetch, "http_get", side_effect=pages) as get:
            result = self.query(limit=150)
        self.assertEqual(len(result), 130)
        starts = [parse_qs(urlsplit(c.args[0]).query)["start"][0] for c in get.call_args_list]
        self.assertEqual(starts, ["0", "100"])
        self.sleep.assert_called_once_with(3)

    def test_cross_lists_and_duplicate_ids_do_not_fill_the_limit(self):
        pages = [
            atom(rows(0, 90, category="cs.CV") + rows(90, 10)),
            atom(rows(90, 10) + rows(100, 30) + rows(130, 60, "2026-09-23")),
        ]
        with patch.object(fetch, "http_get", side_effect=pages) as get:
            result = self.query()
        self.assertEqual(get.call_count, 2)
        self.assertEqual(len(result), 40)
        self.assertEqual(len({p["id"] for p in result}), 40)
        self.assertTrue(all(p["primaryCategory"] == "cs.AI" for p in result))

    def test_skips_newer_days_and_finds_target_on_later_page(self):
        pages = [atom(rows(0, 100, "2026-09-25")), atom(rows(100, 20))]
        with patch.object(fetch, "http_get", side_effect=pages) as get:
            result = self.query()
        self.assertEqual(get.call_count, 2)
        self.assertEqual(len(result), 20)
        self.assertTrue(all(p["published"].startswith("2026-09-24") for p in result))

    def test_complete_feed_can_have_no_papers_for_target_day(self):
        with patch.object(fetch, "http_get", return_value=atom(rows(0, 100, "2026-09-23"))) as get:
            self.assertEqual(self.query(), [])
        self.assertEqual(get.call_count, 1)

    def test_scan_limit_fails_instead_of_publishing_false_zero(self):
        with patch.object(fetch, "ARXIV_SCAN_LIMIT", 200), patch.object(
            fetch, "http_get", return_value=atom(rows(0, 100, "2026-09-25"))
        ), self.assertRaises(SystemExit):
            self.query()

    def test_weekday_empty_feed_still_fails_after_retries(self):
        with patch.object(fetch, "http_get", return_value=atom([])) as get, self.assertRaises(SystemExit):
            self.query()
        self.assertEqual(get.call_count, 4)

    def test_fetch_error_on_a_required_page_is_not_silently_ignored(self):
        pages = [atom(rows(0, 100, "2026-09-25")), SystemExit("HTTP 406")]
        with patch.object(fetch, "http_get", side_effect=pages), self.assertRaises(SystemExit):
            self.query()


if __name__ == "__main__":
    unittest.main()
