"""Offline tests for score-based selection and the judge flow (stdlib only)."""
import importlib.util
import json
import tempfile
from datetime import date, datetime
from pathlib import Path
import unittest
import unittest.mock
from unittest.mock import patch

import digest_select as sel


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fetch = load("fetch_daily_papers_sel", "fetch-daily-papers.py")
judge = load("summarize_digest", "summarize-digest.py")


def paper(n, score=None, track=None, category="cs.AI"):
    p = {"id": f"2611.{n:05d}", "title": f"Paper {n}", "published": "2026-11-10T12:00:00Z",
         "primaryCategory": category, "abstract": "long abstract", "urls": {"abs": "a", "pdf": "p"}}
    if score is not None:
        p["score"] = score
    if track:
        p["track"] = track
    return p


class SelectTests(unittest.TestCase):
    def test_unjudged_pool_shows_newest_main_papers_and_keeps_the_rest_waiting(self):
        pool = [paper(i) for i in range(60)] + [paper(100, category="cs.RO", track="embodied")]
        out = sel.select(pool)
        self.assertEqual([p["id"] for p in out["arxiv"]], [p["id"] for p in pool[:50]])
        self.assertEqual(len(out["candidates"]), 11)
        self.assertNotIn("embodied", out)
        self.assertEqual(out["pool"], {"main": 60, "embodied": 1})

    def test_picks_by_score_with_floor_and_cap(self):
        pool = [paper(i, 9) for i in range(40)] + [paper(100 + i, 7) for i in range(30)]
        pool += [paper(200 + i, 6.5) for i in range(5)] + [paper(300 + i, 2) for i in range(5)]
        out = sel.select(pool)
        self.assertEqual(len(out["arxiv"]), 50)
        self.assertEqual(sum(p["score"] == 9 for p in out["arxiv"]), 40)
        self.assertTrue(all(p["score"] >= 7 for p in out["arxiv"]))
        # 20 more cleared the floor but not the cap: listed compactly, without abstracts
        self.assertEqual(len(out["overflow"]), 20)
        self.assertNotIn("abstract", out["overflow"][0])
        self.assertEqual(len(out["scores"]["main"]), 30)
        self.assertEqual(out["candidates"], [])

    def test_floor_can_leave_a_section_empty(self):
        out = sel.select([paper(1, 6.5), paper(2, 3)])
        self.assertEqual(out["arxiv"], [])
        self.assertEqual(out["overflow"], [])
        self.assertEqual(set(out["scores"]["main"]), {"2611.00001", "2611.00002"})

    def test_tracks_have_separate_caps_and_do_not_compete(self):
        pool = [paper(i, 8) for i in range(55)] + [paper(500 + i, 9, track="embodied") for i in range(12)]
        out = sel.select(pool)
        self.assertEqual(len(out["arxiv"]), 50)
        self.assertEqual(len(out["embodied"]), 10)
        self.assertTrue(all(p.get("track") == "embodied" for p in out["embodied"]))
        self.assertEqual(len(out["scores"]["embodied"]), 2)

    def test_unjudged_papers_never_displace_judged_ones(self):
        out = sel.select([paper(1, 8), paper(2), paper(3, 4)])
        self.assertEqual([p["id"] for p in out["arxiv"]], ["2611.00001"])
        self.assertEqual([p["id"] for p in out["candidates"]], ["2611.00002"])

    def test_ties_are_ordered_deterministically(self):
        pool = [paper(i, 8) for i in (3, 1, 2)]
        first = [p["id"] for p in sel.select(pool)["arxiv"]]
        self.assertEqual(first, [p["id"] for p in sel.select(list(reversed(pool)))["arxiv"]])
        self.assertEqual(first[0], "2611.00003")

    def test_apply_omits_empty_fields(self):
        digest = sel.apply({"date": "2026-11-10", "hf": [], "candidates": [paper(9)]}, [paper(1, 8)])
        self.assertEqual(set(digest), {"date", "hf", "arxiv", "pool"})

    def test_restore_scores_brings_back_score_and_track(self):
        papers = [paper(1), paper(2), paper(3)]
        sel.restore_scores(papers, {"scores": {"main": {"2611.00001": 3}, "embodied": {"2611.00002": 8}}})
        self.assertEqual(papers[0]["score"], 3)
        self.assertEqual((papers[1]["score"], papers[1]["track"]), (8, "embodied"))
        self.assertNotIn("score", papers[2])


class RerunTests(unittest.TestCase):
    """A second run on the same day must not re-judge or reshuffle anything."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.out = Path(self.tmp.name)
        patch.object(fetch, "warn").start()
        patch.object(fetch, "fetch_hf", return_value=[]).start()
        patch.dict(fetch.os.environ, {"GITHUB_ACTIONS": "false"}).start()
        self.addCleanup(patch.stopall)
        self.path = self.out / "2026-11-10.json"

    def refresh(self, papers, now="2026-11-12T12:00:00+00:00"):
        with patch.object(fetch, "fetch_arxiv", return_value=[dict(p) for p in papers]):
            return fetch.refresh_digest(date(2026, 11, 10), ["cs.AI", "cs.RO"], ["cs.AI", "cs.RO"], 30, 1500,
                                        str(self.out), now=datetime.fromisoformat(now))

    def judge_all(self, scores):
        digest = json.loads(self.path.read_text())
        pool = sel.pool_of(digest)
        for p in pool:
            p.update(score=scores[p["id"]], titleZh="标题", summaryZh="导读")
        self.path.write_text(json.dumps(sel.apply(digest, pool)))

    def test_rerun_restores_scores_and_only_new_candidates_wait(self):
        fetched = [paper(i) for i in range(70)] + [paper(900, category="cs.RO")]
        changed, _ = self.refresh(fetched)
        self.assertTrue(changed)
        first = json.loads(self.path.read_text())
        self.assertEqual(len(first["arxiv"]) + len(first["candidates"]), 71)
        self.assertEqual(first["pool"], {"main": 70, "embodied": 1})

        scores = {p["id"]: (8 if i < 55 else 3) for i, p in enumerate(fetched)}
        self.judge_all(scores)
        judged = self.path.read_text()
        self.assertEqual(len(json.loads(judged)["arxiv"]), 50)

        # same candidates again: nothing to judge, file untouched
        changed, _ = self.refresh(fetched, now="2026-11-12T18:00:00+00:00")
        self.assertFalse(changed)
        self.assertEqual(self.path.read_text(), judged)

        # one late-indexed paper: only that one waits for the judge
        changed, _ = self.refresh(fetched + [paper(777)], now="2026-11-13T12:00:00+00:00")
        self.assertTrue(changed)
        after = json.loads(self.path.read_text())
        self.assertEqual([p["id"] for p in after["candidates"]], ["2611.00777"])
        self.assertEqual([p["id"] for p in after["arxiv"]], [p["id"] for p in json.loads(judged)["arxiv"]])
        self.assertEqual(after["arxiv"][0]["summaryZh"], "导读")

    def test_partial_api_reply_cannot_remove_papers_already_in_the_digest(self):
        fetched = [paper(i) for i in range(5)]
        self.refresh(fetched)
        self.judge_all({p["id"]: 9 for p in fetched})
        changed, _ = self.refresh(fetched[:2], now="2026-11-13T12:00:00+00:00")
        self.assertFalse(changed)
        self.assertEqual(len(json.loads(self.path.read_text())["arxiv"]), 5)

    def test_recheck_revisits_recent_complete_days_of_the_new_format_only(self):
        new_format = {"date": "x", "hf": [], "arxiv": [paper(1, 8)], "arxivStatus": "complete",
                      "pool": {"main": 1, "embodied": 0}}
        (self.out / "2026-11-11.json").write_text(json.dumps(new_format))
        (self.out / "2026-11-10.json").write_text(json.dumps({k: v for k, v in new_format.items() if k != "pool"}))
        (self.out / "2026-11-07.json").write_text(json.dumps(new_format))
        dates = {d.isoformat() for d in fetch.catchup_dates(date(2026, 11, 12), str(self.out), 0, recheck=3)}
        self.assertEqual(dates, {"2026-11-12", "2026-11-11"})
        self.assertEqual(len(fetch.catchup_dates(date(2026, 11, 12), str(self.out), 0)), 1)

    def test_complete_day_with_no_picks_is_not_refetched(self):
        self.path.write_text(json.dumps({"date": "2026-11-10", "hf": [paper(1)], "arxiv": [],
                                         "arxivStatus": "complete", "scores": {"main": {"2611.00002": 3}}}))
        self.assertNotIn(date(2026, 11, 10), fetch.catchup_dates(date(2026, 11, 12), str(self.out), 5)[:-1])


def verdict(score, deep=False):
    return {"titleZh": "标题", "summaryZh": "导读", "score": score, "reason": "依据",
            "deepDive": deep and score >= 8}


def routing_reply(flagged):
    body = json.dumps({"choices": [{"message": {"content": json.dumps({"embodied": flagged})}}]}).encode()
    reply = unittest.mock.MagicMock()
    reply.__enter__.return_value.read.return_value = body
    return reply


class JudgeTests(unittest.TestCase):
    profiles = {"main": "MAIN", "embodied": "EMB"}

    def run_judge(self, target, verdicts, stabilize=True):
        with patch.object(judge, "call_deepseek", side_effect=verdicts) as call:
            result = judge.judge_paper("key", target, self.profiles, stabilize)
        return result, [c.args[2] for c in call.call_args_list]

    def test_clear_scores_are_judged_once(self):
        result, used = self.run_judge(paper(1), [verdict(3)])
        self.assertEqual(used, ["MAIN"])
        self.assertEqual((result["score"], result["relevant"]), (3, False))

    def test_borderline_score_is_judged_twice_and_averaged(self):
        result, used = self.run_judge(paper(1), [verdict(7), verdict(8)])
        self.assertEqual(used, ["MAIN", "MAIN"])
        self.assertEqual(result["score"], 7.5)
        result, _ = self.run_judge(paper(1), [verdict(6), verdict(8)])
        self.assertEqual((result["score"], type(result["score"])), (7, int))

    def test_second_opinion_is_skipped_for_hf_and_survives_a_failed_call(self):
        result, used = self.run_judge(paper(1), [verdict(7)], stabilize=False)
        self.assertEqual((result["score"], len(used)), (7, 1))
        result, used = self.run_judge(paper(1), [verdict(7), None])
        self.assertEqual((result["score"], len(used)), (7, 2))

    def test_deep_dive_needs_the_final_score_to_reach_eight(self):
        result, _ = self.run_judge(paper(1), [verdict(8, deep=True), verdict(7)])
        self.assertFalse(result["deepDive"])

    def test_embodied_track_is_judged_with_the_embodied_profile(self):
        result, used = self.run_judge(paper(1, track="embodied", category="cs.RO"), [verdict(9)])
        self.assertEqual(used, ["EMB"])
        self.assertEqual(result["score"], 9)

    def test_scoring_prompt_does_not_ask_for_the_topic_flag(self):
        # Adding an output field to the scoring prompt shifted scores by about -0.2.
        self.assertNotIn("embodied", judge.SYSTEM_PROMPT)

    def test_merge_keeps_an_existing_final_score_when_only_text_is_needed(self):
        target = paper(1, 7.5)
        judge.merge_judgement(target, verdict(9), keep_score=True)
        self.assertEqual((target["score"], target["summaryZh"]), (7.5, "导读"))

    def test_merge_does_not_undo_routing(self):
        target = paper(1, track="embodied")
        judge.merge_judgement(target, verdict(8), keep_score=False)
        self.assertEqual((target["score"], target["track"]), (8, "embodied"))


class RoutingTests(unittest.TestCase):
    def setUp(self):
        patch.object(judge, "warn").start()
        patch.object(judge.time, "sleep").start()
        self.addCleanup(patch.stopall)

    def test_flagged_papers_move_to_the_embodied_track(self):
        papers = [paper(1), paper(2), paper(3)]
        with patch.object(judge.urllib.request, "urlopen", return_value=routing_reply([2, 99, "x"])):
            judge.route_embodied("key", papers)
        self.assertEqual([sel.track_of(p) for p in papers], ["main", "embodied", "main"])

    def test_routing_failure_keeps_papers_on_the_main_track(self):
        papers = [paper(1), paper(2)]
        with patch.object(judge.urllib.request, "urlopen", side_effect=OSError("down")):
            judge.route_embodied("key", papers)
        self.assertEqual([sel.track_of(p) for p in papers], ["main", "main"])


class JudgeCliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "2026-11-10.json"
        patch.object(judge, "warn").start()
        self.addCleanup(patch.stopall)

    def run_cli(self, digest, verdicts, key="key", route=None):
        self.path.write_text(json.dumps(digest))
        argv = ["summarize-digest.py", "2026-11-10", "--output-dir", self.tmp.name, "--workers", "1"]
        with patch.object(judge.sys, "argv", argv), patch.object(judge, "load_env_key", return_value=key), \
                patch.object(judge, "route_embodied", side_effect=route), \
                patch.object(judge, "call_deepseek", side_effect=verdicts) as call:
            try:
                judge.main()
            except SystemExit as exit_:
                self.assertEqual(exit_.code, 0)
        return json.loads(self.path.read_text()), call.call_count

    def test_candidates_are_judged_selected_and_cleared(self):
        digest = {"date": "2026-11-10", "hf": [], "arxiv": [paper(1)], "candidates": [paper(2), paper(3)],
                  "pool": {"main": 3, "embodied": 0}}
        by_title = {"Paper 1": verdict(9), "Paper 2": verdict(3), "Paper 3": verdict(9)}
        out, _ = self.run_cli(digest, lambda key, p, profile: dict(by_title[p["title"]]),
                              route=lambda key, papers: papers[2].update(track="embodied"))
        self.assertEqual([p["id"] for p in out["arxiv"]], ["2611.00001"])
        self.assertEqual([p["id"] for p in out["embodied"]], ["2611.00003"])
        self.assertEqual(out["scores"], {"main": {"2611.00002": 3}})
        self.assertNotIn("candidates", out)

    def test_without_a_key_waiting_candidates_are_dropped_not_committed(self):
        digest = {"date": "2026-11-10", "hf": [], "arxiv": [paper(1)], "candidates": [paper(2)],
                  "pool": {"main": 2, "embodied": 0}}
        out, calls = self.run_cli(digest, [], key=None)
        self.assertEqual(calls, 0)
        self.assertNotIn("candidates", out)
        self.assertEqual(len(out["arxiv"]), 1)

    def test_digests_from_before_the_change_are_not_reselected(self):
        old = {"date": "2026-11-10", "hf": [], "arxiv": [
            {**paper(1, 3), "titleZh": "a", "summaryZh": "b", "relevant": False},
            {**paper(2, 8), "titleZh": "a", "summaryZh": "b"}]}
        out, calls = self.run_cli(old, [])
        self.assertEqual(calls, 0)
        self.assertEqual(out, old)


if __name__ == "__main__":
    unittest.main()
