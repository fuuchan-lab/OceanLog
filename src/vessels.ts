/**
 * 周りの船（AIS）。のりものレーダーの中継サーバー（Cloudflare Worker）が aisstream.io から集めた位置を、範囲を指定して受け取る。
 * - AIS を積んでいる船だけ（大きな船・旅客船・漁船の一部など）。小型のプレジャーボートや水上オートバイの多くは映らない
 * - 日本近海は受信局が少なく、映らない海域や、位置が数分遅れることがある
 * aisstream.io はブラウザからの直接接続を禁じているため、中継サーバーを通す（利用者に API キーの登録は求めない）
 */
import { bearing, distance, NM, type LatLon } from './geo.ts'

/** 中継サーバー。.env.local などの VITE_LIVE_API で差し替えられる */
export const LIVE_API: string =
  (import.meta.env?.VITE_LIVE_API as string | undefined) || 'https://shinkansen-location-live.shinkansen-location-live.workers.dev'

/** 地図の中心から、この広さ（度）の範囲を取る。中継サーバーの上限は 1 度四方 */
const HALF = 0.3

export type VesselKind = 'passenger' | 'cargo' | 'tanker' | 'fishing' | 'pleasure' | 'service' | 'fast' | 'other'

export interface Vessel {
  mmsi: number
  name: string
  lat: number
  lon: number
  /** 速力 kn */
  sog: number | null
  /** 向き（度）。航行中は進んでいる向き（COG）、止まっている時は船首方位 */
  heading: number | null
  moving: boolean
  /** AIS の船種番号（0 は不明） */
  type: number
  kind: VesselKind
  dest: string
  /** 全長 m */
  length: number | null
  /** この位置を受信した時刻（ms） */
  at: number
}

type Row = [number, string, number, number, number | null, number | null, number | null, number, string, number, number | null]

/** 止まっているとみなす速力（kn） */
const MOORED_KNOTS = 0.5

/** AIS の船種番号 → 表示の分類 */
export function vesselKind(type: number): VesselKind {
  if (type >= 60 && type <= 69) return 'passenger'
  if (type >= 70 && type <= 79) return 'cargo'
  if (type >= 80 && type <= 89) return 'tanker'
  if (type === 30) return 'fishing'
  if (type === 36 || type === 37) return 'pleasure'
  if (type >= 40 && type <= 49) return 'fast'
  // 曳航・浚渫・潜水作業・軍・水先・捜索救助・タグ・港湾・法執行・医療など
  if ((type >= 31 && type <= 35) || (type >= 50 && type <= 59)) return 'service'
  return 'other'
}

/** 地図の中心の周りを 0.1 度単位で切った範囲 "南,西,北,東"。中心が 0.1 度動くまでは同じ値（中継サーバーのキャッシュが効く） */
export function boxAround(c: LatLon): string {
  const r = (x: number) => Math.round(x * 10) / 10
  const lat = r(c.lat)
  const lon = r(c.lon)
  return [lat - HALF, lon - HALF, lat + HALF, lon + HALF].map((x) => x.toFixed(1)).join(',')
}

/** 中継サーバーの応答を表示用にする。prev は前回の船（向きが送られていない船の向きの推定に使う） */
export function parseVessels(data: { now: number; ships: Row[] }, prev: Vessel[] = []): Vessel[] {
  const before = new Map(prev.map((v) => [v.mmsi, v]))
  return data.ships.map(([mmsi, name, lat, lon, sog, cog, hdg, type, dest, age, length]) => {
    const moving = (sog ?? 0) >= MOORED_KNOTS
    const p = before.get(mmsi)
    let heading = moving ? (cog ?? hdg) : (hdg ?? cog)
    if (heading === null && p && distance(p, { lat, lon }) > 50) heading = bearing(p, { lat, lon })
    if (heading === null && p) heading = p.heading
    return { mmsi, name, lat, lon, sog, heading, moving, type, kind: vesselKind(type), dest, length, at: data.now - age * 1000 }
  })
}

export async function fetchVessels(box: string, prev: Vessel[], signal?: AbortSignal): Promise<Vessel[]> {
  const res = await fetch(`${LIVE_API}/vessels?bbox=${box}`, { signal })
  if (!res.ok) throw new Error(`vessels-${res.status}`)
  return parseVessels((await res.json()) as { now: number; ships: Row[] }, prev)
}

/** 速力と針路で、ms の時点の位置を推定する（3 分より先は進めない） */
export function vesselAt(v: Vessel, ms: number): LatLon {
  if (!v.moving || !v.sog || v.heading === null) return { lat: v.lat, lon: v.lon }
  const m = (v.sog * NM * Math.min(Math.max(0, ms - v.at), 180_000)) / 3_600_000
  const t = (v.heading * Math.PI) / 180
  return {
    lat: v.lat + (m * Math.cos(t)) / 111_320,
    lon: v.lon + (m * Math.sin(t)) / (111_320 * Math.cos((v.lat * Math.PI) / 180)),
  }
}

/** 動き: 位置と、速力（kn）・針路（度） */
export interface Motion extends LatLon {
  knots: number | null
  course: number | null
}

/**
 * 最接近（CPA）: 今の速力と針路のままだと、何分後に何 m まで近づくか。
 * 離れていく時は minutes = 0（今の距離が最接近）
 */
export function closestApproach(me: Motion, other: Motion): { meters: number; minutes: number } {
  const vel = (m: Motion) => {
    if (!m.knots || m.course === null) return [0, 0]
    const mps = (m.knots * NM) / 3600
    const t = (m.course * Math.PI) / 180
    return [mps * Math.sin(t), mps * Math.cos(t)]
  }
  // 自分を原点にした平面（m）
  const kx = 111_320 * Math.cos((me.lat * Math.PI) / 180)
  const px = (other.lon - me.lon) * kx
  const py = (other.lat - me.lat) * 111_320
  const [ax, ay] = vel(me)
  const [bx, by] = vel(other)
  const vx = bx - ax
  const vy = by - ay
  const v2 = vx * vx + vy * vy
  const t = v2 > 1e-9 ? Math.max(0, -(px * vx + py * vy) / v2) : 0
  return { meters: Math.hypot(px + vx * t, py + vy * t), minutes: t / 60 }
}

/** この距離・時間より近づく船は、地図で目立たせる */
export const CPA_WARN_M = 500
export const CPA_WARN_MIN = 15

export const isCloseApproach = (cpa: { meters: number; minutes: number }) => cpa.meters < CPA_WARN_M && cpa.minutes <= CPA_WARN_MIN

export const vesselLabel = (v: Vessel) => v.name || `MMSI ${v.mmsi}`
