import { useEffect, useRef, useState } from 'react'
import type { LatLon } from '../geo.ts'
import { boxAround, fetchVessels, type Vessel } from '../vessels.ts'

/** 取り直す間隔。中継サーバーも 30 秒キャッシュする */
const INTERVAL = 30_000

/**
 * 中心の周り（約 60km 四方）の、AIS を積んだ船。on の間・画面を開いている間・ネットにつながっている間だけ取る。
 * 取れなかった時は前の結果を残す（電波の弱い海の上で消えないように）。範囲が変わったら入れ替える
 */
export function useVessels(center: LatLon | null, on: boolean): { vessels: Vessel[]; error: boolean } {
  const box = center && on ? boxAround(center) : ''
  const [state, setState] = useState<{ box: string; vessels: Vessel[]; error: boolean }>({ box: '', vessels: [], error: false })
  const prev = useRef<Vessel[]>([])

  useEffect(() => {
    if (!box) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const ctrl = new AbortController()
    const load = async () => {
      clearTimeout(timer)
      if (document.visibilityState === 'visible' && navigator.onLine !== false) {
        try {
          const vessels = await fetchVessels(box, prev.current, ctrl.signal)
          prev.current = vessels
          setState({ box, vessels, error: false })
        } catch {
          if (ctrl.signal.aborted) return
          setState((s) => ({ ...s, error: true }))
        }
      }
      if (!ctrl.signal.aborted) timer = setTimeout(load, INTERVAL)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    void load()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      ctrl.abort()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [box])

  if (!box) return { vessels: [], error: false }
  // 範囲が変わってすぐは、前の範囲の船もそのまま出しておく（地図の端で消えて見えないように）
  return { vessels: state.vessels, error: state.error }
}
