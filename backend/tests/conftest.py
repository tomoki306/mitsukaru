import json
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.ai.claude import ClaudeProvider  # noqa: E402
from app.ai.service import AiService  # noqa: E402
from app.catalog import catalog  # noqa: E402
from app.main import create_app  # noqa: E402
from app.store import Store  # noqa: E402

HEADERS = {"X-Mitsukaru-Client": "web"}
STABLE = [5, 2, 4, 5, 2, 1, 4, 3]       # 安定・協調を重視
CHALLENGE = [1, 5, 3, 2, 5, 5, 1, 4]    # 挑戦・自由・成果を重視


class FakeMessages:
    """Claude API の代わり。応答（dict / 例外 / stop_reason）を順に返す"""

    def __init__(self, responses: list[Any]):
        self.responses = list(responses)
        self.calls: list[dict[str, Any]] = []

    def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        r = self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]
        if isinstance(r, Exception):
            raise r
        stop = r.pop("_stop", "end_turn") if isinstance(r, dict) else "end_turn"
        return SimpleNamespace(
            stop_reason=stop, model=kwargs["model"], _request_id="req_test",
            content=[SimpleNamespace(type="thinking", thinking=""), SimpleNamespace(type="text", text=json.dumps(r, ensure_ascii=False))],
        )


def fake_provider(responses: list[Any]) -> tuple[ClaudeProvider, FakeMessages]:
    msgs = FakeMessages(responses)
    client = SimpleNamespace(beta=SimpleNamespace(messages=msgs))
    return ClaudeProvider("claude-opus-5-5", "low", 10, client=client), msgs


@pytest.fixture
def store(tmp_path: Path) -> Store:
    return Store(tmp_path / "test.db")


@pytest.fixture
def client(store: Store) -> TestClient:
    app = create_app(store=store, ai=AiService(store, catalog, None))
    with TestClient(app) as c:
        yield c


def diagnose(client: TestClient, answers: list[int] = STABLE, **extra: Any) -> dict[str, Any]:
    body = {"answers": answers, "industries": [], "conditions": {}, **extra}
    r = client.put("/api/me/diagnosis", json=body, headers=HEADERS)
    assert r.status_code == 200, r.text
    return r.json()
