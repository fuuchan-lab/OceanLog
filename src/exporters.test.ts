import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exportFileName, toCsv, toGeoJson, toGpx, toKml, type ExportData } from './exporters.ts'

const data: ExportData = {
  marks: [
    { id: 'm1', name: 'A & B <釣り場>', note: 'メモ, "引用"', kind: 'fishing', lat: 35.1, lon: 139.2, createdAt: 0, updatedAt: 0, editedBy: 'aaaaaaaa' },
  ],
  tracks: [
    {
      track: { id: 't1', name: '朝の航海', startedAt: 0, endedAt: 60_000, distance: 1852, maxSpeed: 5, pointCount: 2, updatedAt: 0, deviceId: 'aaaaaaaa' },
      points: [
        { trackId: 't1', t: 0, lat: 35, lon: 139, speed: 5.144, course: 90, accuracy: 5 },
        { trackId: 't1', t: 60_000, lat: 35.01, lon: 139.01, speed: null, course: null, accuracy: 5 },
      ],
    },
  ],
}

test('GPX: 地点は wpt、航跡は trk。記号はエスケープする', () => {
  const gpx = toGpx(data)
  assert.match(gpx, /<wpt lat="35.1000000" lon="139.2000000">/)
  assert.match(gpx, /<name>A &amp; B &lt;釣り場&gt;<\/name>/)
  assert.match(gpx, /<trkpt lat="35.0000000" lon="139.0000000"><time>1970-01-01T00:00:00.000Z<\/time><extensions><speed>5.14<\/speed><course>90.0<\/course>/)
  assert.equal((gpx.match(/<trkpt/g) ?? []).length, 2)
})

test('KML: 座標は 経度,緯度 の順', () => {
  const kml = toKml(data)
  assert.match(kml, /<coordinates>139.2000000,35.1000000<\/coordinates>/)
  assert.match(kml, /<LineString>/)
})

test('CSV: カンマや引用符を含む値は囲み、速力はノット', () => {
  const lines = toCsv(data).replace('﻿', '').trim().split('\r\n')
  assert.equal(lines.length, 4)
  assert.ok(lines[1].includes('"メモ, ""引用"""'))
  assert.ok(lines[2].includes(',10.0,90,'), lines[2])
})

test('GeoJSON は 経度,緯度 の順', () => {
  const g = JSON.parse(toGeoJson(data))
  assert.deepEqual(g.features[0].geometry.coordinates, [139.2, 35.1])
  assert.equal(g.features[1].geometry.type, 'LineString')
})

test('ファイル名', () => {
  assert.equal(exportFileName('gpx', new Date(2026, 8, 30, 14, 5)), 'OceanLog_20260930-1405.gpx')
})
