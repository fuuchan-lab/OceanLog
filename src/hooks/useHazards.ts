import { useEffect, useMemo, useState } from 'react'
import { cellsAround, overpassQuery, parseOverpass, type Hazard } from '../hazards.ts'
import type { LatLon } from '../geo.ts'
import type { Mark } from '../types.ts'

const KEY = (cell: string) => `oceanlog-hazards-${cell}`
const MAX_AGE = 30 * 86_400_000

interface Cached {
  at: number
  list: Hazard[]
}

function load(cell: string): Cached | null {
  try {
    const raw = localStorage.getItem(KEY(cell))
    return raw ? (JSON.parse(raw) as Cached) : null
  } catch {
    return null
  }
}

/** 取得に失敗したマスは、しばらく取り直さない（Overpass に負担をかけないため） */
const failedAt = new Map<string, number>()
const inFlight = new Set<string>()

async function fetchCell(cell: string): Promise<Hazard[]> {
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(overpassQuery(cell))}`,
  })
  if (!res.ok) throw new Error(`overpass-${res.status}`)
  return parseOverpass(await res.json())
}

/** 自分で記録した暗岩・洗岩・危険の地点を、危険物として扱う */
export function marksToHazards(marks: Mark[]): Hazard[] {
  return marks.flatMap((m): Hazard[] => {
    if (m.kind !== 'rockSubmerged' && m.kind !== 'rockAwash' && m.kind !== 'danger') return []
    return [
      {
        id: `mine-${m.id}`,
        lat: m.lat,
        lon: m.lon,
        kind: m.kind === 'danger' ? 'obstruction' : 'rock',
        level: m.kind === 'rockSubmerged' ? 'submerged' : m.kind === 'rockAwash' ? 'awash' : 'unknown',
        name: m.name,
        depth: null,
        source: 'mine',
      },
    ]
  })
}

/**
 * 中心の周り（約30km 四方）の OpenSeaMap の危険物。マスごとに30日間、端末に保存する
 */
export function useOsmHazards(center: LatLon | null): Hazard[] {
  const [version, setVersion] = useState(0)
  const cells = useMemo(() => (center ? cellsAround(center) : []), [center?.lat.toFixed(1), center?.lon.toFixed(1)]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (cells.length === 0 || navigator.onLine === false) return
    let cancelled = false
    void (async () => {
      for (const cell of cells) {
        const cached = load(cell)
        if (cached && Date.now() - cached.at < MAX_AGE) continue
        if (inFlight.has(cell) || Date.now() - (failedAt.get(cell) ?? 0) < 10 * 60_000) continue
        inFlight.add(cell)
        try {
          const list = await fetchCell(cell)
          try {
            localStorage.setItem(KEY(cell), JSON.stringify({ at: Date.now(), list }))
          } catch {
            // 保存できなくても、その回は表示できる（次の取得で取り直す）
          }
          if (!cancelled) setVersion((v) => v + 1)
        } catch {
          failedAt.set(cell, Date.now())
        } finally {
          inFlight.delete(cell)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [cells])

  return useMemo(() => {
    void version
    const seen = new Set<string>()
    return cells.flatMap((c) => load(c)?.list ?? []).filter((h) => (seen.has(h.id) ? false : (seen.add(h.id), true)))
  }, [cells, version])
}
