"""
企業データの読み込み。

★ここを将来EDINET APIに差し替える
  - companies(): 企業一覧（有価証券報告書の財務データ＋自社DBの社風・口コミデータ）
  - get(id): 1社分の詳細（財務の5年推移・沿革など）
  - benchmark(industry): 業界平均（EDINETの同業他社データから集計）
現在は app/data/companies.json と app/data/meta.json（すべて架空のサンプル）を読み込んでいる。
"""

import json
from functools import cached_property
from pathlib import Path
from typing import Any

from .config import DATA_DIR

Company = dict[str, Any]


class Catalog:
    def __init__(self, data_dir: Path = DATA_DIR):
        self._data_dir = data_dir

    @cached_property
    def meta(self) -> dict[str, Any]:
        return json.loads((self._data_dir / "meta.json").read_text(encoding="utf-8"))

    @cached_property
    def _companies(self) -> list[Company]:
        data = json.loads((self._data_dir / "companies.json").read_text(encoding="utf-8"))
        return data["companies"]

    def companies(self) -> list[Company]:
        return self._companies

    def get(self, company_id: str) -> Company | None:
        return next((c for c in self._companies if c["id"] == company_id), None)

    def benchmark(self, industry: str) -> dict[str, float]:
        return self.meta["benchmarks"][industry]

    def axis_label(self, key: str) -> str:
        return next(a["label"] for a in self.meta["axes"] if a["key"] == key)

    def axis(self, key: str) -> dict[str, str]:
        return next(a for a in self.meta["axes"] if a["key"] == key)

    def public_meta(self) -> dict[str, Any]:
        """画面に渡すマスターデータ（質問の重みなど採点の内部情報は渡さない）"""
        m = self.meta
        return {
            "axes": [{"key": a["key"], "label": a["label"]} for a in m["axes"]],
            "questions": [q["text"] for q in m["questions"]],
            "scale": m["scale"],
            "industries": m["industries"],
            "industryPrefs": m["industryPrefs"],
            "regions": m["regions"],
            "conditions": m["conditions"],
            "salaryOptions": m["salaryOptions"],
            "holidayOptions": m["holidayOptions"],
        }


catalog = Catalog()
