/**
 * ミツカル（仮称）— 就活生向け 企業マッチング
 *
 * ファイル構成
 *   api.ts  … サーバー（backend/：Python・FastAPI）との通信と型
 *   ui.tsx  … 共通のUI部品
 *   App.tsx … 画面（7画面）と状態管理（このファイル）
 *
 * データの保存・相性スコアの計算・プランの制御・AI解説はすべてサーバー側で行う。
 * 画面側は、表示とすばやい反応（スライダーなど）のための一時的な状態だけを持つ。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, ResponsiveContainer, Tooltip } from 'recharts'
import {
  ArrowRight, BookOpen, Building2, CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Columns3, Compass,
  Database, Eye, EyeOff, FileText, House, Info, Lock, MapPin, MessageCircle, RefreshCw, RotateCcw, Settings, ShieldCheck,
  SlidersHorizontal, Sparkles, Square, SquareCheckBig, Trash2, Upload, WifiOff, X,
} from 'lucide-react'
import {
  api, ApiError, withMinDelay,
  type AiCommentary, type Axes, type AxisKey, type CompanyDetail, type CompanyListItem, type CompareColumn, type CompareCommentary,
  type ConditionKey, type ConditionPrefs, type FeatureId, type FollowUpAnswer, type FollowUpId, type HomeItem, type ListFilter,
  type MatchResult, type Me, type Meta, type Plan, type SortKey,
} from './api'
import {
  AiSourceNote, AppHeader, Btn, Card, Chip, CitedText, EvidenceList, GLOSSARY, LevelBadge, LockedPlaceholder, MiniLine, RemovableChip,
  ReviewGroup, Segmented, Sheet, Sidebar, Skeleton, StatusBadge, Tag, TermContext, Term, Timeline, type NavItem, type TermKey,
} from './ui'

// =====================================================================
// 定数
// =====================================================================
type Screen = 'welcome' | 'quiz' | 'result' | 'home' | 'list' | 'karte' | 'compare' | 'settings'

const SCREEN_TITLE: Record<Screen, string> = {
  welcome: '', quiz: '', result: '診断結果', home: 'ホーム', list: '合いそうな企業', karte: '企業カルテ', compare: '企業を比較', settings: '設定',
}
const SORTS: [SortKey, string][] = [['match', '相性順'], ['stability', '安定性順'], ['growth', '成長性順']]
const defaultFilter: ListFilter = { industry: 'all', conds: [], sort: 'match' }
const emptyConditions: ConditionPrefs = { salary: null, holidays: null, location: null, remote: null, training: null }
const CONDITION_DEFAULTS: { [K in ConditionKey]: NonNullable<ConditionPrefs[K]> } = {
  salary: 550, holidays: 125, location: { regions: [], noRelocation: true }, remote: 'partial', training: true,
}
const FOLLOW_UPS: { id: FollowUpId; label: string }[] = [
  { id: 'weakness', label: 'この会社の弱みは？' },
  { id: 'peers', label: '同じ業界の他社と比べると？' },
  { id: 'workstyle', label: '入社後の働き方は？' },
  { id: 'future', label: '5年後はどうなっていそう？' },
]
const HOME_FEATURES: Record<FeatureId, { label: string; desc: string; icon: ReactNode }> = {
  match: { label: '合う企業を見る', desc: '診断結果に近い順に一覧', icon: <Building2 size={22} strokeWidth={1.75} /> },
  karte: { label: '企業カルテを読む', desc: '数字・出来事・口コミをまとめて', icon: <BookOpen size={22} strokeWidth={1.75} /> },
  compare: { label: '企業を比較する', desc: '2〜3社を横に並べて', icon: <Columns3 size={22} strokeWidth={1.75} /> },
  retake: { label: '診断をやり直す', desc: '8問・約30秒', icon: <RotateCcw size={22} strokeWidth={1.75} /> },
}
const METRIC_TERM: Record<string, TermKey> = { revenue: '売上', opMargin: '営業利益率', equityRatio: '自己資本比率', employees: '従業員数', avgSalary: '平均年収' }
const fmt = (n: number) => n.toLocaleString('ja-JP')
const shortName = (name: string) => name.replace(/株式会社/g, '')
const isSelected = (c: ConditionPrefs, k: ConditionKey) => (k === 'training' ? !!c.training : c[k] !== null)

// =====================================================================
// 希望条件の入力（診断の最後と設定画面で共通）
// =====================================================================
function ConditionEditor({ meta, value, onChange }: { meta: Meta; value: ConditionPrefs; onChange: (v: ConditionPrefs) => void }) {
  const toggle = (k: ConditionKey) => onChange({ ...value, [k]: isSelected(value, k) ? null : CONDITION_DEFAULTS[k] })
  const loc = value.location
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {meta.conditions.map((x) => <Chip key={x.key} active={isSelected(value, x.key)} onClick={() => toggle(x.key)}>{x.label}</Chip>)}
      </div>
      <div className="mt-3 space-y-2.5">
        {value.salary !== null && (
          <Detail label="給与：平均年収がいくら以上か">
            <Segmented label="希望する平均年収" value={value.salary} onChange={(v) => onChange({ ...value, salary: v })}
              options={meta.salaryOptions.map((v) => ({ value: v, label: `${v}万〜` }))} />
          </Detail>
        )}
        {value.holidays !== null && (
          <Detail label="休日：年間休日が何日以上か">
            <Segmented label="希望する年間休日" value={value.holidays} onChange={(v) => onChange({ ...value, holidays: v })}
              options={meta.holidayOptions.map((v) => ({ value: v, label: `${v}日〜` }))} />
          </Detail>
        )}
        {loc && (
          <Detail label="勤務地：働きたい地域（複数選べます）">
            <div className="flex flex-wrap gap-2">
              {meta.regions.map((r) => (
                <Chip key={r} active={loc.regions.includes(r)}
                  onClick={() => onChange({ ...value, location: { ...loc, regions: loc.regions.includes(r) ? loc.regions.filter((x) => x !== r) : [...loc.regions, r] } })}>{r}</Chip>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-navy-500">選ばなければ地域は問いません。フルリモートできる会社は、地域を問わず一致とみなします。</p>
            <div className="mt-2">
              <Chip active={loc.noRelocation} onClick={() => onChange({ ...value, location: { ...loc, noRelocation: !loc.noRelocation } })}>転勤なしを希望</Chip>
            </div>
          </Detail>
        )}
        {value.remote !== null && (
          <Detail label="リモート勤務">
            <Segmented label="リモート勤務の希望" value={value.remote} onChange={(v) => onChange({ ...value, remote: v })}
              options={[{ value: 'partial', label: '一部でも可' }, { value: 'full', label: 'フルリモート希望' }]} />
          </Detail>
        )}
      </div>
    </div>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-navy-100 bg-navy-50/40 p-3">
      <p className="text-xs font-bold text-navy-700 mb-2">{label}</p>
      {children}
    </div>
  )
}

function IndustryPicker({ meta, value, onChange }: { meta: Meta; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (k: string) => {
    if (k === 'undecided') return onChange(value.includes('undecided') ? [] : ['undecided'])
    const base = value.filter((x) => x !== 'undecided')
    onChange(base.includes(k) ? base.filter((x) => x !== k) : [...base, k])
  }
  return (
    <div className="flex flex-wrap gap-2">
      {meta.industryPrefs.map((k) => <Chip key={k} active={value.includes(k)} onClick={() => toggle(k)}>{k}</Chip>)}
      <Chip active={value.includes('undecided')} onClick={() => toggle('undecided')}>まだ決まっていない</Chip>
    </div>
  )
}

// =====================================================================
// 画面
// =====================================================================

// ---- はじめの画面 -------------------------------------------------------
function WelcomeScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex-1 flex flex-col px-6 pt-16 pb-8 lg:pt-20">
      <div className="flex-1 flex flex-col items-center text-center">
        <div className="size-16 rounded-2xl bg-navy-800 text-white flex items-center justify-center mb-6"><Compass size={34} strokeWidth={1.75} /></div>
        <p className="text-sm font-bold text-blue-700 tracking-widest">MITSUKARU</p>
        <h1 className="text-4xl font-bold text-navy-900 mt-1">ミツカル</h1>
        <p className="text-xl font-bold text-navy-800 mt-4 leading-relaxed">自分に合う会社を、<br />根拠つきで。</p>
        <ul className="mt-10 space-y-3 text-left w-full max-w-xs">
          {([
            [<SlidersHorizontal key="i" size={20} />, '8問の価値観診断（約30秒）'],
            [<FileText key="i" size={20} />, '財務・出来事・口コミをAIが要約'],
            [<ShieldCheck key="i" size={20} />, '解説には必ず根拠のデータを表示'],
          ] as [ReactNode, string][]).map(([icon, text], i) => (
            <li key={i} className="flex items-center gap-3 text-navy-700">
              <span className="size-9 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">{icon}</span>
              <span className="font-bold">{text}</span>
            </li>
          ))}
        </ul>
      </div>
      <Btn onClick={onStart} className="w-full text-lg min-h-14 mt-8">30秒で診断をはじめる<ArrowRight size={20} /></Btn>
      <p className="mt-4 text-xs text-navy-500 text-center flex items-center justify-center gap-1">
        <Lock size={12} />入力した内容はあなただけが見られます。いつでも削除できます
      </p>
    </div>
  )
}

// ---- 価値観診断 ---------------------------------------------------------
function QuizScreen(props: {
  meta: Meta; index: number; answers: (number | null)[]; industries: string[]; conditions: ConditionPrefs
  onAnswer: (i: number, v: number) => void; onBack: () => void; onImport: () => void
  setIndustries: (v: string[]) => void; setConditions: (v: ConditionPrefs) => void
}) {
  const { meta, index, answers, onAnswer, onBack } = props
  const total = meta.questions.length
  const isPrefs = index >= total
  const step = Math.min(index + 1, total)
  const [flash, setFlash] = useState<number | null>(null)

  const choose = (v: number) => {
    if (flash !== null) return // 連打で2問進まないように
    setFlash(v)
    setTimeout(() => { setFlash(null); onAnswer(index, v) }, 220)
  }

  // PC：キーボードの1〜5で回答、←で前の質問
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (!isPrefs && /^[1-5]$/.test(e.key)) choose(Number(e.key))
      else if (e.key === 'ArrowLeft') onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="flex-1 flex flex-col px-5 pt-3 pb-4 lg:justify-center lg:py-12">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} className="size-11 -ml-2 inline-flex items-center justify-center rounded-full hover:bg-navy-50" aria-label="戻る"><ChevronLeft size={24} /></button>
        <div className="flex-1 h-2 bg-navy-100 rounded-full overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={isPrefs ? total : index}>
          <div className="h-full bg-blue-600 rounded-full transition-all duration-300" style={{ width: `${((isPrefs ? total : index) / total) * 100}%` }} />
        </div>
        <span className="text-sm font-bold text-navy-700 w-12 text-right tabular-nums">{isPrefs ? '最後' : `${step}/${total}`}</span>
      </div>
      {index === 0 && (
        <button type="button" onClick={props.onImport} className="mt-1 self-start min-h-11 text-sm font-bold text-blue-700 inline-flex items-center gap-1.5 hover:underline">
          <Upload size={16} />適性検査の結果を取り込む
        </button>
      )}

      {!isPrefs ? (
        <>
          <div className="pt-6 lg:pt-8">
            <p className="text-sm font-bold text-blue-700">質問 {step}</p>
            <h2 className="mt-2 text-2xl font-bold leading-snug text-navy-900">{meta.questions[index]}</h2>
          </div>
          {/* スマホ：余白で回答ボタンを画面下部（親指の届く範囲）に押し下げる */}
          <div className="flex-1 min-h-8 lg:flex-none lg:min-h-0 lg:h-8" />
          <div className="space-y-2.5" role="radiogroup" aria-label={meta.questions[index]}>
            {meta.scale.map((label, i) => {
              const v = i + 1
              const selected = flash === v || (flash === null && answers[index] === v)
              return (
                <button key={v} type="button" role="radio" aria-checked={selected} onClick={() => choose(v)}
                  className={`w-full min-h-13 px-4 rounded-xl border text-left font-bold flex items-center gap-3 transition active:scale-[0.99] ${selected ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-navy-200 text-navy-800 hover:bg-navy-50'}`}>
                  <span className={`size-6 rounded-full border-2 flex items-center justify-center shrink-0 ${selected ? 'border-white' : 'border-navy-200'}`}>
                    {selected && <span className="size-2.5 rounded-full bg-white" />}
                  </span>
                  <span className="flex-1">{label}</span>
                  <kbd className={`hidden lg:inline-flex size-6 items-center justify-center rounded border text-xs font-sans ${selected ? 'border-white/60' : 'border-navy-200 text-navy-500'}`}>{v}</kbd>
                </button>
              )
            })}
          </div>
          <div className="mt-2 flex items-center justify-between min-h-11">
            {index > 0 ? (
              <button type="button" onClick={onBack} className="min-h-11 -ml-1 px-1 text-sm font-bold text-navy-600 inline-flex items-center hover:text-navy-900">
                <ChevronLeft size={18} />前の質問に戻る
              </button>
            ) : <span />}
            <span className="hidden lg:inline text-xs text-navy-500">キーボードの 1〜5 でも回答できます</span>
          </div>
        </>
      ) : (
        <>
          <h2 className="mt-6 text-2xl font-bold text-navy-900">最後に2つだけ</h2>
          <p className="mt-1 text-sm text-navy-600">あてはまるものを選んでください。あとから設定で変えられます。</p>
          <h3 className="mt-6 font-bold text-navy-800">志望している業界</h3>
          <div className="mt-2"><IndustryPicker meta={meta} value={props.industries} onChange={props.setIndustries} /></div>
          <h3 className="mt-6 font-bold text-navy-800">重視する条件</h3>
          <p className="text-xs text-navy-500 mt-0.5">選ぶと、細かい希望も指定できます</p>
          <div className="mt-2"><ConditionEditor meta={meta} value={props.conditions} onChange={props.setConditions} /></div>
        </>
      )}
    </div>
  )
}

// ---- 診断結果 -----------------------------------------------------------
function ResultScreen({ meta, me, axes, onFit, onAdjust, onSlide, onReset }: {
  meta: Meta; me: Me; axes: Axes; onFit: () => void; onAdjust: () => void; onSlide: (a: Axes) => void; onReset: () => void
}) {
  const data = meta.axes.map((a) => ({ axis: a.label, value: axes[a.key] }))
  const label = (k: AxisKey) => meta.axes.find((a) => a.key === k)!.label
  const sorted = [...meta.axes.map((a) => a.key)].sort((a, b) => axes[b] - axes[a])
  const [t1, t2] = sorted
  const low = sorted[sorted.length - 1]
  const feedback = me.state.feedback

  return (
    <div className="px-5 pt-5 pb-6 lg:px-8 lg:pt-8">
      <p className="text-sm font-bold text-blue-700">診断結果</p>
      <h2 className="text-xl font-bold text-navy-900 mt-1 lg:text-2xl">あなたの価値観の傾向</h2>
      <div className="lg:grid lg:grid-cols-2 lg:gap-8 lg:items-start">
        <div className="h-64 lg:h-80 -mx-2 mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart data={data} outerRadius="72%">
              <PolarGrid stroke="#c8d1e3" />
              <PolarAngleAxis dataKey="axis" tick={{ fill: '#26365a', fontSize: 12, fontWeight: 700 }} />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} tickCount={5} />
              <Radar dataKey="value" stroke="#2563eb" strokeWidth={2} fill="#2563eb" fillOpacity={0.18} dot={{ r: 4, fill: '#2563eb', strokeWidth: 0 }} isAnimationActive={false} />
              <Tooltip formatter={(v) => [`${v} / 100`, 'スコア']} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <div className="lg:pt-4">
          <Card className="p-4">
            <p className="leading-relaxed text-navy-800">
              回答からは<b>「{label(t1)}」</b>と<b>「{label(t2)}」</b>を重視する傾向が見えます。
              一方で「{label(low)}」はそれほど強く出ていません。
            </p>
            {me.clarity.level === 'low' && (
              <p className="mt-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex gap-1.5"><Info size={16} className="shrink-0 mt-0.5" />{me.clarity.message}</p>
            )}
            <p className="mt-2 text-xs text-navy-500">8問の回答から計算した目安です。あなたを決めつけるものではありません。</p>
          </Card>

          <div className="mt-5">
            <p className="font-bold text-navy-900">この結果はしっくりきますか？</p>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <Btn variant={feedback === 'fit' ? 'primary' : 'secondary'} ariaPressed={feedback === 'fit'} onClick={onFit}>しっくりくる</Btn>
              <Btn variant={feedback === 'adjust' ? 'primary' : 'secondary'} ariaPressed={feedback === 'adjust'} onClick={onAdjust}>少し違う</Btn>
            </div>
            {feedback === 'fit' && <p className="mt-3 text-sm text-navy-700">ありがとうございます。この結果をもとに、合いそうな企業を探します。</p>}
            {feedback === 'adjust' && (
              <Card className="mt-3 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-bold text-navy-800 flex items-center gap-1.5"><SlidersHorizontal size={18} />自分で調整する</p>
                  <button type="button" className="min-h-11 px-2 text-sm font-bold text-blue-700" onClick={onReset}>元に戻す</button>
                </div>
                <div className="mt-2 space-y-2">
                  {meta.axes.map((a) => (
                    <label key={a.key} className="block">
                      <span className="flex justify-between text-sm font-bold text-navy-700"><span>{a.label}</span><span className="tabular-nums">{axes[a.key]}</span></span>
                      <input type="range" min={0} max={100} step={5} value={axes[a.key]} className="w-full h-11"
                        onChange={(e) => onSlide({ ...axes, [a.key]: Number(e.target.value) })} />
                    </label>
                  ))}
                </div>
                <p className="text-xs text-navy-500">調整した結果は自動で保存され、相性スコアに反映されます。</p>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- 候補企業の一覧 -----------------------------------------------------
function FilterControls({ meta, filter, setFilter }: { meta: Meta; filter: ListFilter; setFilter: (f: ListFilter) => void }) {
  const toggleCond = (k: ConditionKey) =>
    setFilter({ ...filter, conds: filter.conds.includes(k) ? filter.conds.filter((x) => x !== k) : [...filter.conds, k] })
  return (
    <div className="space-y-4 lg:space-y-3">
      <div className="lg:flex lg:items-center lg:gap-3">
        <p className="text-sm font-bold text-navy-800 mb-2 lg:mb-0 lg:w-20 shrink-0">業界</p>
        <div className="flex flex-wrap gap-2">
          <Chip active={filter.industry === 'all'} onClick={() => setFilter({ ...filter, industry: 'all' })}>すべての業界</Chip>
          {meta.industries.map((ind) => <Chip key={ind} active={filter.industry === ind} onClick={() => setFilter({ ...filter, industry: ind })}>{ind}</Chip>)}
        </div>
      </div>
      <div className="lg:flex lg:items-start lg:gap-3">
        <p className="text-sm font-bold text-navy-800 mb-2 lg:mb-0 lg:w-20 lg:pt-3 shrink-0">条件</p>
        <div>
          <div className="flex flex-wrap gap-2">
            {meta.conditions.map((x) => <Chip key={x.key} active={filter.conds.includes(x.key)} onClick={() => toggleCond(x.key)}>{x.label}</Chip>)}
          </div>
          <p className="mt-1.5 text-xs text-navy-500">基準は設定の「希望条件」です（未設定の項目は標準の基準を使います）。</p>
        </div>
      </div>
      <div className="lg:flex lg:items-center lg:gap-3">
        <p className="text-sm font-bold text-navy-800 mb-2 lg:mb-0 lg:w-20 shrink-0">並べ替え</p>
        <div className="lg:w-96">
          <div className="grid grid-cols-3 bg-navy-50 border border-navy-100 rounded-xl p-1" role="tablist" aria-label="並べ替え">
            {SORTS.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={filter.sort === k} onClick={() => setFilter({ ...filter, sort: k })}
                className={`min-h-11 rounded-lg text-sm font-bold ${filter.sort === k ? 'bg-white text-navy-900 shadow-sm' : 'text-navy-600 hover:text-navy-900'}`}>{label}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ListScreen({ meta, rows, filter, setFilter, compareIds, toggleCompare, onOpen, filterOpen, setFilterOpen }: {
  meta: Meta; rows: CompanyListItem[] | null; filter: ListFilter; setFilter: (f: ListFilter) => void
  compareIds: string[]; toggleCompare: (id: string) => void; onOpen: (id: string) => void
  filterOpen: boolean; setFilterOpen: (v: boolean) => void
}) {
  const sortLabel = SORTS.find(([k]) => k === filter.sort)![1]
  const condLabel = (k: ConditionKey) => meta.conditions.find((x) => x.key === k)!.label
  return (
    <div className="pt-4 pb-6 lg:px-6 lg:pt-6">
      <div className="px-5 lg:px-0">
        <h2 className="text-xl font-bold text-navy-900 lg:sr-only">合いそうな企業</h2>
        <p className="text-sm text-navy-600 mt-1 lg:mt-0">知名度ではなく、診断結果と条件に近い順。知らなかった会社にも出会えます。</p>
      </div>
      <div className="hidden lg:block mt-4 p-4 rounded-2xl border border-navy-100 bg-navy-50/40">
        <FilterControls meta={meta} filter={filter} setFilter={setFilter} />
      </div>
      <div className="px-5 lg:px-0 mt-3 flex flex-wrap items-center gap-2">
        <p className="text-sm text-navy-700 mr-1"><b className="text-navy-900 tabular-nums">{rows ? `${rows.length}社` : '—'}</b>・{sortLabel}</p>
        <span className="contents lg:hidden">
          {filter.industry !== 'all' && <RemovableChip label={filter.industry} onRemove={() => setFilter({ ...filter, industry: 'all' })} />}
          {filter.conds.map((k) => <RemovableChip key={k} label={condLabel(k)} onRemove={() => setFilter({ ...filter, conds: filter.conds.filter((x) => x !== k) })} />)}
        </span>
      </div>

      <div className="mt-3 px-4 lg:px-0 grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4" aria-busy={rows === null}>
        {rows === null && [0, 1, 2].map((i) => <Card key={i} className="p-4"><Skeleton lines={3} /></Card>)}
        {rows?.map((c) => {
          const checked = compareIds.includes(c.id)
          return (
            <Card key={c.id} className="overflow-hidden flex flex-col">
              <button type="button" onClick={() => onOpen(c.id)} className="flex-1 w-full text-left p-4 flex flex-col justify-start hover:bg-navy-50/50 active:bg-navy-50">
                <div className="flex items-start gap-3 w-full">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-navy-500 flex items-center gap-2">
                      {c.industry}
                      {c.viewed && <span className="inline-flex items-center gap-0.5 text-blue-700"><Eye size={12} />今月閲覧済み</span>}
                    </p>
                    <h3 className="mt-0.5 text-lg font-bold text-navy-900 leading-snug">{c.name}</h3>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[11px] font-bold text-navy-500">相性</p>
                    <p className="text-2xl font-bold text-blue-700 tabular-nums leading-none">{c.score}<span className="text-sm">%</span></p>
                  </div>
                </div>
                <p className="mt-2 text-sm text-navy-700 leading-relaxed">{c.reason}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">{c.tags.map((t) => <Tag key={t}>{t}</Tag>)}</div>
              </button>
              <div className="flex border-t border-navy-100">
                <button type="button" onClick={() => onOpen(c.id)} className="flex-1 min-h-12 inline-flex items-center justify-center gap-1 text-sm font-bold text-navy-700 hover:bg-navy-50">
                  カルテを見る<ChevronRight size={18} />
                </button>
                <button type="button" onClick={() => toggleCompare(c.id)} aria-pressed={checked}
                  className={`flex-1 min-h-12 inline-flex items-center justify-center gap-2 text-sm font-bold border-l border-navy-100 ${checked ? 'text-blue-700 bg-blue-50' : 'text-navy-700 hover:bg-navy-50'}`}>
                  {checked ? <SquareCheckBig size={20} /> : <Square size={20} />}比較に追加
                </button>
              </div>
            </Card>
          )
        })}
        {rows?.length === 0 && (
          <Card className="p-6 text-center lg:col-span-2">
            <p className="font-bold text-navy-800">この条件に合う企業は見つかりませんでした</p>
            <p className="text-sm text-navy-600 mt-1">条件を1つ外すと、候補が見つかるかもしれません。</p>
            <Btn variant="secondary" className="mt-4" onClick={() => setFilter({ ...defaultFilter, sort: filter.sort })}>絞り込みを解除する</Btn>
          </Card>
        )}
      </div>

      <Sheet open={filterOpen} onClose={() => setFilterOpen(false)} title="絞り込み・並べ替え"
        footer={
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <Btn variant="secondary" onClick={() => setFilter(defaultFilter)}>リセット</Btn>
            <Btn onClick={() => setFilterOpen(false)}>{rows ? `${rows.length}社を表示` : '表示する'}</Btn>
          </div>
        }>
        <FilterControls meta={meta} filter={filter} setFilter={setFilter} />
      </Sheet>
    </div>
  )
}

// ---- 企業カルテ ---------------------------------------------------------
type KarteTab = 'overview' | 'numbers' | 'history' | 'reviews'

/** 相性スコアの内訳（どう計算したかを見せることで、結果を確かめられるようにする） */
function ScoreBreakdown({ m }: { m: MatchResult }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="min-h-11 text-sm font-bold text-blue-700 inline-flex items-center gap-1 hover:underline">
        スコアの内訳を{open ? '閉じる' : '見る'}<ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-1 rounded-2xl border border-navy-100 p-4 space-y-5">
          <div>
            <p className="text-sm font-bold text-navy-900">相性スコア {m.score}% の内訳</p>
            <ul className="mt-2 space-y-3">
              {m.components.map((c) => (
                <li key={c.key}>
                  <div className="flex justify-between text-sm">
                    <span className="font-bold text-navy-800">{c.label}<span className="text-xs text-navy-500 font-normal">（重み{Math.round(c.weight * 100)}%）</span></span>
                    <span className="tabular-nums font-bold text-navy-900">{c.score}点</span>
                  </div>
                  <div className="mt-1 h-2 bg-navy-100 rounded-full overflow-hidden"><div className="h-full bg-blue-600 rounded-full" style={{ width: `${c.score}%` }} /></div>
                  <p className="text-xs text-navy-500 mt-0.5">{c.detail}</p>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-bold text-navy-900">価値観の比較</p>
            <p className="mt-1 text-xs text-navy-600 flex items-center gap-3">
              <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-2.5 rounded-sm bg-navy-300" />この会社の特徴</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block w-1 h-3.5 rounded-sm bg-blue-600" />あなたの希望</span>
            </p>
            <ul className="mt-2 space-y-2">
              {m.axes.map((a) => (
                <li key={a.axis} className="grid grid-cols-[4.5rem_1fr_3.5rem] items-center gap-2" aria-label={`${a.label}：あなた${a.you}、会社${a.company}`}>
                  <span className="text-xs font-bold text-navy-700">{a.label}</span>
                  <div className="relative h-3 bg-navy-50 rounded-full">
                    <div className="absolute inset-y-0 left-0 bg-navy-300 rounded-full" style={{ width: `${a.company}%` }} />
                    <div className="absolute -top-1 -bottom-1 w-1 bg-blue-600 rounded" style={{ left: `calc(${a.you}% - 2px)` }} />
                  </div>
                  <span className="text-xs tabular-nums text-navy-600 text-right">{a.you}／{a.company}</span>
                </li>
              ))}
            </ul>
          </div>
          {m.conditions.length > 0 && (
            <div>
              <p className="text-sm font-bold text-navy-900">重視する条件</p>
              <ul className="mt-1 divide-y divide-navy-100">
                {m.conditions.map((c) => (
                  <li key={c.key} className="py-2 flex items-center justify-between gap-2">
                    <span className="text-sm text-navy-800"><b>{c.label}</b><span className="block text-xs text-navy-500">{c.detail}</span></span>
                    <StatusBadge status={c.status} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs leading-relaxed text-navy-500">
            価値観の近さは、あなたの希望より会社が足りない分をそのまま、強すぎる分を半分だけ差し引いて計算しています。
            あなたが高く付けた軸ほど重く数えます。企業の知名度は使っていません。
          </p>
        </div>
      )}
    </div>
  )
}

function KarteScreen({ companyId, reloadKey, onUpgrade, onError }: {
  companyId: string; reloadKey: string; onUpgrade: () => void; onError: (e: unknown) => void
}) {
  const [c, setC] = useState<CompanyDetail | null>(null)
  const [ai, setAi] = useState<AiCommentary | null>(null)
  const [aiFailed, setAiFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [tab, setTab] = useState<KarteTab>('overview')
  const [q, setQ] = useState<FollowUpId | null>(null)
  const [answer, setAnswer] = useState<FollowUpAnswer | null>(null)
  const answerRef = useRef<HTMLDivElement>(null)
  const askSeq = useRef(0)

  useEffect(() => { setTab('overview'); setC(null) }, [companyId])
  useEffect(() => {
    let alive = true
    setAi(null); setAiFailed(false); setQ(null); setAnswer(null)
    api.getCompanyDetail(companyId)
      .then((d) => {
        if (!alive) return
        setC(d)
        return withMinDelay(api.getAiCommentary(companyId), 600)
          .then((r) => { if (alive) setAi(r) })
          .catch((e) => { if (alive) { setAiFailed(true); onError(e) } })
      })
      .catch((e) => { if (alive) onError(e) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, reloadKey, retry])

  useEffect(() => {
    if (q) answerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [q, answer])

  const ask = (id: FollowUpId) => {
    const seq = ++askSeq.current
    setQ(id); setAnswer(null)
    withMinDelay(api.getFollowUpAnswer(companyId, id), 500)
      .then((r) => { if (askSeq.current === seq) setAnswer(r) })
      .catch(onError)
  }

  if (!c) return <div className="p-5"><Skeleton lines={6} /></div>
  const m = c.match
  const tabs: [KarteTab, string][] = [['overview', '概要'], ['numbers', '数字で見る'], ['history', '過去の出来事'], ['reviews', '社風・口コミ']]
  const formatValue = (key: string, v: number) => (key === 'revenue' ? `${fmt(v)}億円` : key === 'employees' ? `${fmt(v)}人` : key === 'avgSalary' ? `${v}万円` : `${v}%`)

  return (
    <div className="pb-6 flex flex-col lg:flex-row lg:items-start lg:gap-6 lg:px-6">
      <div className="contents lg:block lg:flex-1 lg:min-w-0">
        <div className="order-1 px-5 pt-4 lg:px-0 lg:pt-6">
          <p className="text-xs font-bold text-navy-500">{c.industry}</p>
          <h2 className="text-2xl font-bold text-navy-900 leading-snug">{c.name}</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">{c.tags.map((t) => <Tag key={t}>{t}</Tag>)}</div>
          <div className="mt-3 flex items-center gap-3">
            <div className="bg-blue-50 border border-blue-100 rounded-xl px-3 py-2 shrink-0">
              <p className="text-xs font-bold text-navy-600"><Term k="相性スコア" /></p>
              <p className="text-2xl font-bold text-blue-700 tabular-nums">{m.score}<span className="text-sm">%</span></p>
            </div>
            <p className="text-sm text-navy-700 leading-relaxed">{m.reason}</p>
          </div>
          <ScoreBreakdown m={m} />
        </div>

        <div className="order-3 mt-4">
          <div className="sticky top-14 z-10 bg-white border-b border-navy-100">
            <div className="flex overflow-x-auto no-scrollbar px-2 lg:px-0" role="tablist">
              {tabs.map(([k, label]) => (
                <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={`min-h-12 px-3 text-sm font-bold whitespace-nowrap border-b-2 ${tab === k ? 'border-blue-600 text-navy-900' : 'border-transparent text-navy-500 hover:text-navy-800'}`}>{label}</button>
              ))}
            </div>
          </div>
          <div className="px-5 pt-4 lg:px-0">
            {tab === 'overview' && (
              <div>
                <h3 className="font-bold text-navy-900">何で稼いでいる会社？</h3>
                <ol className="mt-2 space-y-2">
                  {c.overview.map((l, i) => <li key={i} className="flex gap-2 leading-relaxed text-navy-800"><span className="font-bold text-blue-700 tabular-nums">{i + 1}.</span>{l}</li>)}
                </ol>
                <dl className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-2 text-sm">
                  <div className="bg-navy-50 rounded-xl p-3"><dt className="text-navy-500 text-xs font-bold"><Term k="年間休日" /></dt><dd className="font-bold text-navy-900 mt-0.5">{c.holidays}日</dd></div>
                  <div className="bg-navy-50 rounded-xl p-3"><dt className="text-navy-500 text-xs font-bold">リモート勤務</dt><dd className="font-bold text-navy-900 mt-0.5">{c.remote}</dd></div>
                  <div className="bg-navy-50 rounded-xl p-3"><dt className="text-navy-500 text-xs font-bold">転勤</dt><dd className="font-bold text-navy-900 mt-0.5">{c.noRelocation ? 'なし' : 'あり'}</dd></div>
                  <div className="bg-navy-50 rounded-xl p-3"><dt className="text-navy-500 text-xs font-bold">研修</dt><dd className="font-bold text-navy-900 mt-0.5">{c.training ? '充実' : 'OJT中心'}</dd></div>
                </dl>
                <h3 className="mt-5 font-bold text-navy-900 flex items-center gap-1.5"><MapPin size={16} className="text-blue-600" />勤務地（拠点）</h3>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">{c.offices.map((o) => <li key={o.city}><Tag>{o.city}</Tag></li>)}</ul>
              </div>
            )}

            {tab === 'numbers' && (
              <div>
                <ul className="divide-y divide-navy-100">
                  {c.metricEvals.map((ev) => (
                    <li key={ev.key} className="py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-bold text-navy-700"><Term k={METRIC_TERM[ev.key]} /></span>
                        <span className="text-lg font-bold text-navy-900 tabular-nums">{formatValue(ev.key, ev.value)}</span>
                      </div>
                      {ev.industryAvg !== null && (
                        <p className="text-xs text-navy-500 text-right tabular-nums">
                          <Term k="業界平均">業界平均</Term> {ev.key === 'revenue' ? `売上の伸び 年+${ev.industryAvg}%` : formatValue(ev.key, ev.industryAvg)}
                        </p>
                      )}
                      <p className="mt-1 text-sm text-navy-600 flex items-start gap-2"><LevelBadge level={ev.level}>{ev.badge}</LevelBadge><span>{ev.text}</span></p>
                    </li>
                  ))}
                </ul>
                <h3 className="mt-5 font-bold text-navy-900">過去5年の推移</h3>
                <div className="lg:grid lg:grid-cols-2 lg:gap-4">
                  <MiniLine title="売上（億円）" data={c.history} dataKey="revenue" color="#1b2747" />
                  <MiniLine title="営業利益（億円）" data={c.history} dataKey="profit" color="#2563eb" />
                </div>
                <p className="mt-2 text-xs text-navy-500">出典：<Term k="有価証券報告書">有価証券報告書</Term> 2021〜2025年度（サンプル）・業界平均は業界統計（サンプル値）</p>
              </div>
            )}

            {tab === 'history' && (
              <div>
                <Timeline events={c.events} />
                <LockedPlaceholder count={c.lockedEvents} unit="件の出来事" onUpgrade={onUpgrade} />
                <p className="mt-3 text-xs text-navy-500">出典：会社発表・報道の要約（サンプル）</p>
              </div>
            )}

            {tab === 'reviews' && (
              <div>
                <p className="text-sm text-navy-600">投稿{c.reviews.count}件を要約しています。社風をひとことで言うと「{c.culture}」。</p>
                <ReviewGroup kind="good" items={c.reviews.good} />
                <ReviewGroup kind="concern" items={c.reviews.concern} />
                <LockedPlaceholder count={c.lockedReviews} unit="件の口コミ" onUpgrade={onUpgrade} />
                <p className="mt-3 text-xs text-navy-500">出典：口コミ要約（サンプル）</p>
              </div>
            )}
          </div>
        </div>

        <section className="order-4 px-5 mt-8 lg:px-0">
          <h3 className="font-bold text-navy-900 flex items-center gap-1.5"><MessageCircle size={18} className="text-blue-600" />もっと知りたい</h3>
          <div className="mt-2 grid grid-cols-1 lg:grid-cols-2 gap-2">
            {FOLLOW_UPS.map((f) => (
              <button key={f.id} type="button" onClick={() => ask(f.id)} aria-pressed={q === f.id}
                className={`min-h-12 px-4 rounded-xl border text-left font-bold text-sm flex items-center justify-between transition active:scale-[0.99] ${q === f.id ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-navy-200 bg-white text-navy-800 hover:bg-navy-50'}`}>
                {f.label}<ChevronRight size={18} />
              </button>
            ))}
          </div>
          {q && (
            <div ref={answerRef} className="scroll-mb-44 lg:scroll-mb-28">
              <Card className="mt-3 p-4">
                <p className="text-sm font-bold text-navy-900 flex items-center gap-1.5"><Sparkles size={16} className="text-blue-600" />{FOLLOW_UPS.find((f) => f.id === q)!.label}</p>
                {!answer ? <div className="mt-3"><Skeleton lines={3} /></div> : (
                  <>
                    <p className="mt-2 text-[15px] leading-relaxed text-navy-800"><CitedText item={answer} /></p>
                    <details className="mt-2 group">
                      <summary className="min-h-11 flex items-center gap-1 text-sm font-bold text-blue-700 cursor-pointer list-none">
                        <ShieldCheck size={16} />この回答の根拠（{answer.evidence.length}件）<ChevronDown size={16} className="group-open:rotate-180 transition-transform" />
                      </summary>
                      <EvidenceList evidence={answer.evidence} compact />
                    </details>
                    <AiSourceNote meta={answer} />
                  </>
                )}
              </Card>
            </div>
          )}
        </section>
      </div>

      <aside className="order-2 lg:w-[380px] lg:shrink-0 lg:sticky lg:top-14 lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto lg:pt-6 lg:pb-2">
        <section className="mx-4 mt-5 lg:mx-0 lg:mt-0 rounded-2xl border border-navy-200 bg-navy-50/60 p-4" aria-live="polite">
          <h3 className="font-bold text-navy-900 flex items-center gap-1.5"><Sparkles size={18} className="text-blue-600" />AIの解説</h3>
          {aiFailed ? (
            <div className="mt-3">
              <p className="text-sm text-navy-700">解説を読み込めませんでした。</p>
              <Btn variant="secondary" className="mt-2 text-sm" onClick={() => setRetry((n) => n + 1)}><RefreshCw size={16} />もう一度読み込む</Btn>
            </div>
          ) : !ai ? (
            <div className="mt-3">
              <p className="text-sm text-navy-600 mb-3">データを読み込んで解説を作成しています…</p>
              <Skeleton lines={5} />
            </div>
          ) : (
            <>
              <ol className="mt-3 space-y-2">
                {ai.lines.map((l, i) => (
                  <li key={i} className="text-[15px] leading-relaxed text-navy-800 flex gap-2">
                    <span className="text-navy-400 shrink-0">・</span><span><CitedText item={l} /></span>
                  </li>
                ))}
              </ol>
              <div className="mt-4 bg-white rounded-xl border border-navy-100 p-3">
                <p className="text-sm font-bold text-navy-900">あなたとの相性</p>
                <p className="mt-1 text-[15px] leading-relaxed text-navy-800"><CitedText item={ai.fit} /></p>
              </div>
              <AiSourceNote meta={ai} />
            </>
          )}
        </section>

        <section className="mx-4 mt-3 lg:mx-0 rounded-2xl border border-navy-100 bg-white p-4">
          <h3 className="font-bold text-navy-900 flex items-center gap-1.5"><ShieldCheck size={18} className="text-blue-600" />この解説の根拠</h3>
          {!ai ? <div className="mt-3"><Skeleton lines={3} /></div> : <EvidenceList evidence={ai.evidence} />}
        </section>
      </aside>
    </div>
  )
}

// ---- 企業比較 -----------------------------------------------------------
function CompareScreen({ plan, compareIds, reloadKey, onRemove, onOpen, onGoList, onError }: {
  plan: Plan; compareIds: string[]; reloadKey: string; onRemove: (id: string) => void; onOpen: (id: string) => void
  onGoList: () => void; onError: (e: unknown) => void
}) {
  const [cols, setCols] = useState<CompareColumn[] | null>(null)
  const [summary, setSummary] = useState<CompareCommentary | null>(null)
  const ids = compareIds.join(',')
  useEffect(() => {
    if (compareIds.length < 2) return
    let alive = true
    setSummary(null)
    api.getCompareTable().then((r) => alive && setCols(r.companies)).catch((e) => alive && onError(e))
    withMinDelay(api.getCompareCommentary(), 600).then((r) => alive && setSummary(r)).catch((e) => alive && onError(e))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, reloadKey])

  if (compareIds.length < 2) {
    return (
      <div className="flex-1 flex flex-col px-5 pt-10 pb-6 text-center lg:max-w-md lg:mx-auto lg:pt-20">
        <div className="size-14 mx-auto rounded-2xl bg-navy-50 text-navy-600 flex items-center justify-center"><Columns3 size={28} /></div>
        <h2 className="mt-4 text-xl font-bold text-navy-900">比較する企業を選びましょう</h2>
        <p className="mt-2 text-sm text-navy-600">企業一覧で「比較に追加」を2社以上選ぶと、ここに比較表が出ます。<br />（{plan === 'free' ? '無料プランは2社まで' : '有料プランは3社まで'}・いま{compareIds.length}社選択中）</p>
        <div className="flex-1 min-h-8 lg:flex-none lg:h-6" />
        <Btn className="w-full" onClick={onGoList}>企業一覧から選ぶ<ArrowRight size={18} /></Btn>
      </div>
    )
  }
  if (!cols) return <div className="p-5"><Skeleton lines={8} /></div>
  const list = compareIds.map((id) => cols.find((c) => c.id === id)).filter((c): c is CompareColumn => !!c)

  const remoteRank = { 可: 2, 一部可: 1, 不可: 0 }
  const hasConds = list.some((c) => c.conditions.length > 0)
  const rows: { label: ReactNode; get: (c: CompareColumn) => { text: string; num: number | null } }[] = [
    { label: <Term k="相性スコア" />, get: (c) => ({ text: `${c.score}%`, num: c.score }) },
    ...(hasConds ? [{ label: '条件の一致', get: (c: CompareColumn) => { const met = c.conditions.filter((x) => x.status === 'met').length; return { text: `${met}/${c.conditions.length}件`, num: met } } }] : []),
    { label: <Term k="売上の伸び" />, get: (c) => ({ text: `年${c.growth >= 0 ? '+' : ''}${c.growth.toFixed(1)}%`, num: c.growth }) },
    { label: <Term k="営業利益率" />, get: (c) => ({ text: `${c.opMargin}%`, num: c.opMargin }) },
    { label: <Term k="自己資本比率" />, get: (c) => ({ text: `${c.equityRatio}%`, num: c.equityRatio }) },
    { label: <Term k="平均年収" />, get: (c) => ({ text: `${c.avgSalary}万円`, num: c.avgSalary }) },
    { label: <Term k="年間休日" />, get: (c) => ({ text: `${c.holidays}日`, num: c.holidays }) },
    { label: 'リモート', get: (c) => ({ text: c.remote, num: remoteRank[c.remote] }) },
    { label: '社風の一言', get: (c) => ({ text: c.culture, num: null }) },
  ]

  return (
    <div className="pt-4 pb-6 lg:px-6 lg:pt-6">
      <div className="px-5 lg:px-0">
        <h2 className="text-xl font-bold text-navy-900 lg:sr-only">企業を比較</h2>
        <p className="text-sm text-navy-600 mt-1 lg:mt-0 flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-800 border border-blue-200 rounded px-1.5 text-xs font-bold"><Check size={12} />最良</span>
          は各項目で最も良い値です<span className="lg:hidden">{list.length >= 3 && '（横にスクロールできます）'}</span>
        </p>
      </div>
      <div className="mt-3 overflow-x-auto lg:overflow-visible lg:border lg:border-navy-100 lg:rounded-2xl">
        <table className="border-separate border-spacing-0 text-sm lg:w-full" style={{ minWidth: 96 + list.length * 136 }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white w-24 min-w-24 lg:w-36 border-b border-navy-200" />
              {list.map((c) => (
                <th key={c.id} className="min-w-[136px] px-2 py-2 border-b border-navy-200 align-top text-left">
                  <div className="flex items-start gap-1">
                    <button type="button" onClick={() => onOpen(c.id)} className="flex-1 text-left font-bold text-navy-900 leading-snug min-h-11 hover:text-blue-700 hover:underline">
                      {shortName(c.name)}<span className="block text-xs font-normal text-navy-500">{c.industry}</span>
                    </button>
                    <button type="button" onClick={() => onRemove(c.id)} aria-label={`${c.name}を比較から外す`}
                      className="size-11 -mr-2 -mt-2 inline-flex items-center justify-center rounded-full text-navy-400 hover:text-navy-700 hover:bg-navy-50"><X size={18} /></button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const vals = list.map(r.get)
              const nums = vals.map((v) => v.num).filter((n): n is number => n !== null)
              const max = nums.length ? Math.max(...nums) : null
              const allSame = nums.length > 0 && nums.every((n) => n === nums[0])
              return (
                <tr key={i}>
                  <th scope="row" className="sticky left-0 z-10 bg-white text-left font-bold text-navy-700 pl-4 pr-2 py-3 border-b border-navy-100 align-top text-xs lg:text-sm">{r.label}</th>
                  {vals.map((v, j) => {
                    const best = max !== null && !allSame && v.num === max
                    return (
                      <td key={j} className={`px-2 py-3 border-b border-navy-100 align-top ${best ? 'bg-blue-50' : ''}`}>
                        <span className={`${best ? 'font-bold text-blue-800' : 'text-navy-800'} ${v.num === null ? 'text-xs leading-relaxed lg:text-sm' : 'tabular-nums'}`}>{v.text}</span>
                        {best && <span className="ml-1 inline-flex align-middle text-blue-700" aria-label="最良"><Check size={14} strokeWidth={2.5} /></span>}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <section className="mx-4 mt-5 lg:mx-0 rounded-2xl border border-navy-200 bg-navy-50/60 p-4" aria-live="polite">
        <h3 className="font-bold text-navy-900 flex items-center gap-1.5"><Sparkles size={18} className="text-blue-600" />あなたの重視する条件で見ると</h3>
        {!summary ? <div className="mt-3"><Skeleton lines={3} /></div> : (
          <>
            <ul className="mt-2 space-y-1.5">
              {summary.lines.map((s, i) => <li key={i} className="text-[15px] leading-relaxed text-navy-800 flex gap-2"><span className="text-navy-400">・</span><span><CitedText item={s} /></span></li>)}
            </ul>
            <details className="mt-2 group">
              <summary className="min-h-11 flex items-center gap-1 text-sm font-bold text-blue-700 cursor-pointer list-none">
                <ShieldCheck size={16} />このまとめの根拠（{summary.evidence.length}件）<ChevronDown size={16} className="group-open:rotate-180 transition-transform" />
              </summary>
              <EvidenceList evidence={summary.evidence} compact />
            </details>
            <AiSourceNote meta={summary} />
          </>
        )}
      </section>
      {plan === 'free' && <p className="mx-5 lg:mx-0 mt-3 text-xs text-navy-500">無料プランでは2社まで比較できます。有料プランなら3社を並べられます。</p>}
    </div>
  )
}

// ---- ホーム -------------------------------------------------------------
function HomeScreen({ meta, me, setItems, nextAction, onFeature, onSeeResult }: {
  meta: Meta; me: Me; setItems: (v: HomeItem[]) => void
  nextAction: { text: string; onClick: () => void }; onFeature: (id: FeatureId) => void; onSeeResult: () => void
}) {
  const [editing, setEditing] = useState(false)
  const items = me.state.home
  const top = [...meta.axes].sort((a, b) => me.axes[b.key] - me.axes[a.key]).slice(0, 2)
  const move = (i: number, d: -1 | 1) => {
    const next = [...items]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    setItems(next)
  }
  const visible = items.filter((x) => x.visible)

  return (
    <div className="px-5 pt-4 pb-6 lg:px-8 lg:pt-8 lg:max-w-3xl">
      <button type="button" onClick={nextAction.onClick} className="w-full text-left rounded-2xl bg-navy-800 text-white p-4 flex items-center gap-3 hover:bg-navy-700 transition active:scale-[0.99]">
        <div className="flex-1">
          <p className="text-xs font-bold text-blue-200">次にやること</p>
          <p className="mt-1 font-bold leading-snug">{nextAction.text}</p>
        </div>
        <span className="size-10 rounded-full bg-white/10 flex items-center justify-center shrink-0"><ArrowRight size={20} /></span>
      </button>

      <button type="button" onClick={onSeeResult} className="mt-3 w-full min-h-11 text-left text-sm text-navy-600 flex items-center gap-1 hover:text-navy-900">
        あなたの傾向：<b className="text-navy-800">{top.map((a) => a.label).join('・')}</b>を重視<ChevronRight size={16} className="ml-auto" />
      </button>

      <h2 className="mt-4 text-xl font-bold text-navy-900">今日はどれを使う？</h2>
      {!editing ? (
        <>
          <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-2.5">
            {visible.map(({ id }) => {
              const f = HOME_FEATURES[id]
              return (
                <button key={id} type="button" onClick={() => onFeature(id)}
                  className="w-full min-h-16 rounded-2xl border border-navy-100 bg-white px-4 py-3 flex items-center gap-3 text-left hover:bg-navy-50 transition active:scale-[0.99]">
                  <span className="size-11 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">{f.icon}</span>
                  <span className="flex-1">
                    <span className="block font-bold text-navy-900">{f.label}</span>
                    <span className="block text-xs text-navy-500">{f.desc}</span>
                  </span>
                  <ChevronRight size={20} className="text-navy-400" />
                </button>
              )
            })}
            {visible.length === 0 && <p className="text-sm text-navy-500 py-6 text-center lg:col-span-2">表示する機能がありません。下の「機能を並べ替える」から表示を戻せます。</p>}
          </div>
          <button type="button" onClick={() => setEditing(true)} className="mt-3 w-full min-h-12 rounded-xl text-sm font-bold text-blue-700 inline-flex items-center justify-center gap-1.5 hover:bg-blue-50">
            <SlidersHorizontal size={16} />機能を並べ替える
          </button>
        </>
      ) : (
        <div className="mt-3">
          <p className="text-xs text-navy-500 mb-2">目のマークで表示・非表示、矢印で順番を変えられます。自動で保存されます。</p>
          <ul className="space-y-2">
            {items.map((it, i) => (
              <li key={it.id} className={`rounded-2xl border px-2 py-1.5 flex items-center gap-1 ${it.visible ? 'border-navy-200 bg-white' : 'border-navy-100 bg-navy-50 text-navy-400'}`}>
                <button type="button" aria-label={it.visible ? '非表示にする' : '表示する'} aria-pressed={it.visible}
                  onClick={() => setItems(items.map((x) => (x.id === it.id ? { ...x, visible: !x.visible } : x)))}
                  className="size-11 inline-flex items-center justify-center rounded-lg hover:bg-navy-50">
                  {it.visible ? <Eye size={20} className="text-blue-700" /> : <EyeOff size={20} />}
                </button>
                <span className="flex-1 font-bold">{HOME_FEATURES[it.id].label}</span>
                <button type="button" aria-label="上へ" disabled={i === 0} onClick={() => move(i, -1)} className="size-11 inline-flex items-center justify-center rounded-lg hover:bg-navy-50 disabled:opacity-30"><ChevronUp size={20} /></button>
                <button type="button" aria-label="下へ" disabled={i === items.length - 1} onClick={() => move(i, 1)} className="size-11 inline-flex items-center justify-center rounded-lg hover:bg-navy-50 disabled:opacity-30"><ChevronDown size={20} /></button>
              </li>
            ))}
          </ul>
          <Btn className="w-full mt-4 lg:w-auto lg:px-10" onClick={() => setEditing(false)}><Check size={18} />完了</Btn>
        </div>
      )}
    </div>
  )
}

// ---- 設定 ---------------------------------------------------------------
function SettingsScreen({ meta, me, onPlan, onNextMonth, onDelete, onRetake, onIndustries, onConditions }: {
  meta: Meta; me: Me; onPlan: (p: Plan) => void; onNextMonth: () => void; onDelete: () => void; onRetake: () => void
  onIndustries: (v: string[]) => void; onConditions: (v: ConditionPrefs) => void
}) {
  const plan = me.state.plan
  const u = me.usage
  // 希望条件は入力のたびにサーバーへ送るので、画面上はローカルの値ですぐ反応させる
  const [industries, setIndustries] = useState(me.state.industries)
  const [conditions, setConditions] = useState(me.state.conditions)

  return (
    <div className="px-5 pt-4 pb-6 lg:px-8 lg:pt-8 grid gap-4 lg:grid-cols-2 lg:items-start">
      <h2 className="text-xl font-bold text-navy-900 lg:sr-only">設定</h2>

      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-bold text-navy-900">プラン</p>
            <p className="text-sm text-navy-600">{plan === 'paid' ? '有料プラン（月300〜500円を想定）' : '無料プラン'}</p>
          </div>
          <button type="button" role="switch" aria-checked={plan === 'paid'} aria-label="有料プランに切り替える（デモ用）"
            onClick={() => onPlan(plan === 'paid' ? 'free' : 'paid')} className="min-h-11 px-1 -mr-1 inline-flex items-center gap-2 rounded-xl">
            <span className="text-xs font-bold text-navy-500">無料</span>
            <span className={`relative w-14 h-8 rounded-full transition-colors ${plan === 'paid' ? 'bg-blue-600' : 'bg-navy-200'}`}>
              <span className={`absolute top-1 left-1 size-6 rounded-full bg-white shadow transition-transform ${plan === 'paid' ? 'translate-x-6' : ''}`} />
            </span>
            <span className="text-xs font-bold text-navy-500">有料</span>
          </button>
        </div>
        <p className="mt-2 text-xs text-navy-500">※デモ用の切り替えです。実際の課金は発生しません。</p>
        <table className="mt-3 w-full text-sm">
          <thead><tr className="text-navy-500 text-xs"><th className="text-left font-bold py-1" /><th className="font-bold">無料</th><th className="font-bold">有料</th></tr></thead>
          <tbody className="text-navy-800">
            {[['企業カルテ', `月${meta.freeViewLimit}社まで`, '無制限'], ['比較', `${meta.compareLimit.free}社まで`, `${meta.compareLimit.paid}社まで`], ['出来事・口コミ', '冒頭のみ', '全文']].map(([a, b, c]) => (
              <tr key={a} className="border-t border-navy-100">
                <td className="py-2 font-bold">{a}</td>
                <td className={`py-2 text-center ${plan === 'free' ? 'font-bold text-navy-900' : 'text-navy-500'}`}>{b}</td>
                <td className={`py-2 text-center ${plan === 'paid' ? 'font-bold text-blue-800' : 'text-navy-500'}`}>{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-4">
        <p className="font-bold text-navy-900">{u.month}の利用状況</p>
        {u.limit === null ? (
          <p className="mt-1 text-sm text-navy-700">有料プランのため、企業カルテは無制限に読めます（今月{u.used}社閲覧）。</p>
        ) : (
          <>
            <p className="mt-1 text-2xl font-bold text-navy-900 tabular-nums">あと{u.remaining}社<span className="text-sm font-normal text-navy-500"> / 月{u.limit}社</span></p>
            <div className="mt-2 h-2 bg-navy-100 rounded-full overflow-hidden"><div className="h-full bg-blue-600" style={{ width: `${(Math.min(u.used, u.limit) / u.limit) * 100}%` }} /></div>
            <p className="mt-2 text-xs text-navy-500">一度開いた企業は、その月のあいだ何度読み返しても回数は減りません。</p>
          </>
        )}
        <p className="mt-2 text-sm text-navy-700 flex items-center gap-1.5"><CalendarClock size={16} className="text-blue-600" />{u.resetsOn}に枠がリセットされます</p>
        <Btn variant="ghost" className="mt-1 text-sm -ml-2" onClick={onNextMonth}><RotateCcw size={16} />（デモ）翌月にする</Btn>
        {u.demoShifted && <p className="text-xs text-navy-500">デモ用に日付を進めています。</p>}
      </Card>

      <Card className="p-4 lg:row-span-2">
        <p className="font-bold text-navy-900">希望条件</p>
        <p className="text-xs text-navy-500 mt-0.5">変更すると、相性スコアと一覧の並びにすぐ反映されます。</p>
        <h3 className="mt-3 text-sm font-bold text-navy-800">志望している業界</h3>
        <div className="mt-2"><IndustryPicker meta={meta} value={industries} onChange={(v) => { setIndustries(v); onIndustries(v) }} /></div>
        <h3 className="mt-4 text-sm font-bold text-navy-800">重視する条件</h3>
        <div className="mt-2"><ConditionEditor meta={meta} value={conditions} onChange={(v) => { setConditions(v); onConditions(v) }} /></div>
      </Card>

      <Card className="p-4">
        <p className="font-bold text-navy-900">診断</p>
        <Btn variant="secondary" className="w-full mt-2" onClick={onRetake}><RotateCcw size={18} />診断をやり直す</Btn>
        <p className="mt-3 text-xs text-navy-500 flex items-start gap-1.5">
          <Sparkles size={14} className="shrink-0 mt-px text-blue-600" />
          {meta.ai.provider === 'claude'
            ? `AIの解説は Claude（${meta.ai.model}）で作成しています。通信できないときは自動で簡易版に切り替わります。`
            : 'AIの解説は、データから自動で作成した簡易版（ルールベース）で表示しています。'}
        </p>
      </Card>

      <Card className="p-4">
        <p className="font-bold text-navy-900 flex items-center gap-1.5"><ShieldCheck size={18} className="text-blue-600" />データとプライバシー</p>
        <ul className="mt-2 space-y-1.5 text-sm text-navy-700">
          <li className="flex gap-2"><Database size={16} className="shrink-0 mt-0.5 text-navy-500" />診断の回答と操作の状態を、ミツカルのサーバーに匿名で保存しています。名前やメールアドレスは保存しません。</li>
          <li className="flex gap-2"><CalendarClock size={16} className="shrink-0 mt-0.5 text-navy-500" />最後に使ってから{me.storage.retentionDays}日たつと自動で削除されます（今のままなら{me.storage.expiresOn}）。</li>
        </ul>
        <Btn variant="danger" className="w-full mt-3" onClick={onDelete}><Trash2 size={18} />入力したデータをすべて削除</Btn>
      </Card>
    </div>
  )
}

// =====================================================================
// App本体（画面遷移と状態管理）
// =====================================================================
type Patch = Parameters<typeof api.updateMe>[0]

export default function App() {
  const [boot, setBoot] = useState<'loading' | 'ready' | 'error'>('loading')
  const [meta, setMeta] = useState<Meta | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [screen, setScreen] = useState<Screen>('welcome')
  // 診断の入力途中（「診断結果を見る」でサーバーに保存）
  const [quizIndex, setQuizIndex] = useState(0)
  const [draftAnswers, setDraftAnswers] = useState<(number | null)[]>([])
  const [draftIndustries, setDraftIndustries] = useState<string[]>([])
  const [draftConditions, setDraftConditions] = useState<ConditionPrefs>(emptyConditions)
  const [submitting, setSubmitting] = useState(false)
  // スライダーをすぐ反応させるための一時的な値
  const [localAxes, setLocalAxes] = useState<Axes | null>(null)
  const [rows, setRows] = useState<CompanyListItem[] | null>(null)
  const [filter, setFilter] = useState<ListFilter>(defaultFilter)
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [karteFrom, setKarteFrom] = useState<Screen>('list')
  const [toast, setToast] = useState<string | null>(null)
  const [modal, setModal] = useState<'limit' | 'delete' | null>(null)
  const [term, setTerm] = useState<TermKey | null>(null)
  const [netError, setNetError] = useState<string | null>(null)
  const listScroll = useRef(0)

  // ---- サーバーへの保存（順番を守るためキューに積む。スライダーなどは少し待ってまとめて送る） ----
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const pending = useRef<Record<string, Patch>>({})
  const timers = useRef<Record<string, number>>({})

  const resetLocal = useCallback(() => {
    setMe(null); setRows(null); setFilter(defaultFilter); setSelectedId(null); setLocalAxes(null)
    setDraftAnswers([]); setDraftIndustries([]); setDraftConditions(emptyConditions); setQuizIndex(0)
    setModal(null); setTerm(null); setFilterOpen(false); listScroll.current = 0
  }, [])

  const onError = useCallback((e: unknown) => {
    if (e instanceof ApiError) {
      if (e.status === 0) return setNetError(e.message)
      if (e.code === 'no_session') {
        resetLocal(); setScreen('welcome')
        return setToast('保存されたデータが見つかりませんでした。診断からはじめてください')
      }
      return setToast(e.message)
    }
    setToast('エラーが発生しました。もう一度お試しください')
  }, [resetLocal])

  const enqueue = useCallback((fn: () => Promise<Me>) => {
    const p = queue.current.then(fn).then((m) => { setMe(m); setNetError(null); if (m.notice) setToast(m.notice); return m })
    queue.current = p.catch(() => undefined)
    return p
  }, [])

  const save = useCallback((patch: Patch) => enqueue(() => api.updateMe(patch)).catch((e) => { onError(e); return null }), [enqueue, onError])

  const runPending = useCallback((key: string) => {
    const p = pending.current[key]
    if (!p) return
    delete pending.current[key]
    window.clearTimeout(timers.current[key])
    void save(p)
  }, [save])

  const schedule = useCallback((key: string, patch: Patch) => {
    pending.current[key] = patch
    window.clearTimeout(timers.current[key])
    timers.current[key] = window.setTimeout(() => runPending(key), 350)
  }, [runPending])

  const flush = useCallback(async () => {
    Object.keys(pending.current).forEach(runPending)
    await queue.current
  }, [runPending])

  /** 画面上はすぐ変え、サーバーにも保存する（楽観的更新） */
  const patchLocal = (patch: Partial<Me['state']>) => setMe((m) => (m ? { ...m, state: { ...m.state, ...patch } } : m))

  // ---- 起動：サーバーから続きを読み込む ----
  const loadAll = useCallback(async () => {
    setBoot('loading')
    try {
      const [mt, m] = await Promise.all([api.meta(), api.me()])
      setMeta(mt)
      setNetError(null)
      if (m.exists && m.state.diagnosed) {
        setMe(m)
        setScreen((s) => (s === 'welcome' || s === 'quiz' ? 'home' : s))
      } else {
        setMe(m.exists ? m : null)
      }
      setBoot('ready')
    } catch {
      setBoot('error')
    }
  }, [])
  useEffect(() => { void loadAll() }, [loadAll])

  useEffect(() => { window.scrollTo(0, screen === 'list' ? listScroll.current : 0) }, [screen, selectedId])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2800)
    return () => clearTimeout(t)
  }, [toast])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setTerm(null); setFilterOpen(false); setModal(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---- 一覧の読み込み（診断結果・条件・絞り込みが変わったら読み直す） ----
  const profileKey = me ? JSON.stringify([me.axes, me.state.industries, me.state.conditions]) : ''
  const needRows = screen === 'list' || (screen === 'karte' && rows === null)
  useEffect(() => {
    if (!me?.state.diagnosed || !needRows) return
    let alive = true
    ;(async () => {
      await flush()
      try {
        const r = await api.getCompanies(filter)
        if (alive) setRows(r.items)
      } catch (e) {
        if (alive) onError(e)
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needRows, screen, filter, profileKey])

  const go = (s: Screen) => {
    if (screen === 'list' && s !== 'list') listScroll.current = window.scrollY
    if (screen === 'result' && s !== 'result') void flush().then(() => setLocalAxes(null))
    setTerm(null); setFilterOpen(false); setScreen(s)
  }

  // ---- 操作 ----
  const startQuiz = (keepPrefs: boolean) => {
    setDraftAnswers(Array(meta?.questions.length ?? 8).fill(null))
    setDraftIndustries(keepPrefs && me ? me.state.industries : [])
    setDraftConditions(keepPrefs && me ? me.state.conditions : emptyConditions)
    setQuizIndex(0)
    go('quiz')
  }

  const finishQuiz = async () => {
    if (draftAnswers.some((a) => a === null)) return
    setSubmitting(true)
    try {
      await flush()
      const m = await api.saveDiagnosis({ answers: draftAnswers as number[], industries: draftIndustries, conditions: draftConditions })
      setMe(m); setLocalAxes(null); setRows(null)
      go('result')
    } catch (e) {
      onError(e)
    } finally {
      setSubmitting(false)
    }
  }

  const openCompany = async (id: string, from: Screen = screen) => {
    try {
      await flush()
      const m = await api.openCompany(id)
      setMe(m)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'limit_reached') return setModal('limit')
      return onError(e)
    }
    setSelectedId(id)
    setKarteFrom(from === 'karte' ? karteFrom : from)
    go('karte')
  }

  const toggleCompare = (id: string) => {
    if (!me) return
    const cur = me.state.compare
    if (cur.includes(id)) {
      const next = cur.filter((x) => x !== id)
      patchLocal({ compare: next }); void save({ compare: next })
      return
    }
    if (cur.length >= me.compareLimit) {
      setToast(me.state.plan === 'free' ? '無料プランでは2社まで比較できます。入れ替えるときは1社外してください' : `比較できるのは${me.compareLimit}社までです`)
      return
    }
    const next = [...cur, id]
    patchLocal({ compare: next }); void save({ compare: next })
  }

  const setPlan = async (p: Plan) => {
    patchLocal({ plan: p })
    const m = await save({ plan: p })
    if (m && !m.notice) setToast(p === 'paid' ? '有料プラン（デモ）に切り替えました' : '無料プランに切り替えました')
  }

  const deleteAll = async () => {
    try {
      await flush()
      await api.deleteAll()
      resetLocal(); setScreen('welcome')
      setToast('入力したデータをすべて削除しました')
    } catch (e) {
      onError(e)
    }
  }

  const onFeature = (id: FeatureId) => {
    if (id === 'match') go('list')
    if (id === 'compare') go('compare')
    if (id === 'retake') startQuiz(true)
    if (id === 'karte') {
      const last = me?.viewed[me.viewed.length - 1]
      if (last) void openCompany(last, 'home')
      else { setToast('まずは一覧から気になる企業を1社選んでください'); go('list') }
    }
  }

  // ---- 表示用の値 ----
  const axes = localAxes ?? me?.axes ?? null
  const reloadKey = me ? `${me.state.plan}|${profileKey}` : ''
  const showNav = !!me?.state.diagnosed && screen !== 'welcome' && screen !== 'quiz'
  const showHeader = screen !== 'welcome' && screen !== 'quiz'
  const curIdx = rows?.findIndex((r) => r.id === selectedId) ?? -1
  const nextCompany = rows ? (curIdx === -1 ? rows.find((r) => r.id !== selectedId) : rows[curIdx + 1]) : undefined
  const activeFilterCount = (filter.industry === 'all' ? 0 : 1) + filter.conds.length
  const compareIds = me?.state.compare ?? []

  const nextAction = useMemo(() => {
    if (!me || me.viewed.length === 0) return { text: 'まずは相性の高い企業を1社開いてみよう', target: 'list' as Screen }
    if (me.state.compare.length < 2) return { text: '気になる企業を2社選んで比較してみよう', target: 'list' as Screen }
    return { text: `選んだ${me.state.compare.length}社を比較表で見てみよう`, target: 'compare' as Screen }
  }, [me])

  // ---- 画面下部の固定アクション（親指が届く位置に、その画面で一番使う操作を置く） ----
  let bottomAction: ReactNode = null
  let bottomHiddenOnPc = false
  if (screen === 'quiz' && meta && quizIndex >= meta.questions.length) {
    bottomAction = <Btn className="flex-1 lg:flex-none lg:px-10 text-lg min-h-14" disabled={submitting} onClick={finishQuiz}>{submitting ? '保存しています…' : '診断結果を見る'}<ArrowRight size={20} /></Btn>
  }
  if (screen === 'result') {
    bottomAction = <Btn className="flex-1 lg:flex-none lg:px-10" onClick={() => go('list')}>合いそうな企業を見る<ArrowRight size={18} /></Btn>
  }
  if (screen === 'list') {
    bottomHiddenOnPc = compareIds.length < 2
    bottomAction = (
      <>
        <Btn variant="secondary" className={`lg:hidden ${compareIds.length >= 2 ? 'px-3.5' : 'flex-1'}`} onClick={() => setFilterOpen(true)}>
          <SlidersHorizontal size={18} />絞り込み
          {activeFilterCount > 0 && <span className="min-w-5 h-5 px-1 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center tabular-nums">{activeFilterCount}</span>}
        </Btn>
        {compareIds.length >= 2 && <Btn className="flex-1 lg:flex-none lg:px-10" onClick={() => go('compare')}><Columns3 size={18} />{compareIds.length}社を比較する</Btn>}
        {compareIds.length === 1 && <p className="flex-1 self-center text-center text-xs font-bold text-navy-600">あと1社選ぶと比較できます</p>}
      </>
    )
  }
  if (screen === 'karte' && selectedId) {
    const inCmp = compareIds.includes(selectedId)
    bottomAction = (
      <>
        <Btn variant={inCmp ? 'primary' : 'secondary'} ariaPressed={inCmp} className="flex-1 lg:flex-none lg:px-6" onClick={() => toggleCompare(selectedId)}>
          {inCmp ? <SquareCheckBig size={18} /> : <Square size={18} />}{inCmp ? '比較に追加済み' : '比較に追加'}
        </Btn>
        <Btn variant="secondary" className="flex-1 lg:flex-none lg:px-6 min-w-0" disabled={!nextCompany} onClick={() => nextCompany && openCompany(nextCompany.id, karteFrom)}>
          {nextCompany ? (
            <>
              <span className="flex flex-col items-start leading-tight min-w-0">
                <span>次の候補へ</span>
                <span className="text-[11px] font-normal text-navy-500 truncate max-w-[8.5rem]">{shortName(nextCompany.name)}</span>
              </span>
              <ChevronRight size={18} className="shrink-0" />
            </>
          ) : rows ? '最後の候補です' : '読み込み中…'}
        </Btn>
      </>
    )
  }

  const navItems: NavItem<Screen>[] = [
    { key: 'home', label: 'ホーム', icon: <House size={22} strokeWidth={1.75} />, active: screen === 'home' || screen === 'result' },
    { key: 'list', label: '企業', icon: <Building2 size={22} strokeWidth={1.75} />, active: screen === 'list' || screen === 'karte' },
    { key: 'compare', label: '比較', icon: <Columns3 size={22} strokeWidth={1.75} />, active: screen === 'compare' },
    { key: 'settings', label: '設定', icon: <Settings size={22} strokeWidth={1.75} />, active: screen === 'settings' },
  ]

  // ---- 起動中・接続できない ----
  if (boot !== 'ready' || !meta) {
    return (
      <div className="min-h-dvh bg-slate-100">
        <div className="mx-auto w-full max-w-[430px] lg:max-w-[560px] min-h-dvh bg-white flex flex-col items-center justify-center px-6 text-center">
          <div className="size-14 rounded-2xl bg-navy-800 text-white flex items-center justify-center"><Compass size={30} strokeWidth={1.75} /></div>
          {boot === 'error' ? (
            <>
              <p className="mt-5 font-bold text-navy-900 flex items-center gap-1.5"><WifiOff size={18} />サーバーに接続できません</p>
              <p className="mt-2 text-sm text-navy-600">通信環境を確認して、もう一度お試しください。</p>
              <Btn className="mt-6 w-full" onClick={loadAll}><RefreshCw size={18} />もう一度読み込む</Btn>
            </>
          ) : (
            <p className="mt-5 text-sm text-navy-600" role="status">読み込んでいます…</p>
          )}
          <p className="mt-10 text-[11px] text-navy-500">※表示している企業とデータはすべてサンプルです</p>
        </div>
      </div>
    )
  }

  const badge = me?.state.plan === 'paid' ? '有料プラン・閲覧無制限' : `今月あと${me?.usage.remaining ?? meta.freeViewLimit}社`

  return (
    <TermContext.Provider value={setTerm}>
      <div className="min-h-dvh bg-slate-100">
        <div className={`mx-auto w-full min-h-dvh bg-white flex sm:shadow-xl sm:shadow-navy-900/5 ${showNav ? 'max-w-[430px] lg:max-w-[1200px]' : 'max-w-[430px] lg:max-w-[560px]'}`}>
          {showNav && <Sidebar items={navItems} onNav={go} compareCount={compareIds.length} />}

          <div className="flex-1 min-w-0 min-h-dvh flex flex-col">
            {showHeader && (
              <AppHeader title={SCREEN_TITLE[screen]} badge={badge} badgePaid={me?.state.plan === 'paid'} onBadgeTap={() => go('settings')}
                onBack={screen === 'karte' ? () => go(karteFrom) : undefined} />
            )}
            {netError && (
              <div className="sticky top-14 z-20 bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-center gap-2 text-sm text-amber-900" role="alert">
                <WifiOff size={16} className="shrink-0" /><span className="flex-1">{netError}</span>
                <button type="button" onClick={() => { setNetError(null); void loadAll() }} className="min-h-11 px-2 font-bold inline-flex items-center gap-1"><RefreshCw size={16} />再試行</button>
              </div>
            )}

            <main className="flex-1 flex flex-col">
              {screen === 'welcome' && <WelcomeScreen onStart={() => startQuiz(false)} />}
              {screen === 'quiz' && (
                <QuizScreen meta={meta} index={quizIndex} answers={draftAnswers} industries={draftIndustries} conditions={draftConditions}
                  onAnswer={(i, v) => { setDraftAnswers((a) => { const n = [...a]; n[i] = v; return n }); setQuizIndex(i + 1) }}
                  onBack={() => (quizIndex === 0 ? go(me?.state.diagnosed ? 'home' : 'welcome') : setQuizIndex(quizIndex - 1))}
                  onImport={() => setToast('この機能は準備中です')}
                  setIndustries={setDraftIndustries} setConditions={setDraftConditions} />
              )}
              {screen === 'result' && me && axes && (
                <ResultScreen meta={meta} me={me} axes={axes}
                  onFit={() => { setLocalAxes(null); patchLocal({ feedback: 'fit', adjusted: null }); void save({ adjusted: null, feedback: 'fit' }) }}
                  onAdjust={() => { setLocalAxes(me.axes); patchLocal({ feedback: 'adjust' }); void save({ adjusted: me.axes, feedback: 'adjust' }) }}
                  onSlide={(a) => { setLocalAxes(a); schedule('adjusted', { adjusted: a }) }}
                  onReset={() => { setLocalAxes(me.computedAxes); schedule('adjusted', { adjusted: me.computedAxes }) }} />
              )}
              {screen === 'home' && me && (
                <HomeScreen meta={meta} me={me} nextAction={{ text: nextAction.text, onClick: () => go(nextAction.target) }} onFeature={onFeature}
                  onSeeResult={() => go('result')} setItems={(home) => { patchLocal({ home }); schedule('home', { home }) }} />
              )}
              {screen === 'list' && me && (
                <ListScreen meta={meta} rows={rows} filter={filter} setFilter={setFilter} compareIds={compareIds} toggleCompare={toggleCompare}
                  onOpen={(id) => void openCompany(id, 'list')} filterOpen={filterOpen} setFilterOpen={setFilterOpen} />
              )}
              {screen === 'karte' && selectedId && (
                <KarteScreen companyId={selectedId} reloadKey={reloadKey} onUpgrade={() => go('settings')} onError={onError} />
              )}
              {screen === 'compare' && me && (
                <CompareScreen plan={me.state.plan} compareIds={compareIds} reloadKey={reloadKey} onError={onError}
                  onRemove={(id) => toggleCompare(id)} onOpen={(id) => void openCompany(id, 'compare')} onGoList={() => go('list')} />
              )}
              {screen === 'settings' && me && (
                <SettingsScreen meta={meta} me={me} onPlan={(p) => void setPlan(p)} onDelete={() => setModal('delete')} onRetake={() => startQuiz(true)}
                  onNextMonth={() => void enqueue(() => api.nextMonth()).then(() => setToast('デモ用に翌月へ進めました。閲覧枠がリセットされました')).catch(onError)}
                  onIndustries={(v) => schedule('industries', { industries: v })}
                  onConditions={(v) => schedule('conditions', { conditions: v })} />
              )}
            </main>

            <div className="sticky bottom-0 z-30">
              {(toast || term) && (
                <div className="absolute bottom-full inset-x-0 px-3 pb-2 space-y-2 pointer-events-none">
                  {term && (
                    <div className="pointer-events-auto rounded-2xl bg-navy-900 text-white p-4 shadow-lg" role="dialog" aria-label={`${term}の説明`}>
                      <div className="flex items-start gap-2">
                        <div className="flex-1">
                          <p className="font-bold">{term}</p>
                          <p className="mt-1 text-sm leading-relaxed text-navy-100">{GLOSSARY[term]}</p>
                        </div>
                        <button type="button" onClick={() => setTerm(null)} className="size-11 -mr-2 -mt-2 inline-flex items-center justify-center" aria-label="閉じる"><X size={20} /></button>
                      </div>
                    </div>
                  )}
                  {toast && (
                    <div className="rounded-xl bg-navy-900 text-white text-sm font-bold px-4 py-3 shadow-lg flex items-center gap-2" role="status">
                      <Info size={16} className="shrink-0" />{toast}
                    </div>
                  )}
                </div>
              )}
              {bottomAction && (
                <div className={`px-4 py-2.5 lg:px-6 bg-white/95 backdrop-blur border-t border-navy-100 ${bottomHiddenOnPc ? 'lg:hidden' : ''}`}>
                  <div className="flex gap-2 lg:justify-end">{bottomAction}</div>
                </div>
              )}
              <p className="bg-navy-50 text-[11px] text-navy-500 text-center py-1 border-t border-navy-100">※表示している企業とデータはすべてサンプルです</p>
              {showNav && (
                <nav className="lg:hidden bg-white border-t border-navy-100 grid grid-cols-4 pb-[env(safe-area-inset-bottom)]" aria-label="メインメニュー">
                  {navItems.map((n) => (
                    <button key={n.key} type="button" onClick={() => go(n.key)} aria-current={n.active ? 'page' : undefined}
                      className={`min-h-14 flex flex-col items-center justify-center gap-0.5 text-[11px] font-bold relative ${n.active ? 'text-blue-700' : 'text-navy-500'}`}>
                      {n.active && <span className="absolute top-0 h-0.5 w-8 bg-blue-600 rounded-full" />}
                      {n.icon}{n.label}
                      {n.key === 'compare' && compareIds.length > 0 && (
                        <span className="absolute top-1.5 right-[calc(50%-22px)] min-w-5 h-5 px-1 rounded-full bg-blue-600 text-white text-[11px] flex items-center justify-center tabular-nums">{compareIds.length}</span>
                      )}
                    </button>
                  ))}
                </nav>
              )}
            </div>
          </div>
        </div>

        <Sheet open={modal === 'limit'} onClose={() => setModal(null)} title="今月の無料枠を使い切りました"
          footer={
            <div className="grid gap-2">
              <Btn onClick={() => { setModal(null); go('settings') }}>有料プランを見る</Btn>
              <Btn variant="secondary" onClick={() => setModal(null)}>閉じる</Btn>
            </div>
          }>
          <p className="text-sm leading-relaxed text-navy-700">
            たくさんの会社を調べてきましたね。無料プランでは月{meta.freeViewLimit}社までカルテを読めます。
            今月開いた{me?.usage.used ?? 0}社は、いつでも読み返せます。枠は{me?.usage.resetsOn}に戻ります。
          </p>
          <p className="mt-2 text-sm leading-relaxed text-navy-700">もっと多くの会社を見たいときは、有料プラン（月300〜500円を想定）も選べます。</p>
        </Sheet>

        <Sheet open={modal === 'delete'} onClose={() => setModal(null)} title="データをすべて削除しますか？"
          footer={
            <div className="grid gap-2">
              <Btn variant="danger" onClick={() => void deleteAll()}><Trash2 size={18} />削除する</Btn>
              <Btn variant="secondary" onClick={() => setModal(null)}>キャンセル</Btn>
            </div>
          }>
          <p className="text-sm leading-relaxed text-navy-700">診断の回答、閲覧履歴、比較リスト、希望条件、ホームの並べ方がサーバーからすべて消え、はじめの画面に戻ります。元には戻せません。</p>
        </Sheet>
      </div>
    </TermContext.Provider>
  )
}
