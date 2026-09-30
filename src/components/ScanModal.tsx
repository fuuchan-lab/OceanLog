import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../i18n/useI18n.ts'
import { defaultQuad, type Quad, type RGBAImage } from '../scan/document.ts'
import { toCanvas } from '../scan/scanImage.ts'

interface Props {
  image: RGBAImage
  initialQuad: Quad
  /** 自動で輪郭を見つけられたか（見つからなければ案内を出す） */
  found: boolean
  onApply: (quad: Quad, rotation: number, enhance: boolean) => void
  onClose: () => void
  /** 撮り直す（写真がぶれた・書類が写りきっていない時） */
  onRetake: () => void
}

/** 撮った写真の上で、書類の四隅を合わせる（LeadLog の名刺と同じ）。四隅の丸はドラッグで動かせる */
export function ScanModal({ image, initialQuad, found, onApply, onClose, onRetake }: Props) {
  const { t } = useI18n()
  const [quad, setQuad] = useState<Quad>(initialQuad)
  const [rotation, setRotation] = useState(0)
  const [enhance, setEnhance] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const dragging = useRef<number | null>(null)
  const src = useMemo(() => toCanvas(image).toDataURL('image/jpeg', 0.8), [image])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const toImage = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * image.width
    const y = ((e.clientY - rect.top) / rect.height) * image.height
    return { x: Math.min(image.width, Math.max(0, x)), y: Math.min(image.height, Math.max(0, y)) }
  }

  const onMove = (e: React.PointerEvent) => {
    const i = dragging.current
    if (i === null) return
    const p = toImage(e)
    setQuad((q) => q.map((pt, k) => (k === i ? p : pt)) as Quad)
  }

  // 丸の大きさは、画面上で指で押しやすい大きさ（画像の大きさに合わせる）
  const r = Math.max(image.width, image.height) * 0.028
  const path = quad.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z'

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card scan-card" role="dialog" aria-modal="true" aria-labelledby="scan-title" onClick={(e) => e.stopPropagation()}>
        {/* 見出しと説明の間はつめる */}
        <div className="scan-head">
          <div className="row">
            <h2 id="scan-title">{t('scan.title')}</h2>
            <button className="link" onClick={onClose} aria-label={t('common.close')}>
              ✕
            </button>
          </div>
          <p className="muted small">{t('scan.help')}</p>
        </div>
        {!found && <p className="banner banner-caution">{t('scan.notFound')}</p>}
        <div className="scan-stage">
          <img src={src} alt="" className="scan-image" />
          <svg
            ref={svgRef}
            className="scan-overlay"
            viewBox={`0 0 ${image.width} ${image.height}`}
            preserveAspectRatio="none"
            onPointerMove={onMove}
            onPointerUp={() => (dragging.current = null)}
            onPointerCancel={() => (dragging.current = null)}
          >
            <path d={`M0,0 H${image.width} V${image.height} H0 Z ${path}`} className="scan-shade" fillRule="evenodd" />
            <path d={path} className="scan-outline" style={{ strokeWidth: r * 0.25 }} />
            {quad.map((p, i) => (
              <circle
                key={i}
                cx={p.x}
                cy={p.y}
                r={r}
                className="scan-handle"
                style={{ strokeWidth: r * 0.2 }}
                onPointerDown={(e) => {
                  dragging.current = i
                  svgRef.current?.setPointerCapture(e.pointerId)
                }}
              />
            ))}
          </svg>
        </div>
        {/* 写真のすぐ下に、左「再撮影」（写真が悪い時）・右「この範囲で読み取る」を横並びで */}
        <div className="scan-main-actions">
          <button className="secondary" onClick={onRetake}>
            {t('scan.retake')}
          </button>
          <button className="primary" onClick={() => onApply(quad, rotation, enhance)}>
            {t('scan.apply')}
          </button>
        </div>
        <div className="scan-tools">
          <button className="secondary" onClick={() => setRotation((v) => (v + 1) % 4)}>
            {t('scan.rotate')}
            {rotation > 0 && ` ${rotation * 90}°`}
          </button>
          <button className="secondary" onClick={() => setQuad(defaultQuad(image.width, image.height, 0))}>
            {t('scan.reset')}
          </button>
        </div>
        <label className="check small">
          <input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} />
          {t('scan.enhance')}
        </label>
      </div>
    </div>
  )
}
