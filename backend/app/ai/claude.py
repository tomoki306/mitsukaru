"""
Claude API で解説を作る。

- 公式SDK（anthropic）を使い、構造化出力（JSON Schema）で決まった形の答えを受け取る。
- 与えたデータ（<company> と <evidence>）だけを使うよう指示し、文ごとに根拠番号を返させる。
- 安全上の理由で回答が断られたとき（refusal）は、API側で自動的に別モデルへ切り替える
  server-side fallback（fallbacks="default"）を有効にしている。それでも断られたらルールベースに切り替える。
- 失敗（認証・回数制限・通信・タイムアウト）はすべて AiUnavailable にまとめ、呼び出し側でルールベースに切り替える。
"""

import json
import logging
from typing import Any

import anthropic

log = logging.getLogger("mitsukaru.ai")

SYSTEM_PROMPT = """あなたは、就職活動を始めたばかりの専門学校生に向けて、企業の情報をわかりやすく解説するアシスタントです。
読み手は、まだ応募する企業を決めていない学生です。短い時間で「自分に合う会社か」を考える材料を渡すことが目的です。

# 守ること
- 使ってよい情報は <company>・<user_profile>・<evidence> に書かれた内容だけです。書かれていない数字・出来事・評判を作らないでください。
- 各文の refs には、その文の根拠にした <evidence> の番号を入れてください。一覧にない番号は使わないでください。
- 評価や相性について書く文は、「〜と考えられます」「〜の可能性があります」「〜のようです」のように断定を避けてください。
- 「あなたは○○タイプです」のように人を決めつける表現、「絶対」「必ず」「間違いなく」は使わないでください。
- 良い面と気になる面の両方に触れてください。応募をすすめたり、やめるよう指示したりはしないでください。
- 中学生でもわかる言葉で書き、専門用語には短い言い換えを添えてください。1文は60字程度までにしてください。
"""

_ITEM = {
    "type": "object",
    "properties": {"text": {"type": "string"}, "refs": {"type": "array", "items": {"type": "integer"}}},
    "required": ["text", "refs"],
    "additionalProperties": False,
}
COMMENTARY_SCHEMA = {
    "type": "object",
    "properties": {"lines": {"type": "array", "items": _ITEM}, "fit": _ITEM},
    "required": ["lines", "fit"],
    "additionalProperties": False,
}
FOLLOWUP_SCHEMA = _ITEM
COMPARE_SCHEMA = {
    "type": "object",
    "properties": {"lines": {"type": "array", "items": _ITEM}},
    "required": ["lines"],
    "additionalProperties": False,
}

QUESTION_TEXT = {
    "weakness": "この会社の弱みは？",
    "peers": "同じ業界の他社と比べると？",
    "workstyle": "入社後の働き方は？",
    "future": "5年後はどうなっていそう？",
}


class AiUnavailable(RuntimeError):
    """Claude から使える答えが得られなかった（呼び出し側でルールベースに切り替える）"""


def _evidence_block(evidence: list[dict[str, Any]]) -> str:
    return "\n".join(f"[{e['id']}] {e['label']}: {e['value']}（出典: {e['source']}）" for e in evidence)


def _dump(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True)


class ClaudeProvider:
    def __init__(self, model: str, effort: str, timeout: float, client: Any | None = None):
        self.model = model
        self.effort = effort
        # 失敗時はすぐルールベースに切り替えたいので、SDK の自動リトライは1回まで
        self.client = client or anthropic.Anthropic(timeout=timeout, max_retries=1)

    # ---- 共通の呼び出し ----
    def _call(self, user_content: str, schema: dict[str, Any]) -> dict[str, Any]:
        try:
            response = self.client.beta.messages.create(
                model=self.model,
                max_tokens=16000,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
                output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": schema}},
                messages=[{"role": "user", "content": user_content}],
            )
        except anthropic.AuthenticationError as e:
            raise AiUnavailable("authentication") from e
        except anthropic.RateLimitError as e:
            raise AiUnavailable("rate_limited") from e
        except anthropic.APIStatusError as e:
            raise AiUnavailable(f"api_status_{e.status_code}") from e
        except anthropic.APIConnectionError as e:  # APITimeoutError を含む
            raise AiUnavailable("connection") from e

        if response.stop_reason == "refusal":
            raise AiUnavailable("refusal")
        if response.stop_reason == "max_tokens":
            raise AiUnavailable("max_tokens")
        text = next((b.text for b in response.content if b.type == "text"), None)
        if text is None:
            raise AiUnavailable("no_text")
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            raise AiUnavailable("invalid_json") from e
        log.info("claude ok model=%s request_id=%s", response.model, getattr(response, "_request_id", None))
        return data

    # ---- 用途ごとの依頼文 ----
    def commentary(self, facts: dict[str, Any], profile: dict[str, Any], evidence: list[dict[str, Any]]) -> dict[str, Any]:
        content = f"""<task>
この会社の解説を書いてください。
- lines：5文。順に 1.何で稼いでいる会社か 2.財務（業界平均と比べて） 3.売上の推移 4.過去の出来事（良いことと悪いことの両方） 5.社風・口コミ（良い声と気になる声の両方）
- fit：この利用者との相性の説明を2〜3文。合いそうな点と、確かめておくとよい点の両方を書いてください。
</task>
<company>{_dump(facts)}</company>
<user_profile>{_dump(profile)}</user_profile>
<evidence>
{_evidence_block(evidence)}
</evidence>"""
        return self._call(content, COMMENTARY_SCHEMA)

    def followup(self, facts: dict[str, Any], question: str, evidence: list[dict[str, Any]]) -> dict[str, Any]:
        content = f"""<task>
学生が「{QUESTION_TEXT[question]}」と質問しました。3〜4文で答えてください（text）。
根拠にした番号を refs に入れてください。
</task>
<company>{_dump(facts)}</company>
<evidence>
{_evidence_block(evidence)}
</evidence>"""
        return self._call(content, FOLLOWUP_SCHEMA)

    def compare(self, facts: list[dict[str, Any]], profile: dict[str, Any], evidence: list[dict[str, Any]]) -> dict[str, Any]:
        content = f"""<task>
学生が{len(facts)}社を比較しています。この学生が重視する条件と価値観で見たときの違いを、3〜5文（lines）でまとめてください。
どの会社が良いかを決めつけず、条件ごとにどの会社が当てはまりそうかを書き、最後に確かめるとよい点を添えてください。
</task>
<companies>{_dump(facts)}</companies>
<user_profile>{_dump(profile)}</user_profile>
<evidence>
{_evidence_block(evidence)}
</evidence>"""
        return self._call(content, COMPARE_SCHEMA)
