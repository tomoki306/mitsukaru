import anthropic
import httpx2
import pytest

from app import config
from app.ai import guard, rules
from app.ai import evidence as ev
from app.ai.service import NOTICE_FALLBACK, NOTICE_RATE, AiService
from app.catalog import catalog
from app.schemas import ConditionPrefs
from app.scoring import calc_axes, match

from .conftest import CHALLENGE, STABLE, fake_provider

GOOD = {
    "lines": [
        {"text": "銀行のシステムを作る会社です。", "refs": [1]},
        {"text": "財務は業界平均より安定していると考えられます。", "refs": [3]},
        {"text": "売上は緩やかに伸びている可能性があります。", "refs": [2]},
        {"text": "過去の失敗から立て直している可能性があります。", "refs": [4]},
        {"text": "口コミでは研修が手厚いという声が多いようです。", "refs": [5]},
    ],
    "fit": {"text": "安定を重視する傾向と合う可能性があります。", "refs": [6]},
}


def _args(cid="aoki", answers=STABLE):
    c = catalog.get(cid)
    axes = calc_axes(answers, catalog)
    p = ConditionPrefs(holidays=125)
    return c, axes, [], p, match(c, axes, [], p, catalog)


@pytest.mark.parametrize("answers", [STABLE, CHALLENGE, [3] * 8])
def test_rules_always_pass_guard(answers):
    for c in catalog.companies():
        axes = calc_axes(answers, catalog)
        m = match(c, axes, [], ConditionPrefs(salary=550, training=True), catalog)
        bench = catalog.benchmark(c["industry"])
        e = ev.commentary_evidence(c, axes, m, bench, catalog)
        guard.check_commentary(rules.commentary(c, m, bench, catalog), len(e))


def test_claude_success_is_cached(store):
    provider, msgs = fake_provider([dict(GOOD)])
    svc = AiService(store, catalog, provider)
    out = svc.commentary("u1", *_args())
    assert out["provider"] == "claude" and out["model"] == "claude-opus-5-5" and out["notice"] is None
    assert out["lines"][0]["text"] == GOOD["lines"][0]["text"]
    again = svc.commentary("u2", *_args())
    assert again["provider"] == "claude" and len(msgs.calls) == 1  # 2回目はキャッシュ
    call = msgs.calls[0]
    assert call["model"] == "claude-opus-5-5"
    assert call["fallbacks"] == "default" and "server-side-fallback-2026-07-01" in call["betas"]
    assert call["output_config"]["format"]["type"] == "json_schema"
    assert "<evidence>" in call["messages"][0]["content"]


@pytest.mark.parametrize("bad", [
    {**GOOD, "fit": {"text": "あなたは安定タイプです。", "refs": [6]}},          # 決めつけ
    {**GOOD, "lines": [{"text": "x", "refs": [9]}] * 5},                          # 存在しない根拠番号
    {**GOOD, "lines": [{"text": "良い会社です。", "refs": [1]}] * 5},              # 断定ばかり
    {**GOOD, "_stop": "refusal"},                                                # 回答拒否
])
def test_rejected_output_falls_back_to_rules(store, bad):
    provider, _ = fake_provider([dict(bad)])
    out = AiService(store, catalog, provider).commentary("u1", *_args())
    assert out["provider"] == "rules" and out["notice"] == NOTICE_FALLBACK and len(out["lines"]) == 5


def test_connection_error_falls_back(store):
    err = anthropic.APIConnectionError(request=httpx2.Request("POST", "https://api.anthropic.com/v1/messages"))
    provider, _ = fake_provider([err])
    out = AiService(store, catalog, provider).followup("u1", catalog.get("kaname"), "weakness")
    assert out["provider"] == "rules" and out["text"] == catalog.get("kaname")["faq"]["weakness"]


def test_rate_limit_per_user(store, monkeypatch):
    monkeypatch.setattr(config, "AI_RATE_MAX", 1)
    provider, _ = fake_provider([{"text": "利益率は高めと考えられます。", "refs": [1]}])
    svc = AiService(store, catalog, provider)
    assert svc.followup("u1", catalog.get("aoki"), "weakness")["provider"] == "claude"
    out = svc.followup("u1", catalog.get("aoki"), "future")
    assert out["provider"] == "rules" and out["notice"] == NOTICE_RATE
    assert svc.followup("u2", catalog.get("aoki"), "future")["provider"] == "claude"  # 他の人には影響しない


def test_no_provider_uses_rules_without_notice(store):
    out = AiService(store, catalog, None).commentary("u1", *_args("lupinus", CHALLENGE))
    assert out["provider"] == "rules" and out["notice"] is None
