import { useCallback, useEffect, useRef, useState } from 'react'
import { describeError } from '../errors.ts'
import { distance, NM, type LatLon } from '../geo.ts'
import { fetchMarine, fetchWeather, type Marine, type Weather } from '../weather.ts'

export interface Conditions {
  weather: Weather | null
  marine: Marine | null
  /** 取得した場所と時刻 */
  at: LatLon
  fetchedAt: number
}

export interface ConditionsState {
  data: Conditions | null
  loading: boolean
  /** 失敗した時の詳細（前回のデータは残して表示する） */
  error: string | null
}

const CACHE_KEY = 'oceanlog-conditions'
/** 自動で取り直す間隔 */
const REFRESH_MS = 30 * 60_000
/** これ以上移動したら取り直す (m) */
const REFRESH_DISTANCE = 3 * NM

function loadCache(): Conditions | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? (JSON.parse(raw) as Conditions) : null
  } catch {
    return null
  }
}

/**
 * 現在地の天気・風・気圧・波・潮位を取得する。
 * 沖では電波が届かないことが多いので、最後に取れたものを端末に保存し、電波がない間はそれを表示する。
 */
export function useConditions(pos: LatLon | null) {
  const [state, setState] = useState<ConditionsState>(() => ({ data: loadCache(), loading: false, error: null }))
  const busy = useRef(false)
  const posRef = useRef(pos)
  useEffect(() => {
    posRef.current = pos
  })

  const refresh = useCallback(async () => {
    const at = posRef.current
    if (!at || busy.current) return
    busy.current = true
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      // 陸の上などで海のデータがない時も、天気だけは出す
      const [weather, marine] = await Promise.allSettled([fetchWeather(at.lat, at.lon), fetchMarine(at.lat, at.lon)])
      if (weather.status === 'rejected' && marine.status === 'rejected') throw weather.reason
      const data: Conditions = {
        weather: weather.status === 'fulfilled' ? weather.value : null,
        marine: marine.status === 'fulfilled' ? marine.value : null,
        at: { lat: at.lat, lon: at.lon },
        fetchedAt: Date.now(),
      }
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(data))
      } catch {
        // 保存できなくても表示はできる
      }
      setState({ data, loading: false, error: null })
    } catch (e) {
      console.error('[conditions]', e)
      setState((s) => ({ ...s, loading: false, error: describeError(e) }))
    } finally {
      busy.current = false
    }
  }, [])

  // 位置が分かった時・大きく移動した時・古くなった時に取り直す
  const last = state.data
  const needs =
    pos !== null &&
    (!last || Date.now() - last.fetchedAt > REFRESH_MS || distance(last.at, pos) > REFRESH_DISTANCE)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (needs && navigator.onLine !== false) void refresh()
  }, [needs, refresh])

  useEffect(() => {
    const onOnline = () => void refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible' && last && Date.now() - last.fetchedAt > REFRESH_MS) void refresh()
    }
    const timer = setInterval(() => {
      if (navigator.onLine !== false) void refresh()
    }, REFRESH_MS)
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh, last])

  return { ...state, refresh }
}
