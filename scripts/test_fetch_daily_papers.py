"""Offline regression tests for arXiv pagination (stdlib only)."""
import importlib.util
import io
import json
import tempfile
from datetime import date, datetime, timezone
from urllib.error import HTTPError
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
        with patch.object(fetch, "http_get", side_effect=[feed, fetch.FetchError("HTTP 406")]) as get:
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

    def test_older_feed_is_pending_not_a_successful_zero(self):
        with patch.object(fetch, "http_get", return_value=atom(rows(0, 100, "2026-09-23"))) as get, self.assertRaises(fetch.ArxivPending):
            self.query()
        self.assertEqual(get.call_count, 1)

    def test_scan_limit_fails_instead_of_publishing_false_zero(self):
        with patch.object(fetch, "ARXIV_SCAN_LIMIT", 200), patch.object(
            fetch, "http_get", return_value=atom(rows(0, 100, "2026-09-25"))
        ), self.assertRaises(fetch.FetchError):
            self.query()

    def test_weekday_empty_feed_still_fails_after_retries(self):
        with patch.object(fetch, "http_get", return_value=atom([])) as get, self.assertRaises(fetch.FetchError):
            self.query()
        self.assertEqual(get.call_count, 4)

    def test_fetch_error_on_a_required_page_is_not_silently_ignored(self):
        pages = [atom(rows(0, 100, "2026-09-25")), fetch.FetchError("HTTP 406")]
        with patch.object(fetch, "http_get", side_effect=pages), self.assertRaises(fetch.FetchError):
            self.query()

    def test_historical_query_can_reach_beyond_the_recent_window(self):
        with patch.object(fetch, "http_get", return_value=atom(rows(0, 100, "2026-08-07"))) as get:
            papers = fetch.fetch_arxiv("2026-08-07", ["cs.AI"], 50, ["cs.AI"], date_query=True)
        self.assertEqual(len(papers), 50)
        query = parse_qs(urlsplit(get.call_args.args[0]).query)["search_query"][0]
        self.assertIn("submittedDate:[202608070000 TO 202608072359]", query)
        self.assertEqual(get.call_count, 1)

    def test_historical_query_rejects_wrong_dates(self):
        with patch.object(fetch, "http_get", return_value=atom(rows(0, 100))), self.assertRaises(fetch.FetchError):
            fetch.fetch_arxiv("2026-08-07", ["cs.AI"], 50, ["cs.AI"], date_query=True)

    def test_empty_historical_query_remains_pending(self):
        with patch.object(fetch, "http_get", return_value=atom([])) as get, self.assertRaises(fetch.ArxivPending):
            fetch.fetch_arxiv("2026-08-07", ["cs.AI"], 50, ["cs.AI"], date_query=True)
        self.assertEqual(get.call_count, 1)

    def test_historical_end_of_results_keeps_already_matched_papers(self):
        pages = [atom(rows(0, 10) + rows(10, 90, category="cs.CV")), atom([])]
        with patch.object(fetch, "http_get", side_effect=pages):
            result = fetch.fetch_arxiv("2026-09-24", ["cs.AI"], 50, ["cs.AI"], date_query=True)
        self.assertEqual(len(result), 10)


class TransportTests(unittest.TestCase):
    def test_406_uses_curl_without_discarding_the_response(self):
        url = "https://export.arxiv.org/api/query?start=500"
        error = HTTPError(url, 406, "Not Acceptable", {}, io.BytesIO())
        with patch.object(fetch, "pace_arxiv"), patch.object(fetch, "warn"), patch.object(
            fetch.urllib.request, "urlopen", side_effect=error
        ), patch.object(fetch, "curl_get", return_value=b"feed") as fallback:
            self.assertEqual(fetch.http_get(url), b"feed")
        fallback.assert_called_once_with(url)

    def test_403_does_not_try_another_client(self):
        url = "https://export.arxiv.org/api/query"
        error = HTTPError(url, 403, "Forbidden", {}, io.BytesIO())
        with patch.object(fetch, "pace_arxiv"), patch.object(
            fetch.urllib.request, "urlopen", side_effect=error
        ), patch.object(fetch, "curl_get") as fallback, self.assertRaises(fetch.FetchError):
            fetch.http_get(url)
        fallback.assert_not_called()

    def test_curl_failure_remains_a_failure(self):
        with patch.object(fetch, "pace_arxiv"), patch.object(fetch.shutil, "which", return_value="curl"), patch.object(
            fetch.subprocess, "run", return_value=fetch.subprocess.CompletedProcess([], 22, b"", b"HTTP 503")
        ), self.assertRaises(fetch.FetchError):
            fetch.curl_get("https://export.arxiv.org/api/query")

    def test_html_and_api_error_feeds_are_not_empty_paper_lists(self):
        with self.assertRaises(fetch.FetchError):
            fetch.parse_atom(b"<html><body>unavailable</body></html>")
        with self.assertRaises(fetch.FetchError):
            fetch.parse_atom(b'<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/api/errors#x</id><summary>Invalid query</summary></entry></feed>')


class AnnouncementTests(unittest.TestCase):
    def test_regular_weekday(self):
        self.assertEqual(fetch.arxiv_not_before(date(2026, 10, 1)).isoformat(), "2026-10-02T06:00:00+00:00")

    def test_friday_waits_until_monday(self):
        self.assertEqual(fetch.arxiv_not_before(date(2026, 10, 2)).isoformat(), "2026-10-05T06:00:00+00:00")

    def test_weekend_waits_until_tuesday(self):
        for day in (3, 4):
            self.assertEqual(fetch.arxiv_not_before(date(2026, 10, day)).isoformat(), "2026-10-06T06:00:00+00:00")

    def test_winter_uses_eastern_standard_time(self):
        self.assertEqual(fetch.arxiv_not_before(date(2026, 12, 4)).isoformat(), "2026-12-07T07:00:00+00:00")


def paper(pid, day="2026-09-25"):
    return {"id": pid, "title": "Paper " + pid, "published": day + "T12:00:00Z", "primaryCategory": "cs.AI"}


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.output = Path(self.tmp.name)
        self.hf_paper = {**paper("hf"), "titleZh": "原有标题", "summaryZh": "原有导读", "score": 8, "deepDive": True}
        patch.object(fetch, "warn").start()
        patch.dict(fetch.os.environ, {"GITHUB_ACTIONS": "false"}).start()
        self.addCleanup(patch.stopall)

    def save(self, day="2026-09-25", arxiv=None, status="pending"):
        digest = {"date": day, "categories": ["cs.AI"], "generatedAt": "2026-09-26T08:00:00+00:00",
                  "hf": [self.hf_paper.copy()], "arxiv": arxiv or [], "arxivStatus": status}
        (self.output / (day + ".json")).write_text(json.dumps(digest))
        return digest

    def read(self, day="2026-09-25"):
        return json.loads((self.output / (day + ".json")).read_text())

    def refresh(self, day="2026-09-25", now="2026-09-28T12:00:00+00:00", **kwargs):
        return fetch.refresh_digest(date.fromisoformat(day), ["cs.AI"], ["cs.AI"], 30, 50, str(self.output),
                                    now=datetime.fromisoformat(now), **kwargs)

    def test_friday_pending_then_recovers_on_monday_without_refetching_hf(self):
        with patch.object(fetch, "fetch_hf", return_value=[self.hf_paper.copy()]), patch.object(fetch, "fetch_arxiv") as get:
            changed, errors = self.refresh(now="2026-09-26T12:00:00+00:00")
        self.assertTrue(changed)
        self.assertEqual(errors, [])
        get.assert_not_called()
        self.assertEqual(self.read()["arxivStatus"], "pending")
        with patch.object(fetch, "fetch_hf") as hf, patch.object(fetch, "fetch_arxiv", return_value=[paper("new")]) as get:
            changed, errors = self.refresh(reuse_hf=True)
        hf.assert_not_called()
        self.assertTrue(get.call_args.kwargs["date_query"])
        self.assertTrue(changed)
        self.assertEqual(errors, [])
        recovered = self.read()
        self.assertEqual(recovered["hf"], [self.hf_paper])
        self.assertEqual(recovered["arxivStatus"], "complete")
        self.assertEqual(recovered["arxiv"][0]["id"], "new")

    def test_hf_only_run_keeps_complete_arxiv(self):
        old = self.save(arxiv=[paper("old")], status="complete")
        with patch.object(fetch, "fetch_hf", return_value=[paper("hf")]), patch.object(fetch, "fetch_arxiv") as get:
            changed, errors = self.refresh(skip_arxiv=True)
        self.assertEqual(self.read(), old)
        self.assertFalse(changed)
        self.assertEqual(errors, [])
        get.assert_not_called()

    def test_arxiv_failure_preserves_data_and_still_saves_new_hf(self):
        old = self.save(arxiv=[paper("old")], status="complete")
        with patch.object(fetch, "fetch_hf", return_value=[paper("hf"), paper("new-hf")]), patch.object(
            fetch, "fetch_arxiv", side_effect=fetch.FetchError("HTTP 503")
        ):
            changed, errors = self.refresh()
        self.assertTrue(changed)
        self.assertEqual(len(errors), 1)
        current = self.read()
        self.assertEqual(current["arxiv"], old["arxiv"])
        self.assertEqual(current["hf"][0], self.hf_paper)
        self.assertEqual(len(current["hf"]), 2)
        self.assertEqual(current["arxivStatus"], "error")

    def test_hf_failure_does_not_prevent_arxiv_recovery(self):
        self.save()
        with patch.object(fetch, "fetch_hf", side_effect=fetch.FetchError("HF down")), patch.object(
            fetch, "fetch_arxiv", return_value=[paper("new")]
        ):
            changed, errors = self.refresh()
        self.assertTrue(changed)
        self.assertEqual(len(errors), 1)
        self.assertEqual(self.read()["hf"], [self.hf_paper])
        self.assertEqual(self.read()["arxivStatus"], "complete")

    def test_empty_response_cannot_erase_complete_arxiv(self):
        old = self.save(arxiv=[paper("old")], status="complete")
        with patch.object(fetch, "fetch_arxiv", return_value=[]):
            changed, errors = self.refresh(reuse_hf=True)
        self.assertEqual(self.read(), old)
        self.assertFalse(changed)
        self.assertEqual(errors, [])

    def test_weekend_does_not_create_an_empty_archive_or_request_arxiv(self):
        with patch.object(fetch, "fetch_hf", return_value=[]), patch.object(fetch, "fetch_arxiv") as get:
            changed, errors = self.refresh(day="2026-10-03", now="2026-10-04T12:00:00+00:00")
        self.assertFalse(changed)
        self.assertEqual(errors, [])
        self.assertFalse(list(self.output.glob("*.json")))
        get.assert_not_called()

    def test_pending_noop_does_not_rewrite_generated_at(self):
        old = self.save(day="2026-10-02")
        changed, errors = self.refresh(day="2026-10-02", now="2026-10-04T12:00:00+00:00", reuse_hf=True)
        self.assertFalse(changed)
        self.assertEqual(errors, [])
        self.assertEqual(self.read("2026-10-02"), old)

    def test_catchup_includes_failed_old_dates_and_skips_complete_ones(self):
        self.save("2026-09-15")
        self.save("2026-09-25")
        self.save("2026-09-26", arxiv=[paper("retained")], status="error")
        self.save("2026-09-28", arxiv=[paper("done")], status="complete")
        self.save("2026-10-02")
        dates = fetch.catchup_dates(date(2026, 10, 3), str(self.output), 14)
        actual = {d.isoformat() for d in dates}
        self.assertTrue({"2026-09-25", "2026-09-26", "2026-09-27", "2026-10-02", "2026-10-03"} <= actual)
        self.assertNotIn("2026-09-28", actual)
        self.assertNotIn("2026-09-15", actual)

    def test_missing_weekend_archive_is_created_when_papers_become_available(self):
        with patch.object(fetch, "fetch_hf", return_value=[]), patch.object(fetch, "fetch_arxiv") as get:
            self.refresh(day="2026-09-26", now="2026-09-27T12:00:00+00:00")
        get.assert_not_called()
        self.assertFalse((self.output / "2026-09-26.json").exists())
        self.assertIn(date(2026, 9, 26), fetch.catchup_dates(date(2026, 9, 28), str(self.output), 3))
        with patch.object(fetch, "fetch_hf", return_value=[]), patch.object(
            fetch, "fetch_arxiv", return_value=[paper("weekend", "2026-09-26")]
        ):
            changed, errors = self.refresh(day="2026-09-26", now="2026-09-29T12:00:00+00:00")
        self.assertTrue(changed)
        self.assertEqual(errors, [])
        self.assertEqual(self.read("2026-09-26")["arxivStatus"], "complete")
        self.assertEqual(self.read("2026-09-26")["arxiv"][0]["id"], "weekend")

    def test_cli_records_all_changed_dates_even_when_one_source_fails(self):
        self.save("2026-09-25")
        self.save("2026-09-26", arxiv=[paper("complete-26", "2026-09-26")], status="complete")
        self.save("2026-09-27", arxiv=[paper("complete-27", "2026-09-27")], status="complete")
        changed_file = self.output / "changed.txt"
        argv = ["fetch-daily-papers.py", "--date", "2026-09-28", "--lookback-days", "3",
                "--output-dir", str(self.output), "--changed-dates-file", str(changed_file)]
        with patch.object(fetch.sys, "argv", argv), patch.object(fetch, "datetime", wraps=datetime) as clock, patch.object(
            fetch, "refresh_digest", side_effect=[(True, ["arXiv down"]), (True, [])]
        ) as refresh, self.assertRaises(SystemExit) as error:
            clock.now.return_value = datetime(2026, 9, 29, 12, tzinfo=timezone.utc)
            fetch.main()
        self.assertEqual(error.exception.code, 1)
        self.assertEqual(refresh.call_count, 2)
        self.assertEqual(changed_file.read_text(), "2026-09-25\n2026-09-28\n")
        self.assertTrue(refresh.call_args_list[0].kwargs["reuse_hf"])
        self.assertFalse(refresh.call_args_list[1].kwargs["reuse_hf"])

    def test_cli_fetches_both_sources_when_an_older_archive_is_missing(self):
        argv = ["fetch-daily-papers.py", "--date", "2026-09-28", "--lookback-days", "2",
                "--output-dir", str(self.output)]
        with patch.object(fetch.sys, "argv", argv), patch.object(fetch, "datetime", wraps=datetime) as clock, patch.object(
            fetch, "refresh_digest", return_value=(False, [])
        ) as refresh:
            clock.now.return_value = datetime(2026, 9, 29, 12, tzinfo=timezone.utc)
            fetch.main()
        self.assertEqual(refresh.call_count, 3)
        self.assertTrue(all(not call.kwargs["reuse_hf"] for call in refresh.call_args_list))


if __name__ == "__main__":
    unittest.main()
