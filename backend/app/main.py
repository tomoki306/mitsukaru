"""
ミツカル API（FastAPI）

起動：
    cd backend && source .venv/bin/activate
    uvicorn app.main:app --reload --port 8000 --env-file .env   # .env は任意
    → http://localhost:8000/docs で API の仕様を確認できます

主な役割
  - 診断・相性スコア・条件の判定・業界平均との比較（scoring.py）
  - 利用者データの保存（store.py：匿名ID + SQLite、90日で自動削除）
  - 無料／有料プランの制御（閲覧は月5社まで・比較は2社まで・出来事と口コミは冒頭のみ）をサーバー側で実施
  - AI解説（ai/：Claude API、使えないときはルールベース）
"""

import logging
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import config
from .ai.service import AiService, make_provider
from .catalog import Catalog, Company, catalog as default_catalog
from .schemas import AiCompanyIn, DiagnosisIn, FollowUpIn, MePatch, UserState
from .scoring import calc_axes, clarity, evaluate_metrics, match, rank, revenue_cagr
from .store import Store, hash_token

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("mitsukaru")


def month_info(offset: int) -> dict[str, Any]:
    now = datetime.now(config.TZ)
    total = now.year * 12 + (now.month - 1) + offset
    y, m = divmod(total, 12)
    m += 1
    ny, nm = divmod(total + 1, 12)
    return {"key": f"{y:04d}-{m:02d}", "label": f"{y}年{m}月", "resetsOn": f"{ny}年{nm + 1}月1日"}


@dataclass
class Ctx:
    uid: str
    state: UserState
    created: str
    updated: str


def error(status: int, code: str, message: str, **extra: Any) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message, **extra})


def create_app(store: Optional[Store] = None, ai: Optional[AiService] = None, cat: Catalog = default_catalog) -> FastAPI:
    store = store or Store(config.DB_PATH)
    ai = ai or AiService(store, cat, make_provider())
    last_purge = {"t": 0.0}

    def purge_if_due() -> None:
        if time.monotonic() - last_purge["t"] > 3600:
            n = store.purge_expired(config.RETENTION_DAYS)
            last_purge["t"] = time.monotonic()
            if n:
                log.info("purged %d expired users", n)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        purge_if_due()
        log.info("AI provider: %s", ai.status())
        yield

    app = FastAPI(title="Mitsukaru API", version="1.0.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def require_client_header(request: Request, call_next):
        # 状態を変えるリクエストには専用ヘッダーを必須にする（他サイトからの送信を防ぐ補助。Cookie は SameSite=Lax）
        if request.url.path.startswith("/api/") and request.method not in ("GET", "HEAD", "OPTIONS"):
            if request.headers.get(config.CLIENT_HEADER) != "web":
                return JSONResponse({"detail": {"code": "forbidden", "message": "不正なリクエストです"}}, status_code=403)
        return await call_next(request)

    # ---------------------------------------------------------------- セッション
    def current(request: Request) -> Optional[Ctx]:
        token = request.cookies.get(config.COOKIE_NAME)
        if not token:
            return None
        uid = hash_token(token)
        row = store.load(uid)
        if not row:
            return None
        return Ctx(uid, *row)

    def require(request: Request) -> Ctx:
        ctx = current(request)
        if not ctx:
            raise error(401, "no_session", "データが見つかりません。診断からはじめてください。")
        return ctx

    def require_diagnosed(request: Request) -> Ctx:
        ctx = require(request)
        if not ctx.state.diagnosed:
            raise error(409, "not_diagnosed", "先に診断を完了してください。")
        return ctx

    def set_cookie(response: Response, token: str) -> None:
        response.set_cookie(config.COOKIE_NAME, token, max_age=config.RETENTION_DAYS * 86400,
                            httponly=True, samesite="lax", secure=config.COOKIE_SECURE, path="/")

    def axes_of(state: UserState) -> dict[str, int]:
        return state.adjusted.model_dump() if state.adjusted else calc_axes(state.answers, cat)

    def build_me(ctx: Ctx, notice: Optional[str] = None) -> dict[str, Any]:
        s = ctx.state
        mi = month_info(s.monthOffset)
        viewed = store.views(ctx.uid, mi["key"])
        paid = s.plan == "paid"
        updated = datetime.fromisoformat(ctx.updated).astimezone(config.TZ)
        expires = updated + timedelta(days=config.RETENTION_DAYS)
        return {
            "exists": True,
            "state": s.model_dump(),
            "axes": axes_of(s),
            "computedAxes": calc_axes(s.answers, cat),
            "clarity": clarity(s.answers),
            "usage": {
                "month": mi["label"], "resetsOn": mi["resetsOn"], "used": len(viewed),
                "limit": None if paid else config.FREE_VIEW_LIMIT,
                "remaining": None if paid else max(0, config.FREE_VIEW_LIMIT - len(viewed)),
                "demoShifted": s.monthOffset > 0,
            },
            "viewed": viewed,
            "compareLimit": config.COMPARE_LIMIT[s.plan],
            "storage": {
                "retentionDays": config.RETENTION_DAYS,
                "expiresOn": f"{expires.year}年{expires.month}月{expires.day}日",
            },
            "notice": notice,
        }

    def can_view(ctx: Ctx, company_id: str) -> bool:
        if ctx.state.plan == "paid":
            return True
        return company_id in store.views(ctx.uid, month_info(ctx.state.monthOffset)["key"])

    def get_company(company_id: str) -> Company:
        c = cat.get(company_id)
        if not c:
            raise error(404, "not_found", "企業が見つかりません。")
        return c

    def match_of(ctx: Ctx, c: Company) -> dict[str, Any]:
        s = ctx.state
        return match(c, axes_of(s), s.industries, s.conditions, cat)

    # ---------------------------------------------------------------- 基本
    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {"status": "ok", "ai": ai.status()}

    @app.get("/api/meta")
    def meta() -> dict[str, Any]:
        return {**cat.public_meta(), "ai": ai.status(), "freeViewLimit": config.FREE_VIEW_LIMIT,
                "compareLimit": config.COMPARE_LIMIT, "retentionDays": config.RETENTION_DAYS}

    # ---------------------------------------------------------------- 利用者データ
    @app.get("/api/me")
    def get_me(request: Request) -> dict[str, Any]:
        purge_if_due()
        ctx = current(request)
        return build_me(ctx) if ctx else {"exists": False}

    @app.put("/api/me/diagnosis")
    def put_diagnosis(body: DiagnosisIn, request: Request, response: Response) -> dict[str, Any]:
        allowed = set(cat.meta["industryPrefs"]) | {"undecided"}
        if any(i not in allowed for i in body.industries):
            raise error(400, "invalid_industry", "業界の指定が正しくありません。")
        ctx = current(request)
        if ctx is None:
            token, uid = store.create_user(UserState())
            set_cookie(response, token)
            ctx = Ctx(uid, *store.load(uid))  # type: ignore[misc]
        s = ctx.state
        s.answers, s.industries, s.conditions = list(body.answers), body.industries, body.conditions
        s.adjusted, s.feedback, s.diagnosed = None, None, True
        store.save(ctx.uid, s)
        return build_me(require_from(ctx.uid))

    def require_from(uid: str) -> Ctx:
        return Ctx(uid, *store.load(uid))  # type: ignore[misc]

    @app.patch("/api/me")
    def patch_me(body: MePatch, request: Request) -> dict[str, Any]:
        ctx = require(request)
        s = ctx.state
        fields = body.model_fields_set
        notice = None
        if "adjusted" in fields:
            s.adjusted = body.adjusted
        if "feedback" in fields:
            s.feedback = body.feedback
        if "industries" in fields and body.industries is not None:
            allowed = set(cat.meta["industryPrefs"]) | {"undecided"}
            if any(i not in allowed for i in body.industries):
                raise error(400, "invalid_industry", "業界の指定が正しくありません。")
            s.industries = body.industries
        if "conditions" in fields and body.conditions is not None:
            if body.conditions.location and any(r not in cat.meta["regions"] for r in body.conditions.location.regions):
                raise error(400, "invalid_region", "地域の指定が正しくありません。")
            s.conditions = body.conditions
        if "home" in fields and body.home is not None:
            if sorted(h.id for h in body.home) != sorted(["match", "karte", "compare", "retake"]):
                raise error(400, "invalid_home", "ホームの設定が正しくありません。")
            s.home = body.home
        if "plan" in fields and body.plan is not None:
            s.plan = body.plan
            limit = config.COMPARE_LIMIT[s.plan]
            if len(s.compare) > limit:
                s.compare = s.compare[:limit]
                notice = f"無料プランの比較は{limit}社までのため、{limit + 1}社目以降を外しました"
        if "compare" in fields and body.compare is not None:
            ids = list(dict.fromkeys(body.compare))
            if any(cat.get(i) is None for i in ids):
                raise error(400, "invalid_company", "企業の指定が正しくありません。")
            limit = config.COMPARE_LIMIT[s.plan]
            if len(ids) > limit:
                raise error(400, "compare_limit",
                            "無料プランでは2社まで比較できます。入れ替えるときは1社外してください" if s.plan == "free"
                            else f"比較できるのは{limit}社までです", limit=limit)
            s.compare = ids
        store.save(ctx.uid, s)
        return build_me(require_from(ctx.uid), notice)

    @app.post("/api/me/demo/next-month")
    def demo_next_month(request: Request) -> dict[str, Any]:
        """デモ用：日付を1か月進めて、閲覧枠が毎月1日に戻ることを確認する"""
        ctx = require(request)
        ctx.state.monthOffset = min(24, ctx.state.monthOffset + 1)
        store.save(ctx.uid, ctx.state)
        return build_me(require_from(ctx.uid))

    @app.delete("/api/me", status_code=204)
    def delete_me(request: Request, response: Response) -> Response:
        ctx = current(request)
        if ctx:
            store.delete(ctx.uid)
        response.delete_cookie(config.COOKIE_NAME, path="/")
        response.status_code = 204
        return response

    # ---------------------------------------------------------------- 企業
    @app.get("/api/companies")
    def list_companies(request: Request, industry: Optional[str] = None, conds: str = "",
                       sort: str = Query("match", pattern="^(match|stability|growth)$")) -> dict[str, Any]:
        ctx = require_diagnosed(request)
        s = ctx.state
        cond_keys = [k for k in conds.split(",") if k in ("salary", "holidays", "location", "remote", "training")]
        viewed = set(store.views(ctx.uid, month_info(s.monthOffset)["key"]))
        rows = rank(cat.companies(), axes_of(s), s.industries, s.conditions, cat, industry or None, cond_keys, sort)
        return {"items": [{
            "id": r["company"]["id"], "name": r["company"]["name"], "industry": r["company"]["industry"],
            "tags": r["company"]["tags"], "score": r["match"]["score"], "reason": r["match"]["reason"],
            "viewed": r["company"]["id"] in viewed, "stability": r["stability"], "growth": r["growth"],
        } for r in rows]}

    @app.post("/api/companies/{company_id}/view")
    def view_company(company_id: str, request: Request) -> dict[str, Any]:
        """カルテを開く（無料プランは月5社まで。同じ月に開いた企業は何度でも読み返せる）"""
        ctx = require_diagnosed(request)
        get_company(company_id)
        mi = month_info(ctx.state.monthOffset)
        viewed = store.views(ctx.uid, mi["key"])
        if ctx.state.plan == "free" and company_id not in viewed and len(viewed) >= config.FREE_VIEW_LIMIT:
            raise error(403, "limit_reached", "今月の無料枠を使い切りました", usage=build_me(ctx)["usage"])
        store.record_view(ctx.uid, company_id, mi["key"])
        return build_me(require_from(ctx.uid))

    @app.get("/api/companies/{company_id}")
    def company_detail(company_id: str, request: Request) -> dict[str, Any]:
        ctx = require_diagnosed(request)
        c = get_company(company_id)
        if not can_view(ctx, company_id):
            raise error(403, "not_viewed", "先にカルテを開いてください。")
        paid = ctx.state.plan == "paid"
        bench = cat.benchmark(c["industry"])
        # 無料プランでは、有料部分のデータそのものを送らない（画面でぼかすだけにしない）
        events = c["events"] if paid else c["events"][:1]
        good = c["reviews"]["good"] if paid else c["reviews"]["good"][:1]
        concern = c["reviews"]["concern"] if paid else c["reviews"]["concern"][:1]
        locked_reviews = len(c["reviews"]["good"]) + len(c["reviews"]["concern"]) - len(good) - len(concern)
        return {
            "id": c["id"], "name": c["name"], "industry": c["industry"], "tags": c["tags"],
            "summaryLine": c["summaryLine"], "overview": c["overview"], "metrics": c["metrics"],
            "metricEvals": evaluate_metrics(c, bench, cat.meta["benchmarkSource"]),
            "history": c["history"], "events": events, "lockedEvents": len(c["events"]) - len(events),
            "reviews": {"good": good, "concern": concern, "count": c["reviews"]["count"]}, "lockedReviews": locked_reviews,
            "culture": c["culture"], "holidays": c["holidays"], "remote": c["remote"],
            "noRelocation": c["noRelocation"], "training": c["training"], "offices": c["offices"],
            "match": match_of(ctx, c),
        }

    @app.get("/api/compare")
    def compare_table(request: Request) -> dict[str, Any]:
        ctx = require_diagnosed(request)
        cols = []
        for cid in ctx.state.compare:
            c = cat.get(cid)
            if not c:
                continue
            m = match_of(ctx, c)
            cols.append({
                "id": c["id"], "name": c["name"], "industry": c["industry"], "score": m["score"],
                "growth": revenue_cagr(c),
                "opMargin": c["metrics"]["opMargin"], "equityRatio": c["metrics"]["equityRatio"],
                "avgSalary": c["metrics"]["avgSalary"], "holidays": c["holidays"], "remote": c["remote"],
                "culture": c["culture"], "conditions": m["conditions"],
            })
        return {"companies": cols}

    # ---------------------------------------------------------------- AI
    @app.post("/api/ai/commentary")
    def ai_commentary(body: AiCompanyIn, request: Request) -> dict[str, Any]:
        ctx = require_diagnosed(request)
        c = get_company(body.companyId)
        if not can_view(ctx, c["id"]):
            raise error(403, "not_viewed", "先にカルテを開いてください。")
        s = ctx.state
        return ai.commentary(ctx.uid, c, axes_of(s), s.industries, s.conditions, match_of(ctx, c))

    @app.post("/api/ai/followup")
    def ai_followup(body: FollowUpIn, request: Request) -> dict[str, Any]:
        ctx = require_diagnosed(request)
        c = get_company(body.companyId)
        if not can_view(ctx, c["id"]):
            raise error(403, "not_viewed", "先にカルテを開いてください。")
        return ai.followup(ctx.uid, c, body.question)

    @app.post("/api/ai/compare")
    def ai_compare(request: Request) -> dict[str, Any]:
        ctx = require_diagnosed(request)
        companies = [c for c in (cat.get(i) for i in ctx.state.compare) if c]
        if len(companies) < 2:
            raise error(400, "need_two", "比較するには2社以上を選んでください。")
        s = ctx.state
        matches = {c["id"]: match_of(ctx, c) for c in companies}
        return ai.compare(ctx.uid, companies, axes_of(s), s.industries, s.conditions, matches)

    return app


app = create_app()
