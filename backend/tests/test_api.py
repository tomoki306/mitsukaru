import sqlite3

from fastapi.testclient import TestClient

from app import config

from .conftest import HEADERS, diagnose


def test_new_user_has_no_data(client: TestClient):
    assert client.get("/api/me").json() == {"exists": False}
    assert client.get("/api/companies").status_code == 401


def test_write_requires_client_header(client: TestClient):
    r = client.put("/api/me/diagnosis", json={"answers": [3] * 8})
    assert r.status_code == 403


def test_session_cookie_is_anonymous_and_hashed(client: TestClient, store):
    r = client.put("/api/me/diagnosis", json={"answers": [3] * 8}, headers=HEADERS)
    cookie = r.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie
    token = client.cookies.get(config.COOKIE_NAME)
    with sqlite3.connect(store.path) as db:
        ids = [row[0] for row in db.execute("SELECT id FROM users")]
    assert token not in ids and len(ids) == 1  # DB にはトークンそのものは保存しない


def test_data_survives_reload(client: TestClient):
    me = diagnose(client, industries=["ゲーム"])
    assert me["state"]["diagnosed"] is True
    # 同じ Cookie を持つ別のクライアント（＝ページの再読み込み）でも続きから使える
    other = TestClient(client.app, cookies={config.COOKIE_NAME: client.cookies.get(config.COOKIE_NAME)})
    me2 = other.get("/api/me").json()
    assert me2["exists"] and me2["state"]["industries"] == ["ゲーム"]


def test_list_is_ranked_and_filterable(client: TestClient):
    diagnose(client)
    items = client.get("/api/companies").json()["items"]
    assert len(items) == 8
    scores = [i["score"] for i in items]
    assert scores == sorted(scores, reverse=True)
    games = client.get("/api/companies", params={"industry": "ゲーム"}).json()["items"]
    assert len(games) == 2


def test_free_view_quota_and_monthly_reset(client: TestClient):
    diagnose(client)
    ids = [i["id"] for i in client.get("/api/companies").json()["items"]]
    for cid in ids[:5]:
        assert client.post(f"/api/companies/{cid}/view", headers=HEADERS).status_code == 200
    r = client.post(f"/api/companies/{ids[5]}/view", headers=HEADERS)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "limit_reached"
    # 同じ月に開いた企業は何度でも読み返せる
    assert client.post(f"/api/companies/{ids[0]}/view", headers=HEADERS).status_code == 200
    # 開いていない企業の詳細・AI解説は取得できない（サーバー側で制御）
    assert client.get(f"/api/companies/{ids[5]}").status_code == 403
    assert client.post("/api/ai/commentary", json={"companyId": ids[5]}, headers=HEADERS).status_code == 403
    # 翌月になると枠が戻る
    me = client.post("/api/me/demo/next-month", headers=HEADERS).json()
    assert me["usage"]["used"] == 0 and me["usage"]["remaining"] == 5
    assert client.post(f"/api/companies/{ids[5]}/view", headers=HEADERS).status_code == 200


def test_paid_content_is_not_sent_to_free_users(client: TestClient):
    diagnose(client)
    client.post("/api/companies/aoki/view", headers=HEADERS)
    free = client.get("/api/companies/aoki").json()
    assert len(free["events"]) == 1 and free["lockedEvents"] == 3
    assert len(free["reviews"]["good"]) == 1 and free["lockedReviews"] == 4
    client.patch("/api/me", json={"plan": "paid"}, headers=HEADERS)
    paid = client.get("/api/companies/aoki").json()
    assert len(paid["events"]) == 4 and paid["lockedEvents"] == 0
    assert {m["key"] for m in paid["metricEvals"]} == {"revenue", "opMargin", "equityRatio", "employees", "avgSalary"}


def test_compare_limits(client: TestClient):
    diagnose(client)
    r = client.patch("/api/me", json={"compare": ["aoki", "kaname", "minamo"]}, headers=HEADERS)
    assert r.status_code == 400 and r.json()["detail"]["code"] == "compare_limit"
    client.patch("/api/me", json={"plan": "paid"}, headers=HEADERS)
    assert client.patch("/api/me", json={"compare": ["aoki", "kaname", "minamo"]}, headers=HEADERS).status_code == 200
    me = client.patch("/api/me", json={"plan": "free"}, headers=HEADERS).json()
    assert me["state"]["compare"] == ["aoki", "kaname"] and me["notice"]
    cols = client.get("/api/compare").json()["companies"]
    assert [c["id"] for c in cols] == ["aoki", "kaname"]
    summary = client.post("/api/ai/compare", headers=HEADERS).json()
    assert summary["provider"] == "rules" and summary["lines"]


def test_adjusted_axes_change_ranking(client: TestClient):
    diagnose(client)
    before = client.get("/api/companies").json()["items"][0]["id"]
    adjusted = {"stability": 10, "challenge": 95, "expertise": 50, "teamwork": 40, "results": 90, "freedom": 95}
    client.patch("/api/me", json={"adjusted": adjusted, "feedback": "adjust"}, headers=HEADERS)
    after = client.get("/api/companies").json()["items"][0]["id"]
    assert before != after
    me = client.patch("/api/me", json={"adjusted": None, "feedback": "fit"}, headers=HEADERS).json()
    assert me["state"]["adjusted"] is None and me["axes"] == me["computedAxes"]


def test_delete_all(client: TestClient, store):
    diagnose(client)
    client.post("/api/companies/aoki/view", headers=HEADERS)
    r = client.delete("/api/me", headers=HEADERS)
    assert r.status_code == 204
    assert client.get("/api/me").json() == {"exists": False}
    with sqlite3.connect(store.path) as db:
        assert db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM views").fetchone()[0] == 0


def test_expired_data_is_purged(client: TestClient, store):
    diagnose(client)
    with sqlite3.connect(store.path) as db:
        db.execute("UPDATE users SET updated_at = '2000-01-01T00:00:00+00:00'")
    assert store.purge_expired(config.RETENTION_DAYS) == 1
    assert client.get("/api/me").json() == {"exists": False}


def test_ai_commentary_rules_fallback(client: TestClient):
    diagnose(client, conditions={"holidays": 125})
    client.post("/api/companies/minamo/view", headers=HEADERS)
    out = client.post("/api/ai/commentary", json={"companyId": "minamo"}, headers=HEADERS).json()
    assert out["provider"] == "rules" and len(out["lines"]) == 5 and len(out["evidence"]) == 6
    assert all(1 <= r <= 6 for line in out["lines"] for r in line["refs"])
    fu = client.post("/api/ai/followup", json={"companyId": "minamo", "question": "peers"}, headers=HEADERS).json()
    assert "ホシノメ" in fu["text"] and fu["evidence"]
