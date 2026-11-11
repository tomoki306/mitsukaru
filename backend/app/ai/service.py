"""
AI解説の窓口。

  1. 根拠の一覧を作る（evidence.py）
  2. Claude が使えれば Claude に依頼（claude.py）→ 出力を検査（guard.py）
  3. 使えない・失敗・検査に通らない・回数上限 → ルールベース（rules.py）に切り替える
  4. Claude の結果はキャッシュして、同じ企業×同じ診断結果なら再利用する（費用と待ち時間の削減）
"""

import hashlib
import json
import logging
import os
import threading
import time
from collections import defaultdict, deque
from typing import Any, Callable

from .. import config
from ..catalog import Catalog, Company
from ..schemas import AXIS_KEYS, ConditionPrefs
from ..store import Store
from . import evidence as ev
from . import guard, rules
from .claude import AiUnavailable, ClaudeProvider

log = logging.getLogger("mitsukaru.ai")

NOTICE_FALLBACK = "AIに接続できなかったため、データから作成した簡易版の解説を表示しています。"
NOTICE_RATE = "短い時間にたくさんの解説を作成したため、しばらくは簡易版の解説を表示しています。"


def make_provider(mode: str = config.AI_PROVIDER) -> ClaudeProvider | None:
    if mode == "rules":
        return None
    if mode == "auto" and not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        return None
    return ClaudeProvider(config.CLAUDE_MODEL, config.CLAUDE_EFFORT, config.CLAUDE_TIMEOUT)


class AiService:
    def __init__(self, store: Store, catalog: Catalog, provider: ClaudeProvider | None):
        self.store = store
        self.catalog = catalog
        self.provider = provider
        self._calls: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def status(self) -> dict[str, Any]:
        if self.provider:
            return {"provider": "claude", "model": self.provider.model}
        return {"provider": "rules", "model": None}

    # ---- 1人あたりの呼び出し回数の上限 ----
    def _allow(self, uid: str) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._calls[uid]
            while q and now - q[0] > config.AI_RATE_WINDOW:
                q.popleft()
            if len(q) >= config.AI_RATE_MAX:
                return False
            q.append(now)
            return True

    def _run(self, uid: str, kind: str, key_payload: dict[str, Any], evidence: list[dict[str, Any]],
             rules_out: Callable[[], dict[str, Any]], claude_out: Callable[[ClaudeProvider], dict[str, Any]],
             check: Callable[[dict[str, Any], int], None]) -> dict[str, Any]:
        def fallback(notice: str | None) -> dict[str, Any]:
            return {**rules_out(), "evidence": evidence, "provider": "rules", "model": None, "notice": notice}

        if not self.provider:
            return fallback(None)
        key = hashlib.sha256(json.dumps({"kind": kind, "model": self.provider.model, **key_payload},
                                        sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        cached = self.store.cache_get(key, config.AI_CACHE_DAYS)
        if cached:
            return {**cached, "evidence": evidence, "provider": "claude", "model": self.provider.model, "notice": None}
        if not self._allow(uid):
            return fallback(NOTICE_RATE)
        try:
            out = claude_out(self.provider)
            check(out, len(evidence))
        except AiUnavailable as e:
            log.warning("claude unavailable kind=%s reason=%s", kind, e)
            return fallback(NOTICE_FALLBACK)
        except (guard.GuardError, KeyError, TypeError) as e:
            log.warning("claude output rejected kind=%s reason=%s", kind, e)
            return fallback(NOTICE_FALLBACK)
        self.store.cache_set(key, out)
        return {**out, "evidence": evidence, "provider": "claude", "model": self.provider.model, "notice": None}

    @staticmethod
    def _profile_key(axes: dict[str, int], industries: list[str], prefs: ConditionPrefs) -> dict[str, Any]:
        return {"axes": [axes[k] for k in AXIS_KEYS], "industries": sorted(industries), "conditions": prefs.model_dump()}

    def _profile_for_ai(self, axes: dict[str, int], match: dict[str, Any] | None) -> dict[str, Any]:
        p: dict[str, Any] = {"values": {self.catalog.axis_label(k): axes[k] for k in AXIS_KEYS}}
        if match:
            p["matchScore"] = match["score"]
            p["scoreBreakdown"] = match["components"]
            p["strengths"] = [self.catalog.axis_label(k) for k in match["strengths"]]
            p["gaps"] = [self.catalog.axis_label(k) for k in match["gaps"]]
            p["conditions"] = match["conditions"]
        return p

    # ---- 企業の解説 ----
    def commentary(self, uid: str, c: Company, axes: dict[str, int], industries: list[str], prefs: ConditionPrefs,
                   match: dict[str, Any]) -> dict[str, Any]:
        bench = self.catalog.benchmark(c["industry"])
        evidence = ev.commentary_evidence(c, axes, match, bench, self.catalog)
        return self._run(
            uid, "commentary", {"company": c["id"], **self._profile_key(axes, industries, prefs)}, evidence,
            rules_out=lambda: rules.commentary(c, match, bench, self.catalog),
            claude_out=lambda p: p.commentary(ev.company_facts(c, bench), self._profile_for_ai(axes, match), evidence),
            check=guard.check_commentary,
        )

    # ---- 選択式の質問 ----
    def followup(self, uid: str, c: Company, question: str) -> dict[str, Any]:
        bench = self.catalog.benchmark(c["industry"])
        peers = [x for x in self.catalog.companies() if x["industry"] == c["industry"] and x["id"] != c["id"]]
        evidence = ev.followup_evidence(c, question, peers, bench, self.catalog)
        return self._run(
            uid, "followup", {"company": c["id"], "question": question}, evidence,
            rules_out=lambda: rules.followup(c, question, peers, bench, len(evidence)),
            claude_out=lambda p: p.followup(ev.company_facts(c, bench), question, evidence),
            check=guard.check_followup,
        )

    # ---- 比較のまとめ ----
    def compare(self, uid: str, companies: list[Company], axes: dict[str, int], industries: list[str],
                prefs: ConditionPrefs, matches: dict[str, dict[str, Any]]) -> dict[str, Any]:
        selected = prefs.selected()
        labels = [x["label"] for x in self.catalog.meta["conditions"] if x["key"] in selected]
        evidence = ev.compare_evidence(companies, matches, axes, labels, self.catalog)
        facts = [{**ev.company_facts(c, self.catalog.benchmark(c["industry"])), "match": matches[c["id"]]} for c in companies]
        return self._run(
            uid, "compare", {"companies": [c["id"] for c in companies], **self._profile_key(axes, industries, prefs)}, evidence,
            rules_out=lambda: rules.compare(companies, matches, selected, len(evidence)),
            claude_out=lambda p: p.compare(facts, self._profile_for_ai(axes, None), evidence),
            check=guard.check_compare,
        )
