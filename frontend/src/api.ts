/**
 * サーバー（backend/：Python・FastAPI）との通信。型は backend/app/schemas.py と対応。
 *
 * 企業データ  … サーバーの app/catalog.py が提供（★将来 EDINET API に差し替える）
 * AIの解説    … サーバーの app/ai/ が Claude API で作成（APIキーがなければルールベース）
 * 保存        … サーバーの SQLite に匿名IDで保存（Cookie は HttpOnly のため画面からは読めない）
 */

export type AxisKey = 'stability' | 'challenge' | 'expertise' | 'teamwork' | 'results' | 'freedom'
export type Axes = Record<AxisKey, number>
export type Plan = 'free' | 'paid'
export type ConditionKey = 'salary' | 'holidays' | 'location' | 'remote' | 'training'
export type SortKey = 'match' | 'stability' | 'growth'
export type FollowUpId = 'weakness' | 'peers' | 'workstyle' | 'future'
export type FeatureId = 'match' | 'karte' | 'compare' | 'retake'
export type Level = 'good' | 'avg' | 'caution' | 'info'
export type Status = 'met' | 'partial' | 'unmet'

export interface LocationPref { regions: string[]; noRelocation: boolean }
export interface ConditionPrefs {
  salary: number | null
  holidays: number | null
  location: LocationPref | null
  remote: 'partial' | 'full' | null
  training: boolean | null
}
export interface HomeItem { id: FeatureId; visible: boolean }
export interface UserState {
  answers: (number | null)[]
  industries: string[]
  conditions: ConditionPrefs
  adjusted: Axes | null
  feedback: 'fit' | 'adjust' | null
  diagnosed: boolean
  plan: Plan
  compare: string[]
  home: HomeItem[]
  monthOffset: number
}
export interface Usage { month: string; resetsOn: string; used: number; limit: number | null; remaining: number | null; demoShifted: boolean }
export interface Me {
  exists: true
  state: UserState
  axes: Axes
  computedAxes: Axes
  clarity: { level: 'low' | 'clear'; message: string }
  usage: Usage
  viewed: string[]
  compareLimit: number
  storage: { retentionDays: number; expiresOn: string }
  notice: string | null
}
export interface AiStatus { provider: 'claude' | 'rules'; model: string | null }
export interface Meta {
  axes: { key: AxisKey; label: string }[]
  questions: string[]
  scale: string[]
  industries: string[]
  industryPrefs: string[]
  regions: string[]
  conditions: { key: ConditionKey; label: string }[]
  salaryOptions: number[]
  holidayOptions: number[]
  ai: AiStatus
  freeViewLimit: number
  compareLimit: Record<Plan, number>
  retentionDays: number
}
export interface CompanyListItem {
  id: string; name: string; industry: string; tags: string[]
  score: number; reason: string; viewed: boolean; stability: number; growth: number
}
export interface ConditionResult { key: ConditionKey; label: string; status: Status; detail: string }
export interface MatchResult {
  score: number
  reason: string
  bestAxis: AxisKey
  components: { key: 'values' | 'conditions' | 'industry'; label: string; score: number; weight: number; detail: string }[]
  axes: { axis: AxisKey; label: string; you: number; company: number }[]
  strengths: AxisKey[]
  gaps: AxisKey[]
  conditions: ConditionResult[]
}
export interface MetricEval {
  key: 'revenue' | 'opMargin' | 'equityRatio' | 'employees' | 'avgSalary'
  value: number; unit: string; industryAvg: number | null; level: Level; badge: string; text: string; benchmarkSource: string | null
}
export interface HistoryPoint { year: string; revenue: number; profit: number }
export interface CompanyEvent { year: string; title: string; detail: string; tone: 'good' | 'bad' }
export interface CompanyDetail {
  id: string; name: string; industry: string; tags: string[]
  summaryLine: string; overview: string[]
  metrics: { revenue: number; opMargin: number; equityRatio: number; employees: number; avgSalary: number }
  metricEvals: MetricEval[]
  history: HistoryPoint[]
  events: CompanyEvent[]; lockedEvents: number
  reviews: { good: string[]; concern: string[]; count: number }; lockedReviews: number
  culture: string; holidays: number; remote: '可' | '一部可' | '不可'; noRelocation: boolean; training: boolean
  offices: { city: string; region: string }[]
  match: MatchResult
}
export interface Evidence { id: number; label: string; value: string; source: string }
export interface Cited { text: string; refs: number[] }
export interface AiMeta { evidence: Evidence[]; provider: 'claude' | 'rules'; model: string | null; notice: string | null }
export type AiCommentary = AiMeta & { lines: Cited[]; fit: Cited }
export type FollowUpAnswer = AiMeta & Cited
export type CompareCommentary = AiMeta & { lines: Cited[] }
export interface CompareColumn {
  id: string; name: string; industry: string; score: number; growth: number
  opMargin: number; equityRatio: number; avgSalary: number; holidays: number
  remote: '可' | '一部可' | '不可'; culture: string; conditions: ConditionResult[]
}
export interface ListFilter { industry: string | 'all'; conds: ConditionKey[]; sort: SortKey }

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly detail: Record<string, unknown>
  constructor(status: number, code: string, message: string, detail: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.detail = detail
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Mitsukaru-Client': 'web' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'network', 'サーバーに接続できません。通信環境を確認して、もう一度お試しください。')
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const d = (data?.detail && typeof data.detail === 'object' ? data.detail : {}) as Record<string, unknown>
    throw new ApiError(res.status, String(d.code ?? 'error'), String(d.message ?? 'エラーが発生しました。もう一度お試しください。'), d)
  }
  return data as T
}

/** 読み込み表示が一瞬で消えてチラつかないよう、最低限の表示時間をとる */
export async function withMinDelay<T>(p: Promise<T>, ms = 500): Promise<T> {
  const [r] = await Promise.all([p, new Promise((ok) => setTimeout(ok, ms))])
  return r
}

export const api = {
  meta: () => request<Meta>('GET', '/meta'),
  me: () => request<Me | { exists: false }>('GET', '/me'),
  saveDiagnosis: (body: { answers: number[]; industries: string[]; conditions: ConditionPrefs }) => request<Me>('PUT', '/me/diagnosis', body),
  updateMe: (patch: Partial<Pick<UserState, 'adjusted' | 'feedback' | 'industries' | 'conditions' | 'compare' | 'home' | 'plan'>>) =>
    request<Me>('PATCH', '/me', patch),
  nextMonth: () => request<Me>('POST', '/me/demo/next-month'),
  deleteAll: () => request<void>('DELETE', '/me'),

  // ---- 企業データ（サーバー側：将来 EDINET API に差し替える） ----
  getCompanies: (f: ListFilter) => {
    const q = new URLSearchParams({ sort: f.sort, conds: f.conds.join(',') })
    if (f.industry !== 'all') q.set('industry', f.industry)
    return request<{ items: CompanyListItem[] }>('GET', `/companies?${q}`)
  },
  /** カルテを開く（無料プランの月5社の枠を使う。同じ月に開いた企業は何度でも読み返せる） */
  openCompany: (id: string) => request<Me>('POST', `/companies/${encodeURIComponent(id)}/view`),
  getCompanyDetail: (id: string) => request<CompanyDetail>('GET', `/companies/${encodeURIComponent(id)}`),
  getCompareTable: () => request<{ companies: CompareColumn[] }>('GET', '/compare'),

  // ---- AI（サーバー側：Claude API。使えないときはルールベース） ----
  getAiCommentary: (companyId: string) => request<AiCommentary>('POST', '/ai/commentary', { companyId }),
  getFollowUpAnswer: (companyId: string, question: FollowUpId) => request<FollowUpAnswer>('POST', '/ai/followup', { companyId, question }),
  getCompareCommentary: () => request<CompareCommentary>('POST', '/ai/compare'),
}
