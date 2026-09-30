/**
 * 地点と航跡の書き出し（GPX・KML・CSV・GeoJSON）。ブラウザ機能に依存しない。
 * GPX は多くの航海用アプリ・GPS 機器・Google マイマップ などで読み込める。
 */
import { msToKnots } from './geo.ts'
import { MARK_ICONS, type Mark, type Track, type TrackPoint } from './types.ts'

export type ExportFormat = 'gpx' | 'kml' | 'csv' | 'geojson'

export const EXPORT_FORMATS: ExportFormat[] = ['gpx', 'kml', 'csv', 'geojson']

export const MIME: Record<ExportFormat, string> = {
  gpx: 'application/gpx+xml',
  kml: 'application/vnd.google-earth.kml+xml',
  csv: 'text/csv',
  geojson: 'application/geo+json',
}

export interface ExportTrack {
  track: Track
  points: TrackPoint[]
}

export interface ExportData {
  marks: Mark[]
  tracks: ExportTrack[]
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const iso = (t: number) => new Date(t).toISOString()
const coord = (n: number) => n.toFixed(7)

export function toGpx({ marks, tracks }: ExportData): string {
  const wpts = marks.map(
    (m) =>
      `  <wpt lat="${coord(m.lat)}" lon="${coord(m.lon)}">\n    <time>${iso(m.createdAt)}</time>\n    <name>${xml(m.name)}</name>\n` +
      (m.note ? `    <desc>${xml(m.note)}</desc>\n` : '') +
      `    <type>${m.kind}</type>\n  </wpt>`,
  )
  const trks = tracks.map(({ track, points }) => {
    const pts = points.map(
      (p) =>
        `      <trkpt lat="${coord(p.lat)}" lon="${coord(p.lon)}"><time>${iso(p.t)}</time>` +
        (p.speed !== null ? `<extensions><speed>${p.speed.toFixed(2)}</speed>${p.course !== null ? `<course>${p.course.toFixed(1)}</course>` : ''}</extensions>` : '') +
        `</trkpt>`,
    )
    return `  <trk>\n    <name>${xml(track.name)}</name>\n    <trkseg>\n${pts.join('\n')}\n    </trkseg>\n  </trk>`
  })
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<gpx version="1.1" creator="OceanLog" xmlns="http://www.topografix.com/GPX/1/1">\n` +
    [...wpts, ...trks].join('\n') +
    `\n</gpx>\n`
  )
}

export function toKml({ marks, tracks }: ExportData): string {
  const placemarks = marks.map(
    (m) =>
      `    <Placemark>\n      <name>${xml(`${MARK_ICONS[m.kind]} ${m.name}`)}</name>\n` +
      (m.note ? `      <description>${xml(m.note)}</description>\n` : '') +
      `      <TimeStamp><when>${iso(m.createdAt)}</when></TimeStamp>\n` +
      `      <Point><coordinates>${coord(m.lon)},${coord(m.lat)}</coordinates></Point>\n    </Placemark>`,
  )
  const lines = tracks.map(
    ({ track, points }) =>
      `    <Placemark>\n      <name>${xml(track.name)}</name>\n      <styleUrl>#track</styleUrl>\n` +
      `      <LineString><tessellate>1</tessellate><coordinates>${points.map((p) => `${coord(p.lon)},${coord(p.lat)}`).join(' ')}</coordinates></LineString>\n    </Placemark>`,
  )
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n    <name>OceanLog</name>\n` +
    `    <Style id="track"><LineStyle><color>ff0070ff</color><width>3</width></LineStyle></Style>\n` +
    [...placemarks, ...lines].join('\n') +
    `\n  </Document>\n</kml>\n`
  )
}

const csvCell = (v: string | number | null) => {
  if (v === null) return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** 1行1地点の CSV。地点（mark）と航跡の点（track）を同じ列で並べる。Excel で文字化けしないよう BOM を付ける */
export function toCsv({ marks, tracks }: ExportData): string {
  const header = ['type', 'name', 'time', 'latitude', 'longitude', 'speed_kn', 'course_deg', 'kind', 'note']
  const rows: (string | number | null)[][] = [
    ...marks.map((m) => ['mark', m.name, iso(m.createdAt), coord(m.lat), coord(m.lon), null, null, m.kind, m.note]),
    ...tracks.flatMap(({ track, points }) =>
      points.map((p) => [
        'track',
        track.name,
        iso(p.t),
        coord(p.lat),
        coord(p.lon),
        p.speed === null ? null : msToKnots(p.speed).toFixed(1),
        p.course === null ? null : Math.round(p.course),
        null,
        null,
      ]),
    ),
  ]
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export function toGeoJson({ marks, tracks }: ExportData): string {
  const features = [
    ...marks.map((m) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [m.lon, m.lat] },
      properties: { name: m.name, note: m.note, kind: m.kind, time: iso(m.createdAt) },
    })),
    ...tracks.map(({ track, points }) => ({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: points.map((p) => [p.lon, p.lat]) },
      properties: {
        name: track.name,
        start: iso(track.startedAt),
        end: track.endedAt ? iso(track.endedAt) : null,
        distance_m: Math.round(track.distance),
        times: points.map((p) => iso(p.t)),
      },
    })),
  ]
  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2)
}

export function exportText(format: ExportFormat, data: ExportData): string {
  if (format === 'gpx') return toGpx(data)
  if (format === 'kml') return toKml(data)
  if (format === 'csv') return toCsv(data)
  return toGeoJson(data)
}

/** 書き出すファイルの名前。例: OceanLog_20260930-1405.gpx */
export function exportFileName(format: ExportFormat, now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`
  return `OceanLog_${stamp}.${format}`
}
