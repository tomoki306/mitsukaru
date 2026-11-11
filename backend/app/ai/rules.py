"""
ルールベースの解説。

Claude API が使えないとき（APIキー未設定・通信エラー・出力が検査に通らない・利用回数の上限）に使う。
データから決まった手順で文章を組み立てるので、内容は常に根拠と一致し、断定しない書き方を守る。
"""

from typing import Any

from ..catalog import Catalog, Company
from ..scoring import revenue_cagr
from .evidence import short_name


def _cmp(mine: float, avg: float) -> str:
    if mine > avg * 1.05:
        return "高め"
    if mine < avg * 0.95:
        return "低め"
    return "同程度"


def commentary(c: Company, match: dict[str, Any], bench: dict[str, float], catalog: Catalog) -> dict[str, Any]:
    m = c["metrics"]
    g = revenue_cagr(c)
    bg = bench["revenueGrowth"]
    bad = next((e for e in c["events"] if e["tone"] == "bad"), None)
    later_good = next((e for e in c["events"] if bad and e["tone"] == "good" and e["year"] >= bad["year"] and e is not bad), None)
    had_loss = any(h["profit"] < 0 for h in c["history"])

    above_m = m["opMargin"] >= bench["opMargin"]
    above_e = m["equityRatio"] >= bench["equityRatio"]
    if above_m and above_e:
        fin = "本業の稼ぐ力も財務の安定性も業界平均を上回っており、経営は安定した水準と考えられます。"
    elif above_e:
        fin = "財務の安定性は業界平均以上ですが、稼ぐ力は業界平均を下回っており、利益率の改善が課題の可能性があります。"
    elif above_m:
        fin = "本業の稼ぐ力は業界平均以上ですが、自己資本比率は低めで、借入などに頼る部分がある可能性があります。"
    else:
        fin = "利益率・自己資本比率ともに業界平均を下回っており、成長のための投資を優先している段階の可能性があります。"

    if g >= bg + 3:
        growth = f"過去5年の売上は年平均{g:+.1f}%と業界平均（年+{bg:.1f}%）を上回って伸びており、{'途中に赤字の年もありましたが、' if had_loss else ''}成長が続いている可能性があります。"
    elif g >= bg - 2:
        growth = f"過去5年の売上は年平均{g:+.1f}%と業界平均並みのペースで、{'一時は赤字でしたが回復傾向と考えられます。' if had_loss else '大きなぶれは少ないと考えられます。'}"
    else:
        growth = f"過去5年の売上は年平均{g:+.1f}%と業界平均（年+{bg:.1f}%）より伸びが小さく、{'途中に赤字の年もあるため、' if had_loss else ''}今後の伸びは慎重に見る必要があると考えられます。"

    if bad:
        history = f"{bad['year']}年に「{bad['title']}」がありましたが、" + (
            f"その後「{later_good['title']}」など、立て直しの動きも見られると考えられます。" if later_good
            else "その影響が今も残っていないか、確認が必要と考えられます。")
    else:
        history = "大きな問題の記録は見当たらず、落ち着いた経営が続いている可能性があります。"

    culture = f"口コミでは「{c['reviews']['good'][0]}」という声がある一方、「{c['reviews']['concern'][0]}」という声もあり、人によって合う・合わないが分かれる点と考えられます。"

    # あなたとの相性
    best = match["bestAxis"]
    fit = f"回答からは「{catalog.axis_label(best)}」を重視する傾向が見えます。{c['reasons'][best]}は、その傾向と合う可能性があります。"
    if match["gaps"]:
        gap = match["gaps"][0]
        fit += f"一方で「{catalog.axis_label(gap)}」は、あなたの希望に比べてこの会社の特徴が控えめなため、{catalog.axis(gap)['gapAdvice']}と考えられます。"
    else:
        fit += "大きくずれている軸は少なく、全体として相性は悪くない可能性があります。"
    met = "".join(f"「{x['label']}」" for x in match["conditions"] if x["status"] == "met")
    unmet = "".join(f"「{x['label']}」" for x in match["conditions"] if x["status"] != "met")
    if met and unmet:
        fit += f"重視する条件のうち{met}は満たしている可能性があり、{unmet}は希望と異なる部分があるかもしれません。"
    elif met:
        fit += f"重視する条件{met}は満たしている可能性があります。"
    elif unmet:
        fit += f"重視する条件{unmet}は希望と異なる部分があるかもしれません。"

    return {
        "lines": [
            {"text": f"{c['name']}は、{c['summaryLine']}で稼いでいる会社です。", "refs": [1]},
            {"text": f"営業利益率{m['opMargin']}%・自己資本比率{m['equityRatio']}%で、{fin}", "refs": [3]},
            {"text": growth, "refs": [2]},
            {"text": history, "refs": [4]},
            {"text": culture, "refs": [5]},
        ],
        "fit": {"text": fit, "refs": [6]},
    }


def followup(c: Company, question: str, peers: list[Company], bench: dict[str, float], n_evidence: int) -> dict[str, Any]:
    if question in ("weakness", "workstyle", "future"):
        return {"text": c["faq"][question], "refs": [1, 2]}
    m = c["metrics"]
    text = (f"{short_name(c)}を{c['industry']}の業界平均（サンプル値）と比べると、"
            f"営業利益率は{m['opMargin']}%で{_cmp(m['opMargin'], bench['opMargin'])}、"
            f"自己資本比率は{m['equityRatio']}%で{_cmp(m['equityRatio'], bench['equityRatio'])}、"
            f"平均年収は{m['avgSalary']}万円で{_cmp(m['avgSalary'], bench['avgSalary'])}です。")
    if peers:
        group = [c, *peers]
        rank = sorted(group, key=lambda x: -x["metrics"]["opMargin"]).index(c) + 1
        text += (f"同じ業界のサンプル企業（{'、'.join(short_name(p) for p in peers)}）を含めた{len(group)}社の中では、"
                 f"営業利益率が{rank}番目に高い水準です。")
    text += "数字だけで良し悪しは決まらないため、事業の違いもあわせて見る必要があると考えられます。"
    return {"text": text, "refs": list(range(1, n_evidence + 1))}


def compare(companies: list[Company], matches: dict[str, dict[str, Any]], selected: list[str], n_evidence: int) -> dict[str, Any]:
    idx = {c["id"]: i + 1 for i, c in enumerate(companies)}
    you = n_evidence
    best = max(companies, key=lambda c: matches[c["id"]]["score"])
    lines = [{
        "text": f"相性スコアでは{short_name(best)}が最も高く、{matches[best['id']]['reason'].replace('合いそうです', '合う可能性があります')}。",
        "refs": [idx[best["id"]], you],
    }]

    def status(c: Company, key: str) -> str | None:
        return next((x["status"] for x in matches[c["id"]]["conditions"] if x["key"] == key), None)

    for key in selected[:3]:
        ok = [c for c in companies if status(c, key) == "met"]
        names = "・".join(short_name(c) for c in ok)
        refs = [idx[c["id"]] for c in (ok or companies)] + [you]
        if key == "salary":
            b = max(companies, key=lambda c: c["metrics"]["avgSalary"])
            text = f"「給与」を重視するなら、平均年収が最も高い{short_name(b)}（{b['metrics']['avgSalary']}万円）が候補になりそうです。"
            refs = [idx[b["id"]], you]
        elif key == "holidays":
            b = max(companies, key=lambda c: c["holidays"])
            text = f"「休日」を重視するなら、年間休日が最も多い{short_name(b)}（{b['holidays']}日）が候補になりそうです。"
            refs = [idx[b["id"]], you]
        elif key == "location":
            text = (f"「勤務地」の希望には、{names}が合う可能性があります。" if ok
                    else "どの会社も勤務地の希望と異なる部分があるため、配属や転勤の方針を確認する必要があると考えられます。")
        elif key == "remote":
            text = (f"「リモート可」の希望には、{names}が合う可能性があります。" if ok
                    else "リモート勤務の希望に完全に合う会社はないため、説明会で確かめるのがよいと考えられます。")
        else:
            text = (f"「研修制度」を重視するなら、{names}の研修が手厚いと考えられます。" if ok
                    else "どの会社も現場で学ぶ形が中心のようです。")
        lines.append({"text": text, "refs": refs})

    if not selected:
        b = max(companies, key=lambda c: c["metrics"]["equityRatio"])
        lines.append({"text": f"重視する条件が未選択のため財務の安定性で見ると、{short_name(b)}の自己資本比率が最も高いと考えられます。",
                      "refs": [idx[b["id"]]]})
    lines.append({"text": "どの会社にも一長一短があるため、最後は説明会や口コミで実際の雰囲気を確かめるのがよいと考えられます。",
                  "refs": [idx[c["id"]] for c in companies]})
    return {"lines": lines}
