"""
AI の出力の検査（ガードレール）。

アンケートで多かった「結論を押し付けてくる」「調べ直したら間違っていた」という不満に対応するため、
Claude の出力が次のルールを守っているかを確認し、守っていなければルールベースの解説に切り替える。
  - すべての文に、実在する根拠番号が付いている
  - 断定・決めつけの表現を使っていない
  - 相性の説明は断定を避けた言い方になっている
  - 長すぎない
"""

from typing import Any

BANNED = ("タイプです", "絶対", "間違いなく", "必ず", "断言", "応募すべき", "やめるべき", "おすすめしません")
HEDGES = ("考えられ", "可能性", "ようです", "かもしれ", "でしょう", "見られ", "傾向", "思われ")
MAX_CHARS = 220


class GuardError(ValueError):
    pass


def _check_item(item: dict[str, Any], n_evidence: int, where: str) -> None:
    text = item.get("text", "")
    refs = item.get("refs", [])
    if not text.strip():
        raise GuardError(f"{where}: empty text")
    if len(text) > MAX_CHARS:
        raise GuardError(f"{where}: too long")
    if not refs or any((not isinstance(r, int)) or r < 1 or r > n_evidence for r in refs):
        raise GuardError(f"{where}: invalid refs {refs}")
    for w in BANNED:
        if w in text:
            raise GuardError(f"{where}: banned phrase {w}")


def check_commentary(out: dict[str, Any], n_evidence: int) -> None:
    lines = out.get("lines", [])
    if not 3 <= len(lines) <= 6:
        raise GuardError(f"lines count {len(lines)}")
    for i, line in enumerate(lines):
        _check_item(line, n_evidence, f"line{i}")
    hedged = sum(1 for line in lines if any(h in line["text"] for h in HEDGES))
    if hedged < len(lines) - 2:  # 事業内容などの事実の文は断定でよいが、評価の文は断定を避ける
        raise GuardError("not hedged")
    _check_item(out.get("fit", {}), n_evidence, "fit")
    if not any(h in out["fit"]["text"] for h in HEDGES):
        raise GuardError("fit not hedged")


def check_followup(out: dict[str, Any], n_evidence: int) -> None:
    _check_item(out, n_evidence, "answer")
    if not any(h in out["text"] for h in HEDGES):
        raise GuardError("answer not hedged")


def check_compare(out: dict[str, Any], n_evidence: int) -> None:
    lines = out.get("lines", [])
    if not 1 <= len(lines) <= 6:
        raise GuardError(f"lines count {len(lines)}")
    for i, line in enumerate(lines):
        _check_item(line, n_evidence, f"line{i}")
