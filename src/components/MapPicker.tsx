import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import { formatPosition, type LatLon } from '../geo.ts'
import { useI18n } from '../i18n/useI18n.ts'
import { searchPlaces, type Place } from '../placeSearch.ts'
import { BASE_LAYERS, SEAMARKS } from '../tiles.ts'

interface Props {
  /** はじめに表示する位置（未設定なら現在地、どちらもなければ日本の中央付近） */
  value: LatLon | null
  here: LatLon | null
  onChange: (at: LatLon) => void
}

const JAPAN: LatLon = { lat: 35.3, lon: 139.6 }

/**
 * 地図を動かして位置を選ぶ。地図の中心の照準（＋）の位置が選んだ位置になる。
 * 地名・住所で探すこともできる（国土地理院の検索）
 */
export function MapPicker({ value, here, onChange }: Props) {
  const { t } = useI18n()
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const [center, setCenter] = useState<LatLon | null>(value)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Place[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState(false)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    if (!el.current || map.current) return
    const start = value ?? here ?? JAPAN
    const m = L.map(el.current, { zoomControl: true }).setView([start.lat, start.lon], value || here ? 15 : 8)
    L.tileLayer(BASE_LAYERS['gsi-photo'].url, { attribution: BASE_LAYERS['gsi-photo'].attribution, maxZoom: 18 }).addTo(m)
    L.tileLayer(SEAMARKS.url, { attribution: SEAMARKS.attribution, maxZoom: 18 }).addTo(m)
    const report = () => {
      const c = m.getCenter()
      const at = { lat: Number(c.lat.toFixed(6)), lon: Number(c.lng.toFixed(6)) }
      setCenter(at)
      onChangeRef.current(at)
    }
    m.on('moveend', report)
    // 最初から位置が決まっている時（編集）は、そのまま。新しく追加する時は、表示した中心を仮の位置にする
    if (!value) report()
    map.current = m
    // ダイアログの中で表示が決まってから、大きさを測り直す
    setTimeout(() => m.invalidateSize(), 100)
    return () => {
      m.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const goTo = (at: LatLon, zoom = 16) => map.current?.setView([at.lat, at.lon], zoom)

  const search = async () => {
    if (!query.trim()) return
    setSearching(true)
    setError(false)
    try {
      const found = await searchPlaces(query)
      setResults(found)
      if (found.length === 1) goTo(found[0])
    } catch {
      setError(true)
      setResults(null)
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="picker">
      <div className="picker-search">
        <input
          type="search"
          value={query}
          placeholder={t('picker.searchPlaceholder')}
          aria-label={t('picker.search')}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void search()
            }
          }}
        />
        <button type="button" className="secondary" disabled={searching} onClick={() => void search()}>
          {searching ? '…' : t('picker.search')}
        </button>
      </div>
      {error && <p className="error small">{t('picker.searchFailed')}</p>}
      {results && results.length === 0 && <p className="muted small">{t('picker.noResults')}</p>}
      {results && results.length > 1 && (
        <ul className="picker-results">
          {results.slice(0, 8).map((r) => (
            <li key={`${r.lat},${r.lon},${r.title}`}>
              <button
                type="button"
                className="link"
                onClick={() => {
                  goTo(r)
                  setResults(null)
                }}
              >
                {r.title}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="picker-map-wrap">
        <div className="picker-map" ref={el} />
        {/* 地図の中心の照準。ここが選んだ位置になる */}
        <div className="picker-cross" aria-hidden="true">
          <svg viewBox="0 0 40 40">
            <path d="M20 2v14M20 24v14M2 20h14M24 20h14" />
            <circle cx="20" cy="20" r="4" />
          </svg>
        </div>
        {here && (
          <button type="button" className="fab picker-here" onClick={() => goTo(here)} aria-label={t('port.useHere')} title={t('port.useHere')}>
            ⌖
          </button>
        )}
      </div>
      <p className="muted small">{t('picker.hint')}</p>
      {center && <p className="small picker-pos">{formatPosition(center)}</p>}
    </div>
  )
}
