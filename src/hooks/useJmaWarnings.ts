import { useEffect, useState } from 'react'
import { distance, type LatLon } from '../geo.ts'
import { fetchWarnings, type AreaWarnings } from '../jma.ts'

export interface WarningsState {
  /** 出航地と現在地の、市区町村ごとの注意報・警報（同じ地域は1つにまとめる） */
  areas: AreaWarnings[]
  fetchedAt: number | null
  error: string | null
}

const REFRESH_MS = 10 * 60_000
const CACHE_KEY = 'oceanlog-jma-warnings'

function loadCache(): WarningsState {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (raw) return { ...(JSON.parse(raw) as WarningsState), error: null }
  } catch {
    // 無視
  }
  return { areas: [], fetchedAt: null, error: null }
}

/**
 * 気象庁の注意報・警報を、出航地と現在地（陸の近く）について10分ごとに確認する。
 * 沖では電波がないことが多いので、最後に取れたものを保存して、取得時刻と一緒に出す
 */
export function useJmaWarnings(points: (LatLon | null)[], lang: 'ja' | 'en'): WarningsState {
  const [state, setState] = useState<WarningsState>(loadCache)
  // 位置の細かい揺れで取り直さないよう、約1km 単位に丸めた位置で判断する
  const key = points
    .filter((p): p is LatLon => p !== null)
    .map((p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`)
    .join('|')

  useEffect(() => {
    if (!key) return
    const targets = key.split('|').map((s) => {
      const [lat, lon] = s.split(',').map(Number)
      return { lat, lon }
    })
    // 近い位置（2km 以内）は1回だけ調べる
    const unique = targets.filter((p, i) => targets.findIndex((q) => distance(p, q) < 2000) === i)
    let cancelled = false
    const run = async () => {
      if (navigator.onLine === false) return
      try {
        const results = await Promise.all(unique.map((p) => fetchWarnings(p, lang).catch(() => null)))
        const areas: AreaWarnings[] = []
        for (const r of results) if (r && !areas.some((a) => a.area.class20 === r.area.class20)) areas.push(r)
        const next: WarningsState = { areas, fetchedAt: Date.now(), error: null }
        if (cancelled) return
        setState(next)
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify(next))
        } catch {
          // 無視
        }
      } catch (e) {
        if (!cancelled) setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }))
      }
    }
    void run()
    const timer = setInterval(() => void run(), REFRESH_MS)
    window.addEventListener('online', run)
    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('online', run)
    }
  }, [key, lang])

  return state
}
