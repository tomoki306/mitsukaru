/**
 * 共通のUI部品
 *
 * ボタン配置の方針（ユーザビリティ）
 *  - スマホ：よく使う操作は画面下部＝親指が届く範囲に置く。上部には使う頻度の低い操作だけ。
 *  - タップ領域は高さ44px以上。専門用語の「?」も見た目より広い範囲で反応させる。
 *  - PC（幅1024px以上）：左にメニュー、本文は2列。キーボードでも操作できる。
 */
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Check, ChevronLeft, CircleHelp, Compass, FileText, Info, Lock, Minus, ThumbsUp, TrendingUp, TriangleAlert, X } from 'lucide-react'
import type { AiMeta, Cited, CompanyEvent, Evidence, HistoryPoint, Level, Status } from './api'

export const GLOSSARY = {
  売上: '商品やサービスを売って入ってきたお金の合計。会社の規模の目安です。',
  売上の伸び: '過去5年で、売上が1年あたり平均何%増えたか（年平均成長率）。',
  営業利益率: '売上のうち、本業の利益として残った割合。高いほど「稼ぐ力」が強いといえます。',
  自己資本比率: '会社のお金のうち、返さなくてよいお金の割合。高いほど借金に頼らず、不況に強いといえます。',
  平均年収: '社員全体の平均の年収。年齢構成で変わるため、初任給とは別物です。',
  従業員数: 'その会社で働く社員の人数。組織の大きさの目安です。',
  年間休日: '1年間の休みの日数。土日祝が休みの会社でおよそ120日前後が目安です。',
  相性スコア: 'あなたの価値観と会社の特徴の近さ（65%）、重視する条件の一致（25%）、志望業界（10%）を合わせた目安です。',
  業界平均: '同じ業界の会社の平均値。このデモではサンプル値を使っています。',
  有価証券報告書: '上場企業が毎年国に提出する公式の報告書。売上・利益・社員数などが載っています。',
} as const
export type TermKey = keyof typeof GLOSSARY

export const TermContext = createContext<(k: TermKey) => void>(() => {})

/** 専門用語：タップで一言説明を表示（見た目は小さく、反応する範囲は縦44pxに広げている） */
export function Term({ k, children }: { k: TermKey; children?: ReactNode }) {
  const open = useContext(TermContext)
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); open(k) }} aria-label={`${k}の説明を見る`}
      className="inline-flex items-center gap-0.5 py-3 -my-3 underline decoration-dotted decoration-navy-500/60 underline-offset-4 text-left">
      {children ?? k}
      <CircleHelp size={14} strokeWidth={2} className="text-blue-600 shrink-0" />
    </button>
  )
}

export function Btn({ children, onClick, variant = 'primary', className = '', disabled, ariaPressed }: {
  children: ReactNode; onClick?: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  className?: string; disabled?: boolean; ariaPressed?: boolean
}) {
  const styles = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800 disabled:bg-navy-200',
    secondary: 'bg-white text-navy-800 border border-navy-200 hover:bg-navy-50 active:bg-navy-100 disabled:opacity-50',
    ghost: 'text-blue-700 hover:bg-blue-50',
    danger: 'bg-white text-red-700 border border-red-200 hover:bg-red-50 active:bg-red-100',
  }[variant]
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={ariaPressed}
      className={`min-h-12 px-4 rounded-xl font-bold text-base inline-flex items-center justify-center gap-2 select-none transition active:scale-[0.98] disabled:active:scale-100 ${styles} ${className}`}>
      {children}
    </button>
  )
}

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`min-h-11 px-4 rounded-full text-sm font-bold border whitespace-nowrap inline-flex items-center gap-1.5 transition-colors ${active ? 'bg-navy-800 text-white border-navy-800' : 'bg-white text-navy-700 border-navy-200 hover:bg-navy-50'}`}>
      {active && <Check size={16} strokeWidth={2.5} />}
      {children}
    </button>
  )
}

/** 小さな選択肢（条件の詳細設定などで使う） */
export function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string
}) {
  return (
    <div className="grid bg-navy-50 border border-navy-100 rounded-xl p-1 gap-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={`min-h-11 rounded-lg text-sm font-bold px-1 ${value === o.value ? 'bg-white text-navy-900 shadow-sm' : 'text-navy-600 hover:text-navy-900'}`}>{o.label}</button>
      ))}
    </div>
  )
}

export function RemovableChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button type="button" onClick={onRemove} aria-label={`「${label}」の絞り込みを外す`}
      className="min-h-11 pl-3.5 pr-2.5 rounded-full text-sm font-bold bg-navy-800 text-white inline-flex items-center gap-1">
      {label}<X size={16} />
    </button>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-white border border-navy-100 rounded-2xl ${className}`}>{children}</div>
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className="text-xs font-bold text-navy-700 bg-navy-50 border border-navy-100 rounded-md px-2 py-0.5">{children}</span>
}

export function LevelBadge({ level, children }: { level: Level; children: ReactNode }) {
  const s = { good: 'bg-blue-50 text-blue-800 border-blue-200', avg: 'bg-navy-50 text-navy-700 border-navy-200', caution: 'bg-amber-50 text-amber-800 border-amber-200', info: 'bg-white text-navy-600 border-navy-200' }[level]
  return <span className={`text-xs font-bold border rounded-md px-2 py-0.5 whitespace-nowrap ${s}`}>{children}</span>
}

/** 条件の一致：色だけに頼らず、記号と言葉でも示す */
export function StatusBadge({ status }: { status: Status }) {
  const s = {
    met: { cls: 'bg-blue-50 text-blue-800 border-blue-200', icon: <Check size={12} strokeWidth={3} />, text: '一致' },
    partial: { cls: 'bg-navy-50 text-navy-700 border-navy-200', icon: <Minus size={12} strokeWidth={3} />, text: '一部一致' },
    unmet: { cls: 'bg-amber-50 text-amber-800 border-amber-200', icon: <X size={12} strokeWidth={3} />, text: '不一致' },
  }[status]
  return <span className={`inline-flex items-center gap-0.5 text-xs font-bold border rounded-md px-1.5 py-0.5 whitespace-nowrap ${s.cls}`}>{s.icon}{s.text}</span>
}

/** 無料プランで隠している部分。中身はサーバーから受け取っていないので、ダミーの行をぼかして見せる */
export function LockedPlaceholder({ count, unit, onUpgrade }: { count: number; unit: string; onUpgrade: () => void }) {
  if (count <= 0) return null
  return (
    <div className="relative mt-3 rounded-xl overflow-hidden">
      <div aria-hidden className="space-y-3 p-3 blur-[3px] select-none opacity-60">
        {Array.from({ length: Math.min(count, 3) }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <div className="h-3 w-24 bg-navy-200 rounded" />
            <div className="h-4 w-4/5 bg-navy-200 rounded" />
            <div className="h-3 w-full bg-navy-100 rounded" />
          </div>
        ))}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/50">
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-navy-800"><Lock size={16} />残り{count}{unit}は有料プランで表示</span>
        <Btn variant="secondary" onClick={onUpgrade} className="text-sm">有料プランで全文を表示</Btn>
      </div>
    </div>
  )
}

export function Skeleton({ lines = 4 }: { lines?: number }) {
  return (
    <div className="space-y-2 animate-pulse" aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-4 bg-navy-100 rounded" style={{ width: `${95 - (i % 3) * 12}%` }} />
      ))}
    </div>
  )
}

/** 根拠番号付きの文 */
export function CitedText({ item }: { item: Cited }) {
  return (
    <>
      {item.text}
      {item.refs.map((r) => <sup key={r} className="ml-0.5 text-[10px] font-bold text-blue-700">[{r}]</sup>)}
    </>
  )
}

/** 根拠の一覧（出典つき） */
export function EvidenceList({ evidence, compact = false }: { evidence: Evidence[]; compact?: boolean }) {
  return (
    <ol className={`divide-y divide-navy-100 ${compact ? '' : 'mt-2'}`}>
      {evidence.map((e) => (
        <li key={e.id} className="py-2.5 flex gap-3">
          <span className="text-xs font-bold text-blue-700 w-6 shrink-0 pt-0.5">[{e.id}]</span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-navy-800">{e.label}</p>
            <p className="text-sm text-navy-700 break-words">{e.value}</p>
            <p className="mt-0.5 text-xs text-navy-500 flex items-center gap-1"><FileText size={12} className="shrink-0" />出典：{e.source}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}

/** AIの解説を誰が作ったか（Claude かルールベースか）を明示する */
export function AiSourceNote({ meta }: { meta: AiMeta }) {
  return (
    <div className="mt-3 space-y-1.5">
      {meta.notice && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
          <Info size={14} className="shrink-0 mt-px" />{meta.notice}
        </p>
      )}
      <p className="text-xs text-navy-500">
        {meta.provider === 'claude' ? `作成：Claude（${meta.model}）` : '作成：データからの自動作成（ルールベース）'}
        ・判断材料の1つです。気になる点は根拠で確かめてください。
      </p>
    </div>
  )
}

export function Sheet({ open, onClose, title, children, footer }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) panel.current?.focus() }, [open])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 bg-navy-900/40 flex items-end lg:items-center justify-center" onClick={onClose}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[430px] lg:max-w-[480px] bg-white rounded-t-3xl lg:rounded-2xl max-h-[85dvh] flex flex-col outline-none shadow-xl">
        <div className="pt-2 flex justify-center lg:hidden" aria-hidden><span className="w-10 h-1 rounded-full bg-navy-200" /></div>
        <div className="flex items-center gap-2 pl-5 pr-2 pt-1 lg:pt-3">
          <h2 className="flex-1 text-lg font-bold text-navy-900">{title}</h2>
          <button type="button" onClick={onClose} className="size-11 inline-flex items-center justify-center rounded-full hover:bg-navy-50" aria-label="このシートを閉じる"><X size={20} /></button>
        </div>
        <div className="overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="border-t border-navy-100 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>
  )
}

export function AppHeader({ title, onBack, badge, badgePaid, onBadgeTap }: {
  title: string; onBack?: () => void; badge: string; badgePaid: boolean; onBadgeTap: () => void
}) {
  return (
    <header className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-navy-100 h-14 flex items-center px-2 lg:px-6 gap-1">
      {onBack && (
        <button type="button" onClick={onBack} className="size-11 inline-flex items-center justify-center rounded-full hover:bg-navy-50" aria-label="戻る">
          <ChevronLeft size={24} />
        </button>
      )}
      {!onBack && (
        <span className="lg:hidden pl-2 inline-flex items-center gap-1.5 font-bold text-navy-800"><Compass size={20} strokeWidth={2} className="text-blue-600" />ミツカル</span>
      )}
      <h1 className={`flex-1 min-w-0 truncate font-bold text-navy-900 text-base lg:text-lg ${onBack ? '' : 'invisible lg:visible'}`}>{title}</h1>
      <button type="button" onClick={onBadgeTap} className="min-h-11 px-2 text-xs font-bold text-navy-600 inline-flex items-center">
        <span className={`rounded-full px-2.5 py-1 border ${badgePaid ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-navy-200 bg-navy-50'}`}>{badge}</span>
      </button>
    </header>
  )
}

export type NavItem<K extends string> = { key: K; label: string; icon: ReactNode; active: boolean }

/** PC用：左のメニュー */
export function Sidebar<K extends string>({ items, onNav, compareCount }: { items: NavItem<K>[]; onNav: (k: K) => void; compareCount: number }) {
  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-navy-100 sticky top-0 h-dvh px-3 py-5 bg-white">
      <span className="px-3 inline-flex items-center gap-2 text-xl font-bold text-navy-800"><Compass size={24} strokeWidth={2} className="text-blue-600" />ミツカル</span>
      <p className="px-3 mt-1 text-xs text-navy-500">自分に合う会社を、根拠つきで。</p>
      <nav className="mt-6 flex flex-col gap-1" aria-label="メインメニュー">
        {items.map((n) => (
          <button key={n.key} type="button" onClick={() => onNav(n.key)} aria-current={n.active ? 'page' : undefined}
            className={`min-h-12 px-3 rounded-xl flex items-center gap-3 font-bold text-[15px] ${n.active ? 'bg-blue-50 text-blue-800' : 'text-navy-700 hover:bg-navy-50'}`}>
            {n.icon}{n.label}
            {n.key === 'compare' && compareCount > 0 && (
              <span className="ml-auto min-w-6 h-6 px-1.5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center tabular-nums">{compareCount}</span>
            )}
          </button>
        ))}
      </nav>
      <p className="mt-auto px-3 text-xs leading-relaxed text-navy-500"><kbd className="font-sans font-bold">Esc</kbd> で説明やシートを閉じられます</p>
    </aside>
  )
}

export function MiniLine({ title, data, dataKey, color }: { title: string; data: HistoryPoint[]; dataKey: 'revenue' | 'profit'; color: string }) {
  const hasNeg = data.some((d) => d[dataKey] < 0)
  return (
    <figure className="mt-3">
      <figcaption className="text-xs font-bold text-navy-600 flex items-center gap-1.5">
        <span className="inline-block w-3 h-0.5 rounded" style={{ background: color }} />{title}
      </figcaption>
      <div className="h-36 -ml-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#e4e9f3" vertical={false} />
            <XAxis dataKey="year" tickFormatter={(y: string) => `${y.slice(2)}年`} tick={{ fontSize: 11, fill: '#4a5b80' }} axisLine={{ stroke: '#c8d1e3' }} tickLine={false} />
            <YAxis width={44} tick={{ fontSize: 11, fill: '#4a5b80' }} axisLine={false} tickLine={false} />
            {hasNeg && <ReferenceLine y={0} stroke="#4a5b80" strokeDasharray="3 3" />}
            <Tooltip formatter={(v) => [`${Number(v).toLocaleString('ja-JP')}億円`, title.replace('（億円）', '')]} labelFormatter={(l) => `${l}年度`} />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={{ r: 4, fill: color, strokeWidth: 0 }} activeDot={{ r: 6 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}

export function Timeline({ events }: { events: CompanyEvent[] }) {
  return (
    <ol className="relative border-l-2 border-navy-100 ml-3 space-y-4 mt-1">
      {events.map((e, i) => (
        <li key={i} className="pl-5 relative">
          <span className={`absolute -left-[15px] top-0 size-7 rounded-full border-2 bg-white flex items-center justify-center ${e.tone === 'good' ? 'border-blue-600 text-blue-700' : 'border-amber-500 text-amber-700'}`}>
            {e.tone === 'good' ? <TrendingUp size={14} strokeWidth={2.25} /> : <TriangleAlert size={14} strokeWidth={2.25} />}
          </span>
          <p className="text-xs font-bold text-navy-500">{e.year}年・{e.tone === 'good' ? '良い出来事' : '気になる出来事'}</p>
          <p className="font-bold text-navy-900 mt-0.5">{e.title}</p>
          <p className="text-sm text-navy-700 mt-1 leading-relaxed">{e.detail}</p>
        </li>
      ))}
    </ol>
  )
}

export function ReviewGroup({ kind, items }: { kind: 'good' | 'concern'; items: string[] }) {
  if (!items.length) return null
  return (
    <div className="mt-3">
      <p className={`text-sm font-bold flex items-center gap-1.5 ${kind === 'good' ? 'text-blue-800' : 'text-amber-800'}`}>
        {kind === 'good' ? <ThumbsUp size={16} /> : <TriangleAlert size={16} />}{kind === 'good' ? '良い声' : '気になる声'}
      </p>
      <ul className="mt-1.5 space-y-2">
        {items.map((t) => <li key={t} className={`text-[15px] text-navy-800 rounded-xl px-3 py-2.5 border-l-4 ${kind === 'good' ? 'bg-blue-50/60 border-blue-400' : 'bg-amber-50/60 border-amber-400'}`}>「{t}」</li>)}
      </ul>
    </div>
  )
}
