"""設定値。環境変数で上書きできる（backend/.env.example 参照）。"""

import os
from pathlib import Path
from zoneinfo import ZoneInfo

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"

# ---- 保存（SQLite） ----
DB_PATH = Path(os.environ.get("MITSUKARU_DB", BASE_DIR.parent / "var" / "mitsukaru.db"))
# 最終利用からこの日数が過ぎたデータは自動で削除する
RETENTION_DAYS = int(os.environ.get("MITSUKARU_RETENTION_DAYS", "90"))
COOKIE_NAME = "mk_sid"
# 本番（HTTPS）では 1 にする
COOKIE_SECURE = os.environ.get("MITSUKARU_COOKIE_SECURE", "0") == "1"
# 状態を変更するリクエストに必須のヘッダー（CSRF 対策の補助）
CLIENT_HEADER = "X-Mitsukaru-Client"

# ---- プラン ----
FREE_VIEW_LIMIT = 5
COMPARE_LIMIT = {"free": 2, "paid": 3}
TZ = ZoneInfo("Asia/Tokyo")

# ---- AI ----
# auto: APIキーがあれば Claude、なければルールベース / claude: 常に Claude / rules: 常にルールベース
AI_PROVIDER = os.environ.get("AI_PROVIDER", "auto")
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-opus-5-5")
# 与えたデータの要約が中心のため、待ち時間を優先して low を既定にする（low | medium | high）
CLAUDE_EFFORT = os.environ.get("CLAUDE_EFFORT", "low")
CLAUDE_TIMEOUT = float(os.environ.get("CLAUDE_TIMEOUT", "45"))
# 1人あたり：AI_RATE_MAX 回 / AI_RATE_WINDOW 秒 まで Claude を呼ぶ（超えたらルールベース）
AI_RATE_MAX = int(os.environ.get("AI_RATE_MAX", "20"))
AI_RATE_WINDOW = int(os.environ.get("AI_RATE_WINDOW", "600"))
# 同じ企業×同じ診断結果の解説はキャッシュして再利用する
AI_CACHE_DAYS = int(os.environ.get("AI_CACHE_DAYS", "7"))
