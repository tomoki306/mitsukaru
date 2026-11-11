"""
保存（SQLite）。

個人情報の扱い
  - 名前・メールなど個人を特定する情報は受け取らない。保存するのは診断の回答と操作の状態だけ。
  - 利用者の識別は匿名のランダムID（Cookie: HttpOnly / SameSite=Lax）。
    DB にはそのIDの SHA-256 ハッシュだけを保存するので、DB が漏れても Cookie を偽造できない。
  - 最終利用から RETENTION_DAYS 日たったデータは自動で削除する。
  - 「入力したデータをすべて削除」で、本人のデータを即時に完全削除する。
"""

import hashlib
import json
import secrets
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator

from .schemas import UserState

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,      -- 匿名IDのハッシュ
  state       TEXT NOT NULL,         -- UserState(JSON)
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_updated ON users(updated_at);
CREATE TABLE IF NOT EXISTS views (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id  TEXT NOT NULL,
  month       TEXT NOT NULL,         -- 'YYYY-MM'（閲覧枠は月ごと）
  viewed_at   TEXT NOT NULL,
  PRIMARY KEY (user_id, company_id, month)
);
CREATE TABLE IF NOT EXISTS ai_cache (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class Store:
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        with self._conn() as db:
            db.executescript(SCHEMA)

    @contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            db = sqlite3.connect(self.path)
            db.execute("PRAGMA foreign_keys = ON")
            try:
                yield db
                db.commit()
            finally:
                db.close()

    # ---- 利用者 ----
    def create_user(self, state: UserState) -> tuple[str, str]:
        """新しい匿名IDを発行する。戻り値：(Cookieに入れるトークン, DB上のID)"""
        token = secrets.token_urlsafe(32)
        uid = hash_token(token)
        now = _now()
        with self._conn() as db:
            db.execute("INSERT INTO users(id, state, created_at, updated_at) VALUES (?,?,?,?)",
                       (uid, state.model_dump_json(), now, now))
        return token, uid

    def load(self, uid: str) -> tuple[UserState, str, str] | None:
        with self._conn() as db:
            row = db.execute("SELECT state, created_at, updated_at FROM users WHERE id = ?", (uid,)).fetchone()
        if not row:
            return None
        return UserState.model_validate_json(row[0]), row[1], row[2]

    def save(self, uid: str, state: UserState) -> None:
        with self._conn() as db:
            db.execute("UPDATE users SET state = ?, updated_at = ? WHERE id = ?", (state.model_dump_json(), _now(), uid))

    def delete(self, uid: str) -> None:
        with self._conn() as db:
            db.execute("DELETE FROM views WHERE user_id = ?", (uid,))
            db.execute("DELETE FROM users WHERE id = ?", (uid,))

    def purge_expired(self, days: int) -> int:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat(timespec="seconds")
        with self._conn() as db:
            ids = [r[0] for r in db.execute("SELECT id FROM users WHERE updated_at < ?", (cutoff,))]
            db.executemany("DELETE FROM views WHERE user_id = ?", [(i,) for i in ids])
            db.executemany("DELETE FROM users WHERE id = ?", [(i,) for i in ids])
            db.execute("DELETE FROM ai_cache WHERE created_at < ?", (cutoff,))
        return len(ids)

    # ---- 閲覧（月ごと） ----
    def record_view(self, uid: str, company_id: str, month: str) -> None:
        with self._conn() as db:
            db.execute("INSERT OR IGNORE INTO views(user_id, company_id, month, viewed_at) VALUES (?,?,?,?)",
                       (uid, company_id, month, _now()))
            db.execute("UPDATE users SET updated_at = ? WHERE id = ?", (_now(), uid))

    def views(self, uid: str, month: str) -> list[str]:
        """その月に開いた企業ID（開いた順）"""
        with self._conn() as db:
            rows = db.execute("SELECT company_id FROM views WHERE user_id = ? AND month = ? ORDER BY viewed_at, rowid",
                              (uid, month)).fetchall()
        return [r[0] for r in rows]

    # ---- AI解説のキャッシュ ----
    def cache_get(self, key: str, max_age_days: int) -> dict[str, Any] | None:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=max_age_days)).isoformat(timespec="seconds")
        with self._conn() as db:
            row = db.execute("SELECT value FROM ai_cache WHERE key = ? AND created_at >= ?", (key, cutoff)).fetchone()
        return json.loads(row[0]) if row else None

    def cache_set(self, key: str, value: dict[str, Any]) -> None:
        with self._conn() as db:
            db.execute("INSERT OR REPLACE INTO ai_cache(key, value, created_at) VALUES (?,?,?)",
                       (key, json.dumps(value, ensure_ascii=False), _now()))
