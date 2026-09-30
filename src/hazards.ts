/**
 * 航行の危険物（暗岩・洗岩・干出岩・沈船・障害物）。
 * - OpenSeaMap（OpenStreetMap）に登録されたもの: Overpass API（無料。© OpenStreetMap contributors, ODbL）で取得する。
 *   日本は登録が少ないので、あれば表示する程度のもの
 * - 自分で記録した地点（種類が暗岩・洗岩・危険）
 * 航行モード中は、近づいたら警告する
 */
import { bearing, distance, type LatLon } from './geo.ts'

export type HazardKind = 'rock' | 'wreck' | 'obstruction'
/** 水面との関係: 暗岩（水面下）・洗岩（低潮時に水面すれすれ）・干出岩（高潮時に隠れ、低潮時に出る）・露岩 */
export type WaterLevel = 'submerged' | 'awash' | 'covers' | 'dry' | 'unknown'

export interface Hazard {
  id: string
  lat: number
  lon: number
  kind: HazardKind
  level: WaterLevel
  name: string
  /** 水深 (m)。分かれば */
  depth: number | null
  source: 'osm' | 'mine'
}

interface OverpassElement {
  type: string
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

function parseLevel(v: string | undefined): WaterLevel {
  if (v === 'submerged' || v === 'awash' || v === 'covers' || v === 'dry') return v
  if (v === 'always_dry' || v === 'partly_submerged') return v === 'always_dry' ? 'dry' : 'covers'
  return 'unknown'
}

export function parseOverpass(data: unknown): Hazard[] {
  const elements = (data as { elements?: OverpassElement[] })?.elements
  if (!Array.isArray(elements)) return []
  return elements.flatMap((e): Hazard[] => {
    const tags = e.tags ?? {}
    const type = tags['seamark:type']
    if (type !== 'rock' && type !== 'wreck' && type !== 'obstruction') return []
    const lat = e.lat ?? e.center?.lat
    const lon = e.lon ?? e.center?.lon
    if (typeof lat !== 'number' || typeof lon !== 'number') return []
    const depth = Number(tags[`seamark:${type}:value_of_sounding`] ?? tags.depth)
    return [
      {
        id: `osm-${e.type}-${e.id}`,
        lat,
        lon,
        kind: type,
        level: parseLevel(tags[`seamark:${type}:water_level`]),
        name: tags['seamark:name'] ?? tags.name ?? '',
        depth: Number.isFinite(depth) ? depth : null,
        source: 'osm',
      },
    ]
  })
}

/** 取得の単位にする、0.1度四方のマス（約10km）。マスごとに端末に保存して、電波がない沖でも使えるようにする */
export const CELL = 0.1

export function cellKey(lat: number, lon: number): string {
  return `${Math.floor(lat / CELL)},${Math.floor(lon / CELL)}`
}

/** 中心の周り（3×3 のマス） */
export function cellsAround(p: LatLon): string[] {
  const out: string[] = []
  for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) out.push(cellKey(p.lat + dy * CELL, p.lon + dx * CELL))
  return out
}

export function cellBounds(key: string): { s: number; w: number; n: number; e: number } {
  const [y, x] = key.split(',').map(Number)
  return { s: y * CELL, w: x * CELL, n: (y + 1) * CELL, e: (x + 1) * CELL }
}

export function overpassQuery(key: string): string {
  const { s, w, n, e } = cellBounds(key)
  const bbox = [s, w, n, e].map((v) => v.toFixed(4)).join(',')
  return `[out:json][timeout:25];(node["seamark:type"~"^(rock|wreck|obstruction)$"](${bbox});way["seamark:type"~"^(rock|wreck|obstruction)$"](${bbox}););out center 500;`
}

export interface NearHazard {
  hazard: Hazard
  distance: number
  bearing: number
}

/** 近くの危険物（近い順） */
export function nearbyHazards(here: LatLon, hazards: Hazard[], radius: number): NearHazard[] {
  return hazards
    .map((hazard) => ({ hazard, distance: distance(here, hazard), bearing: bearing(here, hazard) }))
    .filter((h) => h.distance <= radius)
    .sort((a, b) => a.distance - b.distance)
}

/** 航行モード中に警告する距離 (m) */
export const HAZARD_WARN_M = 150
/** 注意として出す距離 (m) */
export const HAZARD_CAUTION_M = 500
