"""
診断スコア・相性スコア・条件の判定・業界平均との比較。

相性スコア（0〜100）＝ 次の3つの加重平均（選んでいない項目は除いて重みを配り直す）
  - 価値観の近さ 65%：6軸ごとに「あなたの希望」と「会社の特徴」の差を見る。
      希望より会社が足りない分（不足）はそのまま減点、希望より強すぎる分（過剰）は半分だけ減点。
      あなたが高く付けた軸ほど重く数える。
  - 条件の一致 25%：重視する条件ごとに 一致=1 / 一部一致=0.5 / 不一致=0
  - 志望業界   10%：志望業界に含まれれば1、含まれなければ0（「まだ決まっていない」なら対象外）
※ 企業の知名度は計算に使わない。
"""

from statistics import pstdev
from typing import Any

from .catalog import Catalog, Company
from .schemas import AXIS_KEYS, ConditionPrefs, LocationPref

COMPONENT_WEIGHTS = {"values": 0.65, "conditions": 0.25, "industry": 0.10}


# ---------------------------------------------------------------- 診断
def calc_axes(answers: list[int | None], catalog: Catalog) -> dict[str, int]:
    """8問の回答（1〜5、未回答は3として扱う）から6軸のスコア（0〜100）を計算する。
    重みが負の項目は逆向き（例：「安定」を強く望むほど「挑戦」は少し下がる）として扱う。"""
    sums = {k: 0.0 for k in AXIS_KEYS}
    wsums = {k: 0.0 for k in AXIS_KEYS}
    for q, a in zip(catalog.meta["questions"], answers):
        x = ((a if a is not None else 3) - 1) / 4  # 0..1
        for axis, w in q["weights"].items():
            if w >= 0:
                sums[axis] += w * x
                wsums[axis] += w
            else:
                sums[axis] += -w * (1 - x)
                wsums[axis] += -w
    return {k: round(100 * sums[k] / wsums[k]) for k in AXIS_KEYS}


def clarity(answers: list[int | None]) -> dict[str, str]:
    """回答の差が小さいと傾向ははっきり出ない。結果を過信させないための目安。"""
    vals = [a for a in answers if a is not None]
    if len(vals) >= 4 and pstdev(vals) < 0.6:
        return {
            "level": "low",
            "message": "回答の差が小さいため、傾向ははっきり出ていません。気になる軸は「少し違う」から自分で調整できます。",
        }
    return {"level": "clear", "message": ""}


# ---------------------------------------------------------------- 企業の指標
def revenue_cagr(c: Company) -> float:
    first, last = c["history"][0]["revenue"], c["history"][-1]["revenue"]
    years = len(c["history"]) - 1
    return round(((last / first) ** (1 / years) - 1) * 100, 1)


def stability_index(c: Company) -> int:
    no_loss = 20 if all(h["profit"] > 0 for h in c["history"]) else 0
    return round(c["metrics"]["equityRatio"] * 0.5 + min(c["metrics"]["opMargin"], 20) * 1.5 + no_loss)


def evaluate_metrics(c: Company, bench: dict[str, float], bench_source: str) -> list[dict[str, Any]]:
    """各指標が「良い水準か」を、同じ業界の平均（サンプル値）と比べて判定する。"""
    m = c["metrics"]
    g = revenue_cagr(c)
    out: list[dict[str, Any]] = []

    bg = bench["revenueGrowth"]
    if g >= bg + 3:
        lv, badge, text = "good", "伸びている", f"年平均+{g:.1f}%と、業界平均（年+{bg:.1f}%）を上回るペースで伸びています。"
    elif g >= bg - 2:
        lv, badge, text = "avg", "業界並み", f"年平均{g:+.1f}%と、業界平均（年+{bg:.1f}%）並みのペースです。"
    else:
        lv, badge, text = "caution", "伸びは小さめ", f"年平均{g:+.1f}%と、業界平均（年+{bg:.1f}%）より伸びは小さめです。"
    out.append({"key": "revenue", "value": m["revenue"], "unit": "億円", "industryAvg": bg, "level": lv, "badge": badge, "text": text})

    bm = bench["opMargin"]
    if m["opMargin"] >= bm * 1.2:
        lv, badge, text = "good", "高い", f"業界平均（{bm}%）を上回り、本業で稼ぐ力は高めです。"
    elif m["opMargin"] >= bm * 0.7:
        lv, badge, text = "avg", "業界並み", f"業界平均（{bm}%）に近い水準です。"
    else:
        lv, badge, text = "caution", "低め", f"業界平均（{bm}%）より低めです。成長のための先行投資中の可能性もあります。"
    out.append({"key": "opMargin", "value": m["opMargin"], "unit": "%", "industryAvg": bm, "level": lv, "badge": badge, "text": text})

    be = bench["equityRatio"]
    if m["equityRatio"] >= be + 10:
        lv, badge, text = "good", "高い", f"業界平均（{be}%）を上回り、借金が少なく不況に強い水準です。"
    elif m["equityRatio"] >= be - 10:
        lv, badge, text = "avg", "業界並み", f"業界平均（{be}%）に近い水準です。"
    else:
        lv, badge, text = "caution", "低め", f"業界平均（{be}%）より低く、成長のための借入などが多い可能性があります。"
    out.append({"key": "equityRatio", "value": m["equityRatio"], "unit": "%", "industryAvg": be, "level": lv, "badge": badge, "text": text})

    n = m["employees"]
    if n >= 3000:
        badge, text = "大きな組織", "部署や職種の選択肢が多い傾向があります。"
    elif n >= 500:
        badge, text = "中堅規模", "会社全体の動きが見えやすい規模です。"
    else:
        badge, text = "少人数", "若手にも幅広い仕事が回りやすい規模です。"
    out.append({"key": "employees", "value": n, "unit": "人", "industryAvg": None, "level": "info", "badge": badge, "text": text})

    bs = bench["avgSalary"]
    s = m["avgSalary"]
    if s >= bs + 30:
        lv, badge, text = "good", "高め", f"業界平均（{bs}万円）より高めです。"
    elif s >= bs - 30:
        lv, badge, text = "avg", "業界並み", f"業界平均（{bs}万円）に近い水準です。"
    else:
        lv, badge, text = "caution", "控えめ", f"業界平均（{bs}万円）より控えめです。社員の年齢が若い可能性もあります。"
    out.append({"key": "avgSalary", "value": s, "unit": "万円", "industryAvg": bs, "level": lv, "badge": badge, "text": text})

    for item in out:
        item["benchmarkSource"] = bench_source if item["industryAvg"] is not None else None
    return out


# ---------------------------------------------------------------- 条件
CONDITION_LABEL = {"salary": "給与", "holidays": "休日", "location": "勤務地", "remote": "リモート可", "training": "研修制度"}
STATUS_SCORE = {"met": 1.0, "partial": 0.5, "unmet": 0.0}


def evaluate_condition(c: Company, key: str, prefs: ConditionPrefs) -> dict[str, Any]:
    if key == "salary":
        want, s = prefs.salary, c["metrics"]["avgSalary"]
        status = "met" if s >= want else "partial" if s >= want - 50 else "unmet"
        detail = f"平均年収{s}万円（希望{want}万円以上）"
    elif key == "holidays":
        want, h = prefs.holidays, c["holidays"]
        status = "met" if h >= want else "partial" if h >= want - 3 else "unmet"
        detail = f"年間休日{h}日（希望{want}日以上）"
    elif key == "location":
        loc = prefs.location
        assert loc is not None
        matched = [o["city"] for o in c["offices"] if not loc.regions or o["region"] in loc.regions]
        full_remote = c["remote"] == "可"
        region_ok = bool(matched) or full_remote
        reloc_ok = (not loc.noRelocation) or c["noRelocation"]
        status = "met" if region_ok and reloc_ok else "partial" if (region_ok or reloc_ok) else "unmet"
        place = "・".join(matched) if matched else ("フルリモート可" if full_remote else "希望地域に拠点なし")
        detail = f"拠点：{place}／転勤{'なし' if c['noRelocation'] else 'あり'}"
    elif key == "remote":
        r = c["remote"]
        if prefs.remote == "full":
            status = {"可": "met", "一部可": "partial", "不可": "unmet"}[r]
            detail = f"リモート勤務：{r}（フルリモート希望）"
        else:
            status = "unmet" if r == "不可" else "met"
            detail = f"リモート勤務：{r}"
    elif key == "training":
        status = "met" if c["training"] else "unmet"
        detail = "研修：充実" if c["training"] else "研修：OJT中心"
    else:  # pragma: no cover
        raise ValueError(key)
    return {"key": key, "label": CONDITION_LABEL[key], "status": status, "detail": detail}


def evaluate_conditions(c: Company, prefs: ConditionPrefs) -> list[dict[str, Any]]:
    return [evaluate_condition(c, k, prefs) for k in prefs.selected()]


# ---------------------------------------------------------------- 相性
def match(c: Company, axes: dict[str, int], industries: list[str], prefs: ConditionPrefs, catalog: Catalog) -> dict[str, Any]:
    t = c["traits"]
    rows = []
    for k in AXIS_KEYS:
        w = 0.4 + 0.6 * axes[k] / 100
        short = max(0, axes[k] - t[k])
        excess = max(0, t[k] - axes[k])
        fit = 1 - (short + 0.5 * excess) / 100
        rows.append({"axis": k, "label": catalog.axis_label(k), "you": axes[k], "company": t[k], "weight": w, "fit": fit, "short": short})
    values = sum(r["weight"] * r["fit"] for r in rows) / sum(r["weight"] for r in rows)

    conds = evaluate_conditions(c, prefs)
    cond_score = sum(STATUS_SCORE[x["status"]] for x in conds) / len(conds) if conds else None

    wanted = [i for i in industries if i != "undecided"]
    ind_score = (1.0 if c["industry"] in wanted else 0.0) if wanted else None

    raw = {"values": values, "conditions": cond_score, "industry": ind_score}
    active = {k: COMPONENT_WEIGHTS[k] for k, v in raw.items() if v is not None}
    total_w = sum(active.values())
    total = sum(raw[k] * w for k, w in active.items()) / total_w  # type: ignore[operator]

    met = sum(1 for x in conds if x["status"] == "met")
    components = [
        {"key": "values", "label": "価値観の近さ", "score": round(values * 100), "weight": round(active["values"] / total_w, 2),
         "detail": "6軸の診断結果と会社の特徴の近さ"},
    ]
    if cond_score is not None:
        components.append({"key": "conditions", "label": "条件の一致", "score": round(cond_score * 100),
                           "weight": round(active["conditions"] / total_w, 2), "detail": f"{len(conds)}件中{met}件が一致"})
    if ind_score is not None:
        components.append({"key": "industry", "label": "志望業界", "score": round(ind_score * 100),
                           "weight": round(active["industry"] / total_w, 2),
                           "detail": "志望業界と一致" if ind_score else f"志望業界以外（{c['industry']}）"})

    strengths = sorted([r for r in rows if r["you"] >= 55 and r["company"] >= 55],
                       key=lambda r: r["weight"] * min(r["you"], r["company"]), reverse=True)[:2]
    gaps = sorted([r for r in rows if r["short"] >= 20], key=lambda r: r["short"], reverse=True)[:2]

    best = best_match_axis(c, axes)
    return {
        "score": round(total * 100),
        "reason": f"{c['reasons'][best]}が、あなたの{catalog.axis_label(best)}と合いそうです",
        "bestAxis": best,
        "components": components,
        "axes": [{k: r[k] for k in ("axis", "label", "you", "company")} for r in rows],
        "strengths": [r["axis"] for r in strengths],
        "gaps": [r["axis"] for r in gaps],
        "conditions": conds,
    }


def best_match_axis(c: Company, axes: dict[str, int]) -> str:
    """あなたと会社の両方が高い軸（会社の説明フレーズがある軸の中から）"""
    keys = list(c["reasons"].keys())
    return max(keys, key=lambda k: axes[k] * c["traits"][k])


def rank(companies: list[Company], axes: dict[str, int], industries: list[str], prefs: ConditionPrefs,
         catalog: Catalog, industry: str | None, conds: list[str], sort: str) -> list[dict[str, Any]]:
    out = []
    # 絞り込みは「一致」した会社だけ。基準はあなたの希望条件（未設定の項目は既定値）
    effective = prefs_with_defaults(prefs, conds)
    for c in companies:
        if industry and c["industry"] != industry:
            continue
        if any(evaluate_condition(c, k, effective)["status"] != "met" for k in conds):
            continue
        m = match(c, axes, industries, prefs, catalog)
        out.append({"company": c, "match": m, "stability": stability_index(c), "growth": revenue_cagr(c)})
    key = {"match": lambda r: r["match"]["score"], "stability": lambda r: r["stability"], "growth": lambda r: r["growth"]}[sort]
    return sorted(out, key=key, reverse=True)


def prefs_with_defaults(prefs: ConditionPrefs, keys: list[str]) -> ConditionPrefs:
    """希望条件を設定していない項目で絞り込むときの既定値"""
    p = prefs.model_copy(deep=True)
    if "salary" in keys and p.salary is None:
        p.salary = 550
    if "holidays" in keys and p.holidays is None:
        p.holidays = 125
    if "location" in keys and p.location is None:
        p.location = LocationPref(regions=[], noRelocation=True)
    if "remote" in keys and p.remote is None:
        p.remote = "partial"
    if "training" in keys and not p.training:
        p.training = True
    return p
