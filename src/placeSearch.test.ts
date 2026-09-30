import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePlaces } from './placeSearch.ts'

test('地理院の地名検索の結果を、名前と位置にする（経度・緯度の順に注意）', () => {
  const data = [
    { geometry: { coordinates: [139.6125, 35.1602], type: 'Point' }, type: 'Feature', properties: { addressCode: '', title: '神奈川県三浦市三崎町小網代' } },
    { geometry: {}, properties: { title: '壊れた' } },
  ]
  assert.deepEqual(parsePlaces(data), [{ title: '神奈川県三浦市三崎町小網代', lat: 35.1602, lon: 139.6125 }])
  assert.deepEqual(parsePlaces(null), [])
})
