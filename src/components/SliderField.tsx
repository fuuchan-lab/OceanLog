import { useId } from 'react'

interface Props {
  label: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  /** スライダーの刻み */
  step: number
  /** −・＋ボタンの刻み（細かく合わせる時） */
  fine?: number
  unit: string
  hint?: string
  /** 値の下に小さく出す説明（例: 平均水面から −40cm） */
  note?: string
}

/** スライダーで数値を選ぶ。大きな数値の表示と、細かく合わせる −・＋ボタン付き（手袋や揺れる船の上でも合わせやすいように） */
export function SliderField({ label, value, onChange, min, max, step, fine = 1, unit, hint, note }: Props) {
  const id = useId()
  // 今の値が範囲の外でも選べるように、範囲を広げる
  const lo = Math.min(min, value)
  const hi = Math.max(max, value)
  const set = (v: number) => onChange(Math.min(hi, Math.max(lo, Math.round(v))))
  return (
    <div className="slider-field">
      <div className="slider-head">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className="slider-value">
          {value}
          <small> {unit}</small>
        </output>
      </div>
      <div className="slider-row">
        <button type="button" className="secondary slider-step" onClick={() => set(value - fine)} aria-label={`${label} −${fine}${unit}`}>
          −
        </button>
        <input id={id} type="range" min={lo} max={hi} step={step} value={value} onChange={(e) => set(Number(e.target.value))} />
        <button type="button" className="secondary slider-step" onClick={() => set(value + fine)} aria-label={`${label} +${fine}${unit}`}>
          ＋
        </button>
      </div>
      <div className="slider-scale muted small" aria-hidden="true">
        <span>
          {lo}
          {unit}
        </span>
        <span>
          {hi}
          {unit}
        </span>
      </div>
      {note && <p className="small slider-note">{note}</p>}
      {hint && <p className="muted small">{hint}</p>}
    </div>
  )
}
