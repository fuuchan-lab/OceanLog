import assert from 'node:assert/strict'
import { test } from 'node:test'
import { latToY, lonToX, tilesAround, tileUrl } from './tiles.ts'

test('タイル番号（ズーム0は1枚、東京はズーム10で 909, 403 付近）', () => {
  assert.equal(lonToX(139.7, 0), 0)
  assert.equal(latToY(35.68, 0), 0)
  assert.equal(lonToX(139.7, 10), 909)
  assert.equal(latToY(35.68, 10), 403)
})

test('範囲のタイルは、ズームが1つ上がるとおよそ4倍', () => {
  const center = { lat: 35.3, lon: 139.5 }
  const z12 = tilesAround(center, 20, 12, 12).length
  const z13 = tilesAround(center, 20, 13, 13).length
  assert.ok(z13 >= z12 * 3 && z13 <= z12 * 5, `${z12} ${z13}`)
  assert.ok(tilesAround(center, 20, 8, 15).length < 4000)
})

test('URL の組み立て', () => {
  assert.equal(tileUrl('https://a/{z}/{x}/{y}.png', { z: 1, x: 2, y: 3 }), 'https://a/1/2/3.png')
})
