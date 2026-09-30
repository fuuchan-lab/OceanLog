import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findArea, inJapan, warningsFor, type AreaTable } from './jma.ts'

const table: AreaTable = {
  offices: { '140000': { name: '神奈川県' } },
  class10s: { '140010': { name: '東部', parent: '140000' } },
  class15s: { '141000': { name: '横浜・川崎', parent: '140010' } },
  class20s: { '1410000': { name: '横浜市', parent: '141000' }, '1420400': { name: '鎌倉市', parent: '141000' } },
}

test('市区町村コードから気象庁の地域を探す（政令市の区は市にまとめる）', () => {
  assert.deepEqual(findArea('14204', table), { class20: '1420400', name: '鎌倉市', office: '140000' })
  assert.equal(findArea('14101', table)?.class20, '1410000')
  assert.equal(findArea('99999', table), null)
})

test('その地域に出ている注意報・警報だけを、強い順に取り出す', () => {
  const json = {
    reportDatetime: '2026-09-30T10:00:00+09:00',
    areaTypes: [
      { areas: [{ code: '140010', warnings: [{ code: '10', status: '継続' }] }] },
      {
        areas: [
          { code: '1420400', warnings: [{ code: '14', status: '継続' }, { code: '07', status: '発表' }, { code: '16', status: '解除' }] },
          { code: '1410000', warnings: [{ status: '発表警報・注意報はなし' }] },
        ],
      },
    ],
  }
  const { list, reportAt } = warningsFor(json, '1420400', 'ja')
  assert.deepEqual(
    list.map((w) => w.name),
    ['波浪警報', '雷注意報'],
  )
  assert.equal(reportAt, '2026-09-30T10:00:00+09:00')
  assert.equal(warningsFor(json, '1410000', 'ja').list.length, 0)
  assert.equal(warningsFor({ areaTypes: [{ areas: [{ code: 'x', warnings: [{ code: '99', status: '発表' }] }] }] }, 'x', 'en').list[0].name, 'Advisory/warning (99)')
})

test('日本の周辺か', () => {
  assert.equal(inJapan({ lat: 35, lon: 139 }), true)
  assert.equal(inJapan({ lat: 47.1, lon: 9.5 }), false)
})
