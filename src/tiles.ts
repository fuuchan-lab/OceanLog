/**
 * 地図・海図のタイルの定義と、出港前にオフライン用に保存する処理。
 * 使うのは、無料で出典を書けば使えるものだけ（有料の海図は使わない）。
 * - 国土地理院 地図・写真（出典: 国土地理院）
 * - OpenStreetMap（© OpenStreetMap contributors, ODbL）。タイルの一括ダウンロードは利用規約で禁止されているので、保存の対象にしない
 * - OpenSeaMap 海図記号（© OpenSeaMap contributors, CC BY-SA）
 * - GEBCO 水深（出典: GEBCO Compilation Group）。WMS なので保存の対象にしない
 * - 国土地理院 沿岸海域土地条件図（等深線・海底の地形。一部の沿岸だけ、ズーム14〜16。出典: 国土地理院）
 */
import type { LatLon } from './geo.ts'
import type { BaseLayer } from './settings.ts'

export interface TileSource {
  url: string
  attribution: string
  maxZoom: number
  /** オフライン用に保存してよいか（利用規約で一括取得を禁じていない） */
  downloadable: boolean
}

export const BASE_LAYERS: Record<Exclude<BaseLayer, 'gebco'>, TileSource> = {
  'gsi-pale': {
    url: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>',
    maxZoom: 18,
    downloadable: true,
  },
  'gsi-photo': {
    url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>',
    maxZoom: 18,
    downloadable: true,
  },
  osm: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    maxZoom: 19,
    downloadable: false,
  },
}

export const SEAMARKS: TileSource = {
  url: 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png',
  attribution: '&copy; <a href="https://www.openseamap.org" target="_blank" rel="noopener">OpenSeaMap</a> contributors',
  maxZoom: 18,
  downloadable: true,
}

/**
 * 国土地理院の沿岸海域土地条件図（等深線と海底の地形の分類）。平成元年以降の調査（ccm1）と、昭和63年以前の調査（ccm2）。
 * 整備されているのは一部の沿岸だけで、タイルはズーム14〜16。地図に半透明で重ねる
 */
export const GSI_COASTAL: TileSource[] = ['ccm1', 'ccm2'].map((id) => ({
  url: `https://cyberjapandata.gsi.go.jp/xyz/${id}/{z}/{x}/{y}.png`,
  attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>（沿岸海域土地条件図）',
  maxZoom: 16,
  downloadable: true,
}))
/** 沿岸海域土地条件図のタイルがある、いちばん小さいズーム */
export const GSI_COASTAL_MIN_ZOOM = 14

export const GEBCO_WMS = {
  url: 'https://wms.gebco.net/mapserv?',
  layers: 'GEBCO_LATEST',
  attribution: 'Bathymetry: <a href="https://www.gebco.net" target="_blank" rel="noopener">GEBCO</a>',
}

/** Service Worker がタイルを保存するキャッシュの名前（vite.config.ts と同じにする） */
export const TILE_CACHE = 'map-tiles'

export interface TileXYZ {
  z: number
  x: number
  y: number
}

export function lonToX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z)
}

export function latToY(lat: number, z: number): number {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z)
}

/** 中心から半径 radiusKm の四角い範囲に入るタイル（ズーム minZ〜maxZ） */
export function tilesAround(center: LatLon, radiusKm: number, minZ: number, maxZ: number): TileXYZ[] {
  const dLat = radiusKm / 111.32
  const dLon = radiusKm / (111.32 * Math.cos((center.lat * Math.PI) / 180))
  const out: TileXYZ[] = []
  for (let z = minZ; z <= maxZ; z++) {
    const x0 = lonToX(center.lon - dLon, z)
    const x1 = lonToX(center.lon + dLon, z)
    const y0 = latToY(center.lat + dLat, z)
    const y1 = latToY(center.lat - dLat, z)
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ z, x, y })
  }
  return out
}

export function tileUrl(template: string, t: TileXYZ): string {
  return template.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y))
}

/** 1回に保存できるタイルの上限（配信元のサーバーに負担をかけすぎないため） */
export const MAX_TILES = 4000
/** 保存する最大のズーム（桟橋の形が分かる程度） */
export const OFFLINE_MAX_ZOOM = 15

export interface DownloadProgress {
  done: number
  total: number
  failed: number
}

/**
 * タイルを取得して、Service Worker と同じキャッシュに入れる（オフラインの時、地図はそこから表示される）。
 * すでに保存してあるものは取り直さない。同時に取得する数を絞って、配信元に負担をかけないようにする
 */
export async function downloadTiles(
  urls: string[],
  onProgress: (p: DownloadProgress) => void,
  signal: AbortSignal,
): Promise<DownloadProgress> {
  const cache = await caches.open(TILE_CACHE)
  const progress: DownloadProgress = { done: 0, total: urls.length, failed: 0 }
  let next = 0
  const worker = async () => {
    while (next < urls.length && !signal.aborted) {
      const url = urls[next++]
      try {
        if (!(await cache.match(url))) {
          // 地図の画像は <img> と同じ no-cors で取得する（表示の時と同じ形で保存される）
          const res = await fetch(url, { mode: 'no-cors', signal })
          if (res.type === 'opaque' || res.ok) await cache.put(url, res)
          else progress.failed++
        }
      } catch {
        if (!signal.aborted) progress.failed++
      }
      progress.done++
      if (progress.done % 10 === 0 || progress.done === urls.length) onProgress({ ...progress })
    }
  }
  await Promise.all([worker(), worker(), worker()])
  onProgress({ ...progress })
  return progress
}

/** 保存しているタイルの枚数 */
export async function cachedTileCount(): Promise<number> {
  if (typeof caches === 'undefined') return 0
  const cache = await caches.open(TILE_CACHE)
  return (await cache.keys()).length
}

export async function clearTiles() {
  if (typeof caches !== 'undefined') await caches.delete(TILE_CACHE)
}
