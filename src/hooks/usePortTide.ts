import { useEffect, useState } from 'react'
import type { HomePort } from '../profile.ts'
import { fetchMarine, type SeaLevelPoint } from '../weather.ts'

interface Cached {
  lat: number
  lon: number
  fetchedAt: number
  seaLevel: SeaLevelPoint[]
}

const key = (id: string) => `oceanlog-port-tide-${id}`
const REFRESH_MS = 3 * 3_600_000

function load(port: HomePort): Cached | null {
  try {
    const raw = localStorage.getItem(key(port.id))
    const c = raw ? (JSON.parse(raw) as Cached) : null
    // 港の位置を直したら、取り直す
    return c && c.lat === port.lat && c.lon === port.lon ? c : null
  } catch {
    return null
  }
}

/**
 * 出航地の潮位の予報。沖に出ると電波が届かないことが多いので、港にいる間に取ったものを端末に保存して使う
 */
export function usePortTide(port: HomePort | null) {
  const [data, setData] = useState<Cached | null>(() => (port ? load(port) : null))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!port) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setData(null)
      return
    }
    const cached = load(port)
    setData(cached)
    if (cached && Date.now() - cached.fetchedAt < REFRESH_MS) return
    if (navigator.onLine === false) return
    let cancelled = false
    fetchMarine(port.lat, port.lon)
      .then((m) => {
        if (cancelled) return
        const next: Cached = { lat: port.lat, lon: port.lon, fetchedAt: Date.now(), seaLevel: m.seaLevel }
        try {
          localStorage.setItem(key(port.id), JSON.stringify(next))
        } catch {
          // 保存できなくても表示はできる
        }
        setData(next)
        setError(null)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [port])

  return { seaLevel: data?.seaLevel ?? [], fetchedAt: data?.fetchedAt ?? null, error }
}
