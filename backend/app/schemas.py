"""API とデータベースで使うデータの形（画面側の src/api.ts と対応）。"""

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

AxisKey = Literal["stability", "challenge", "expertise", "teamwork", "results", "freedom"]
AXIS_KEYS: tuple[str, ...] = ("stability", "challenge", "expertise", "teamwork", "results", "freedom")
Plan = Literal["free", "paid"]
FeatureId = Literal["match", "karte", "compare", "retake"]
ConditionKey = Literal["salary", "holidays", "location", "remote", "training"]
SortKey = Literal["match", "stability", "growth"]
FollowUpId = Literal["weakness", "peers", "workstyle", "future"]


class Axes(BaseModel):
    stability: int = Field(ge=0, le=100)
    challenge: int = Field(ge=0, le=100)
    expertise: int = Field(ge=0, le=100)
    teamwork: int = Field(ge=0, le=100)
    results: int = Field(ge=0, le=100)
    freedom: int = Field(ge=0, le=100)


class LocationPref(BaseModel):
    regions: list[str] = []  # 空なら地域は問わない
    noRelocation: bool = False


class ConditionPrefs(BaseModel):
    """重視する条件。None の項目は「重視しない」"""

    salary: Optional[int] = Field(default=None, ge=300, le=1000)  # 平均年収（万円）この金額以上
    holidays: Optional[int] = Field(default=None, ge=100, le=140)  # 年間休日 この日数以上
    location: Optional[LocationPref] = None
    remote: Optional[Literal["partial", "full"]] = None  # partial: 一部でも可 / full: フルリモート希望
    training: Optional[bool] = None

    def selected(self) -> list[str]:
        keys = []
        if self.salary is not None:
            keys.append("salary")
        if self.holidays is not None:
            keys.append("holidays")
        if self.location is not None:
            keys.append("location")
        if self.remote is not None:
            keys.append("remote")
        if self.training:
            keys.append("training")
        return keys


class HomeItem(BaseModel):
    id: FeatureId
    visible: bool


DEFAULT_HOME = [HomeItem(id=i, visible=True) for i in ("match", "karte", "compare", "retake")]


class UserState(BaseModel):
    """1人分の保存データ（個人を特定する情報は持たない）"""

    answers: list[Optional[int]] = Field(default_factory=lambda: [None] * 8)
    industries: list[str] = []
    conditions: ConditionPrefs = ConditionPrefs()
    adjusted: Optional[Axes] = None
    feedback: Optional[Literal["fit", "adjust"]] = None
    diagnosed: bool = False
    plan: Plan = "free"
    compare: list[str] = []
    home: list[HomeItem] = Field(default_factory=lambda: [h.model_copy() for h in DEFAULT_HOME])
    monthOffset: int = Field(default=0, ge=0, le=24)  # デモ用：日付を何か月進めたか


# ---- リクエスト ----
class DiagnosisIn(BaseModel):
    answers: list[int] = Field(min_length=8, max_length=8)
    industries: list[str] = []
    conditions: ConditionPrefs = ConditionPrefs()

    @field_validator("answers")
    @classmethod
    def _range(cls, v: list[int]) -> list[int]:
        if any(a < 1 or a > 5 for a in v):
            raise ValueError("answers must be 1..5")
        return v


class MePatch(BaseModel):
    """送られてきた項目だけを更新する（adjusted / feedback は null で解除できる）"""

    adjusted: Optional[Axes] = None
    feedback: Optional[Literal["fit", "adjust"]] = None
    industries: Optional[list[str]] = None
    conditions: Optional[ConditionPrefs] = None
    compare: Optional[list[str]] = None
    home: Optional[list[HomeItem]] = None
    plan: Optional[Plan] = None


class AiCompanyIn(BaseModel):
    companyId: str


class FollowUpIn(BaseModel):
    companyId: str
    question: FollowUpId
