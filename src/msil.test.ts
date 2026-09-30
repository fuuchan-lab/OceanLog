import assert from 'node:assert/strict'
import { test } from 'node:test'
import { exportUrl, isMsilUrl, parseMsil } from './msil.ts'

test('海しるの設定の読み込み（壊れた値は捨てる）', () => {
  const s = parseMsil(
    JSON.stringify({
      key: ' abc ',
      layers: [
        { id: 'a', name: '暗岩', url: 'https://api.msil.go.jp/example/v2/MapServer' },
        { id: 'b', name: 'bad', url: 'http://x' },
      ],
      enabled: ['a', 'b'],
    }),
  )
  assert.equal(s.key, 'abc')
  assert.deepEqual(
    s.layers.map((l) => l.id),
    ['a'],
  )
  assert.deepEqual(s.enabled, ['a'])
  assert.equal(parseMsil('{').key, '')
})

test('URL の確認と、画像の URL', () => {
  assert.equal(isMsilUrl('https://api.msil.go.jp/x/v2/MapServer/'), true)
  assert.equal(isMsilUrl('https://api.msil.go.jp/x/v2/'), false)
  const u = exportUrl('https://api.msil.go.jp/x/v2/MapServer/', [1, 2, 3, 4])
  assert.match(u, /^https:\/\/api\.msil\.go\.jp\/x\/v2\/MapServer\/export\?bbox=1\.00%2C2\.00%2C3\.00%2C4\.00&bboxSR=3857/)
  assert.match(u, /transparent=true&f=image$/)
})
