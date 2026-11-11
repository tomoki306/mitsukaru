"""
根拠（evidence）の組み立て。

根拠の一覧は、AI ではなくデータから決まった手順で作る。AI には「この番号の根拠だけを使って書く」よう指示し、
返ってきた文章の根拠番号がこの一覧に存在するかを guard.py で検査する。出典をAIに作らせないための仕組み。
"""

from typing import Any

from ..catalog import Catalog, Company
from ..schemas import AXIS_KEYS
from ..scoring import revenue_cagr

Evidence = dict[str, Any]


def _ev(items: list[tuple[str, str, str]]) -> list[Evidence]:
    return [{"id": i + 1, "label": label, "value": value, "source": source} for i, (label, value, source) in enumerate(items)]


def short_name(c: Company) -> str:
    return c["name"].replace("株式会社", "")


def commentary_evidence(c: Company, axes: dict[str, int], match: dict[str, Any], bench: dict[str, float], catalog: Catalog) -> list[Evidence]:
    m = c["metrics"]
    latest = c["history"][-1]
    bad = [e for e in c["events"] if e["tone"] == "bad"]
    top = sorted(AXIS_KEYS, key=lambda k: -axes[k])[:2]
    comps = "・".join(f"{x['label']}{x['score']}点" for x in match["components"])
    events_value = f"{bad[0]['year']}年 {bad[0]['title']} ほか全{len(c['events'])}件" if bad else f"全{len(c['events'])}件（大きな問題の記録なし）"
    return _ev([
        ("事業内容", c["summaryLine"], "会社ウェブサイト・統合報告書（サンプル）"),
        ("売上・営業利益（5年分）",
         f"{latest['year']}年度 売上{latest['revenue']:,}億円／営業利益{latest['profit']:,}億円（年平均成長率{revenue_cagr(c):+.1f}%）",
         "有価証券報告書 2021〜2025年度（サンプル）"),
        ("営業利益率・自己資本比率",
         f"{m['opMargin']}%／{m['equityRatio']}%（業界平均 {bench['opMargin']}%／{bench['equityRatio']}%）",
         f"有価証券報告書 2025年度（サンプル）・{catalog.meta['benchmarkSource']}"),
        ("過去の出来事", events_value, "会社発表・報道の要約（サンプル）"),
        ("社風・口コミ",
         f"投稿{c['reviews']['count']}件を要約（良い声{len(c['reviews']['good'])}件・気になる声{len(c['reviews']['concern'])}件）",
         "口コミ要約（サンプル）"),
        ("あなたの診断結果と相性",
         "／".join(f"{catalog.axis_label(k)} {axes[k]}" for k in top) + f"・相性スコア{match['score']}%（{comps}）",
         "ミツカル価値観診断（8問の回答）"),
    ])


def followup_evidence(c: Company, question: str, peers: list[Company], bench: dict[str, float], catalog: Catalog) -> list[Evidence]:
    m = c["metrics"]
    if question == "weakness":
        bad = [f"{e['year']}年 {e['title']}" for e in c["events"] if e["tone"] == "bad"]
        return _ev([
            ("事業等のリスク（要約）", c["faq"]["weakness"], "有価証券報告書「事業等のリスク」（サンプル）"),
            ("気になる出来事", "／".join(bad) or "記録なし", "会社発表・報道の要約（サンプル）"),
            ("気になる声", "／".join(c["reviews"]["concern"]), "口コミ要約（サンプル）"),
        ])
    if question == "workstyle":
        return _ev([
            ("入社後の働き方（要約）", c["faq"]["workstyle"], "採用ページ（サンプル）"),
            ("制度", f"年間休日{c['holidays']}日・リモート{c['remote']}・研修{'充実' if c['training'] else 'OJT中心'}・転勤{'なし' if c['noRelocation'] else 'あり'}",
             "採用ページ（サンプル）"),
            ("口コミ", f"良い声「{c['reviews']['good'][0]}」／気になる声「{c['reviews']['concern'][0]}」", "口コミ要約（サンプル）"),
        ])
    if question == "future":
        hist = "→".join(f"{h['revenue']:,}" for h in c["history"])
        last = c["events"][-1]
        return _ev([
            ("今後の方針（要約）", c["faq"]["future"], "中期経営計画（サンプル）"),
            ("売上の推移（億円）", f"{c['history'][0]['year']}〜{c['history'][-1]['year']}年度：{hist}", "有価証券報告書 2021〜2025年度（サンプル）"),
            ("最近の出来事", f"{last['year']}年 {last['title']}", "会社発表・報道の要約（サンプル）"),
        ])
    # peers：同業他社・業界平均との比較
    def row(x: Company) -> str:
        xm = x["metrics"]
        return f"営業利益率{xm['opMargin']}%・自己資本比率{xm['equityRatio']}%・平均年収{xm['avgSalary']}万円・売上の伸び年{revenue_cagr(x):+.1f}%"
    items = [(short_name(c), row(c), "有価証券報告書 2025年度（サンプル）")]
    items += [(f"同業：{short_name(p)}", row(p), "有価証券報告書 2025年度（サンプル）") for p in peers]
    items.append((f"{c['industry']}の業界平均",
                  f"営業利益率{bench['opMargin']}%・自己資本比率{bench['equityRatio']}%・平均年収{bench['avgSalary']}万円・売上の伸び年+{bench['revenueGrowth']}%",
                  catalog.meta["benchmarkSource"]))
    return _ev(items)


def compare_evidence(companies: list[Company], matches: dict[str, dict[str, Any]], axes: dict[str, int], selected_labels: list[str], catalog: Catalog) -> list[Evidence]:
    items = []
    for c in companies:
        mm = c["metrics"]
        items.append((
            short_name(c),
            f"相性{matches[c['id']]['score']}%・平均年収{mm['avgSalary']}万円・年間休日{c['holidays']}日・リモート{c['remote']}・"
            f"研修{'充実' if c['training'] else 'OJT中心'}・転勤{'なし' if c['noRelocation'] else 'あり'}・拠点{'／'.join(o['city'] for o in c['offices'])}",
            "比較表（有価証券報告書 2025年度・採用情報、サンプル）",
        ))
    top = sorted(AXIS_KEYS, key=lambda k: -axes[k])[:2]
    items.append(("あなたの診断結果と重視する条件",
                  "／".join(f"{catalog.axis_label(k)} {axes[k]}" for k in top) + "・重視する条件：" + ("、".join(selected_labels) or "未選択"),
                  "ミツカル価値観診断（8問の回答）"))
    return _ev(items)


def company_facts(c: Company, bench: dict[str, float]) -> dict[str, Any]:
    """AI に渡す企業データ（根拠の詳しい中身）"""
    return {
        "name": c["name"], "industry": c["industry"], "overview": c["overview"], "summary": c["summaryLine"],
        "metrics": c["metrics"], "history": c["history"], "revenueGrowthPct": revenue_cagr(c),
        "industryAverage": bench, "events": c["events"], "reviews": c["reviews"], "culture": c["culture"],
        "holidays": c["holidays"], "remote": c["remote"], "noRelocation": c["noRelocation"], "training": c["training"],
        "offices": c["offices"], "tags": c["tags"],
    }
