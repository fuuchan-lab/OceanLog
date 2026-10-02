import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react'

/** 画面上の表示: 画像の (0,0) が画面の (tx, ty) に来て、1画素が scale 倍 */
interface View {
  scale: number
  tx: number
  ty: number
}

export interface PanZoomHandle {
  /** 画像の (x, y) を画面の中心に。scale を省くと今の大きさのまま */
  centerOn: (x: number, y: number, scale?: number) => void
  /** 画面の中心が、画像のどこか */
  center: () => { x: number; y: number }
  zoomBy: (factor: number) => void
}

interface Props {
  src: string
  width: number
  height: number
  /** 画像の座標（画素）で描く重ね書き。scale は今の拡大率（印の大きさを一定にするため） */
  overlay?: (scale: number) => ReactNode
  /** 指で動かした・拡大した時（現在地の追従をやめる） */
  onUserMove?: () => void
  handle?: Ref<PanZoomHandle>
  className?: string
  children?: ReactNode
}

const MIN_SCALE_FACTOR = 0.5
const MAX_SCALE = 8

/**
 * 写真・スキャンした海図を、指で動かしたり、2本指で拡大・縮小したりして見る（マウスのホイールでも拡大）。
 * 重ね書き（自船・航跡・基準点など）は、画像と同じ座標で描く
 */
export function PanZoomImage({ src, width, height, overlay, onUserMove, handle, className, children }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View | null>(null)
  const viewRef = useRef<View | null>(null)
  viewRef.current = view
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ dist: number; mid: { x: number; y: number }; start: View } | null>(null)
  const onUserMoveRef = useRef(onUserMove)
  onUserMoveRef.current = onUserMove

  const size = () => {
    const r = box.current?.getBoundingClientRect()
    return { w: r?.width ?? 1, h: r?.height ?? 1 }
  }
  /** 画像全体が収まる大きさ */
  const fitScale = () => {
    const { w, h } = size()
    return Math.min(w / width, h / height)
  }
  const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(fitScale() * MIN_SCALE_FACTOR, s))

  // はじめは、画像全体が収まるように
  useEffect(() => {
    const { w, h } = size()
    const s = fitScale()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView({ scale: s, tx: (w - width * s) / 2, ty: (h - height * s) / 2 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, width, height])

  /** 画面の点 (sx, sy) を動かさずに、拡大率を変える */
  const zoomAt = (v: View, factor: number, sx: number, sy: number): View => {
    const scale = clampScale(v.scale * factor)
    const f = scale / v.scale
    return { scale, tx: sx - (sx - v.tx) * f, ty: sy - (sy - v.ty) * f }
  }

  useImperativeHandle(handle, () => ({
    centerOn: (x, y, scale) => {
      const v = viewRef.current
      if (!v) return
      const { w, h } = size()
      const s = scale ? clampScale(scale) : v.scale
      setView({ scale: s, tx: w / 2 - x * s, ty: h / 2 - y * s })
    },
    center: () => {
      const v = viewRef.current
      const { w, h } = size()
      if (!v) return { x: width / 2, y: height / 2 }
      return { x: (w / 2 - v.tx) / v.scale, y: (h / 2 - v.ty) / v.scale }
    },
    zoomBy: (factor) => {
      const v = viewRef.current
      if (!v) return
      const { w, h } = size()
      setView(zoomAt(v, factor, w / 2, h / 2))
    },
  }))

  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const startGesture = () => {
    const pts = [...pointers.current.values()]
    const v = viewRef.current
    if (!v || pts.length === 0) return
    if (pts.length >= 2) {
      const [a, b] = pts
      gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, start: v }
    } else {
      gesture.current = { dist: 0, mid: pts[0], start: v }
    }
  }

  return (
    <div
      ref={box}
      className={`panzoom${className ? ' ' + className : ''}`}
      onPointerDown={(e) => {
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
        pointers.current.set(e.pointerId, local(e))
        startGesture()
      }}
      onPointerMove={(e) => {
        if (!pointers.current.has(e.pointerId)) return
        pointers.current.set(e.pointerId, local(e))
        const g = gesture.current
        if (!g) return
        const pts = [...pointers.current.values()]
        if (pts.length >= 2 && g.dist > 0) {
          const [a, b] = pts
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
          const zoomed = zoomAt(g.start, Math.hypot(a.x - b.x, a.y - b.y) / g.dist, g.mid.x, g.mid.y)
          setView({ ...zoomed, tx: zoomed.tx + mid.x - g.mid.x, ty: zoomed.ty + mid.y - g.mid.y })
        } else if (pts.length === 1) {
          setView({ ...g.start, tx: g.start.tx + pts[0].x - g.mid.x, ty: g.start.ty + pts[0].y - g.mid.y })
        }
        onUserMoveRef.current?.()
      }}
      onPointerUp={(e) => {
        pointers.current.delete(e.pointerId)
        startGesture()
      }}
      onPointerCancel={(e) => {
        pointers.current.delete(e.pointerId)
        startGesture()
      }}
      onWheel={(e) => {
        const v = viewRef.current
        if (!v) return
        const p = local(e)
        setView(zoomAt(v, e.deltaY < 0 ? 1.2 : 1 / 1.2, p.x, p.y))
        onUserMoveRef.current?.()
      }}
      onDoubleClick={(e) => {
        const v = viewRef.current
        if (!v) return
        const p = local(e)
        setView(zoomAt(v, 2, p.x, p.y))
        onUserMoveRef.current?.()
      }}
    >
      {view && (
        <div className="panzoom-layer" style={{ width, height, transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})` }}>
          <img src={src} width={width} height={height} alt="" draggable={false} />
          {overlay && (
            <svg className="panzoom-overlay" viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
              {overlay(view.scale)}
            </svg>
          )}
        </div>
      )}
      {children}
    </div>
  )
}
