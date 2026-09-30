import { useEffect, useState } from 'react'
import { bearing, distance } from '../geo.ts'

export interface Fix {
  lat: number
  lon: number
  /** 位置の誤差 (m) */
  accuracy: number
  /** 対地速力 (m/s)。端末が出さない時は、前の位置からの移動で求める。止まっていれば 0 */
  speed: number | null
  /** 対地針路 (度)。止まっている時は null */
  course: number | null
  /** epoch ms */
  t: number
}

export interface GeoState {
  fix: Fix | null
  /** 位置情報のエラーコード（1: 許可されていない / 2: 特定できない / 3: 時間切れ） */
  errorCode: number | null
  errorDetail: string | null
}

const LAST_FIX_KEY = 'oceanlog-last-fix'

function loadLastFix(): Fix | null {
  try {
    const raw = localStorage.getItem(LAST_FIX_KEY)
    return raw ? (JSON.parse(raw) as Fix) : null
  } catch {
    return null
  }
}

/** 止まっているとみなす速さ (m/s)。GPS の揺れで針路がふらつかないように */
const STILL_MS = 0.4

/**
 * GPS で現在地を追い続ける（アプリが画面に出ている間）。
 * 前回の位置は保存しておき、次に開いた時、最初の位置が届くまでの表示に使う。
 */
export function useGeolocation(): GeoState & { stale: boolean } {
  const [state, setState] = useState<GeoState>(() => ({ fix: loadLastFix(), errorCode: null, errorDetail: null }))
  const [fresh, setFresh] = useState(false)

  useEffect(() => {
    if (!('geolocation' in navigator)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState((s) => ({ ...s, errorCode: 2, errorDetail: 'geolocation-unsupported' }))
      return
    }
    let prev: Fix | null = null
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const base = { lat: p.coords.latitude, lon: p.coords.longitude, accuracy: p.coords.accuracy, t: p.timestamp }
        let speed = typeof p.coords.speed === 'number' && Number.isFinite(p.coords.speed) ? p.coords.speed : null
        let course = typeof p.coords.heading === 'number' && Number.isFinite(p.coords.heading) ? p.coords.heading : null
        if (prev && base.t > prev.t) {
          const moved = distance(prev, base)
          // 端末が速さを出さない時は、誤差より大きく動いた時だけ、移動から求める
          if (speed === null && moved > Math.max(base.accuracy, 5)) speed = moved / ((base.t - prev.t) / 1000)
          if (course === null && moved > Math.max(base.accuracy, 5)) course = bearing(prev, base)
        }
        if (speed !== null && speed < STILL_MS) course = null
        const fix: Fix = { ...base, speed, course }
        prev = fix
        setFresh(true)
        setState({ fix, errorCode: null, errorDetail: null })
        try {
          localStorage.setItem(LAST_FIX_KEY, JSON.stringify(fix))
        } catch {
          // 保存できなくても表示には影響しない
        }
      },
      (e) => setState((s) => ({ ...s, errorCode: e.code, errorDetail: `${e.code}: ${e.message}` })),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  return { ...state, stale: !fresh }
}
