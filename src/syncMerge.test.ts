import assert from 'node:assert/strict'
import { test } from 'node:test'
import { marksForDevice, mergeMarks, TRACK_FILE, trackFileName } from './syncMerge.ts'
import type { Mark } from './types.ts'

const mark = (id: string, updatedAt: number, editedBy = 'aaaaaaaa', extra: Partial<Mark> = {}): Mark => ({
  id,
  name: id,
  note: '',
  kind: 'point',
  lat: 35,
  lon: 139,
  createdAt: 1,
  updatedAt,
  editedBy,
  ...extra,
})

test('新しく変更されたほうを残し、同じ日時なら端末側を残す', () => {
  const { merged, fromRemote } = mergeMarks(
    [mark('a', 5), mark('b', 5), mark('c', 5, 'aaaaaaaa', { name: 'local' })],
    [mark('a', 9, 'bbbbbbbb'), mark('b', 1), mark('c', 5, 'bbbbbbbb', { name: 'remote' }), mark('d', 1, 'bbbbbbbb')],
  )
  const byId = Object.fromEntries(merged.map((m) => [m.id, m]))
  assert.equal(byId.a.editedBy, 'bbbbbbbb')
  assert.equal(byId.b.updatedAt, 5)
  assert.equal(byId.c.name, 'local')
  assert.ok(byId.d)
  assert.deepEqual(fromRemote.map((m) => m.id).sort(), ['a', 'd'])
})

test('削除の印も新しいほうが勝つ', () => {
  const { merged } = mergeMarks([mark('a', 5)], [mark('a', 6, 'bbbbbbbb', { deleted: true })])
  assert.equal(merged[0].deleted, true)
})

test('この端末のファイルには、この端末が最後に変更したものだけを書く', () => {
  const list = marksForDevice([mark('a', 1), mark('b', 1, 'bbbbbbbb')], 'aaaaaaaa')
  assert.deepEqual(
    list.map((m) => m.id),
    ['a'],
  )
})

test('航跡のファイル名', () => {
  const id = '123e4567-e89b-12d3-a456-426614174000'
  assert.equal(TRACK_FILE.exec(trackFileName(id))?.[1], id)
})
