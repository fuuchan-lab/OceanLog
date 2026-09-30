import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cellBounds, cellKey, cellsAround, nearbyHazards, overpassQuery, parseOverpass, type Hazard } from './hazards.ts'

test('Overpass の結果から暗岩・洗岩・沈船を取り出す', () => {
  const list = parseOverpass({
    elements: [
      { type: 'node', id: 1, lat: 35.1, lon: 139.6, tags: { 'seamark:type': 'rock', 'seamark:rock:water_level': 'submerged', 'seamark:rock:value_of_sounding': '1.2' } },
      { type: 'node', id: 2, lat: 35.2, lon: 139.6, tags: { 'seamark:type': 'rock', 'seamark:rock:water_level': 'awash', 'seamark:name': '赤岩' } },
      { type: 'way', id: 3, center: { lat: 35.3, lon: 139.6 }, tags: { 'seamark:type': 'wreck' } },
      { type: 'node', id: 4, lat: 35.3, lon: 139.6, tags: { 'seamark:type': 'buoy_lateral' } },
    ],
  })
  assert.equal(list.length, 3)
  assert.deepEqual(
    list.map((h) => [h.kind, h.level, h.depth]),
    [
      ['rock', 'submerged', 1.2],
      ['rock', 'awash', null],
      ['wreck', 'unknown', null],
    ],
  )
  assert.equal(list[1].name, '赤岩')
  assert.deepEqual(parseOverpass(null), [])
})

test('0.1度のマス', () => {
  assert.equal(cellKey(35.15, 139.62), '351,1396')
  assert.equal(cellKey(-0.05, -0.05), '-1,-1')
  const b = cellBounds('351,1396')
  assert.ok(Math.abs(b.s - 35.1) < 1e-9 && Math.abs(b.e - 139.7) < 1e-9)
  assert.equal(cellsAround({ lat: 35.15, lon: 139.62 }).length, 9)
  assert.match(overpassQuery('351,1396'), /\(35\.1000,139\.6000,35\.2000,139\.7000\)/)
})

test('近くの危険物を近い順に', () => {
  const h = (id: string, lat: number): Hazard => ({ id, lat, lon: 139, kind: 'rock', level: 'submerged', name: '', depth: null, source: 'mine' })
  const near = nearbyHazards({ lat: 35, lon: 139 }, [h('far', 35.01), h('b', 35.001), h('a', 35.0005)], 150)
  assert.deepEqual(
    near.map((n) => n.hazard.id),
    ['a', 'b'],
  )
  assert.ok(near[0].bearing < 1)
})
