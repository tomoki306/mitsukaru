from app.catalog import catalog
from app.schemas import ConditionPrefs, LocationPref
from app.scoring import calc_axes, clarity, evaluate_condition, evaluate_metrics, match, rank

from .conftest import CHALLENGE, STABLE


def test_axes_range_and_direction():
    hi = calc_axes([5] * 8, catalog)
    lo = calc_axes([1] * 8, catalog)
    assert all(0 <= v <= 100 for v in hi.values())
    assert all(hi[k] >= lo[k] for k in ("expertise", "teamwork", "results", "freedom"))
    stable = calc_axes(STABLE, catalog)
    challenge = calc_axes(CHALLENGE, catalog)
    assert stable["stability"] > challenge["stability"]
    assert challenge["challenge"] > stable["challenge"]


def test_reverse_keyed_weight():
    # 「安定」を強く望むほど「挑戦」は少し下がる（逆向きの重み）
    a = calc_axes([5, 3, 3, 3, 3, 3, 3, 3], catalog)
    b = calc_axes([1, 3, 3, 3, 3, 3, 3, 3], catalog)
    assert a["challenge"] < b["challenge"]


def test_clarity():
    assert clarity([3, 3, 3, 3, 3, 3, 3, 4])["level"] == "low"
    assert clarity(STABLE)["level"] == "clear"


def test_conditions():
    kaname = catalog.get("kaname")
    kotoha = catalog.get("kotoha")
    p = ConditionPrefs(salary=650, location=LocationPref(regions=["関西"], noRelocation=True), remote="full")
    assert evaluate_condition(kaname, "salary", p)["status"] == "partial"   # 600万円 / 希望650万円
    assert evaluate_condition(kaname, "location", p)["status"] == "unmet"   # 関西に拠点なし・転勤あり
    assert evaluate_condition(kotoha, "location", p)["status"] == "met"     # フルリモート可・転勤なし
    assert evaluate_condition(kaname, "remote", p)["status"] == "partial"   # 一部可


def test_match_breakdown_and_ranking_changes_with_answers():
    p = ConditionPrefs(holidays=125)
    m = match(catalog.get("aoki"), calc_axes(STABLE, catalog), ["IT・ソフトウェア"], p, catalog)
    assert {c["key"] for c in m["components"]} == {"values", "conditions", "industry"}
    assert abs(sum(c["weight"] for c in m["components"]) - 1) < 0.02
    assert m["reason"].endswith("と合いそうです")

    def top(answers):
        return rank(catalog.companies(), calc_axes(answers, catalog), [], ConditionPrefs(), catalog, None, [], "match")[0]["company"]["id"]
    assert top(STABLE) != top(CHALLENGE)


def test_rank_filters_and_sorts():
    axes = calc_axes(STABLE, catalog)
    games = rank(catalog.companies(), axes, [], ConditionPrefs(), catalog, "ゲーム", [], "match")
    assert {r["company"]["id"] for r in games} == {"hoshinome", "minamo"}
    growth = rank(catalog.companies(), axes, [], ConditionPrefs(), catalog, None, [], "growth")
    assert growth[0]["company"]["id"] == "hoshinome"
    remote = rank(catalog.companies(), axes, [], ConditionPrefs(), catalog, None, ["remote"], "match")
    assert "shizuku" not in {r["company"]["id"] for r in remote}


def test_metrics_vs_industry_average():
    c = catalog.get("lupinus")
    ev = {e["key"]: e for e in evaluate_metrics(c, catalog.benchmark(c["industry"]), "x")}
    assert ev["opMargin"]["level"] == "caution"
    assert ev["revenue"]["level"] == "good"
    assert ev["opMargin"]["industryAvg"] == catalog.benchmark("IT・ソフトウェア")["opMargin"]
