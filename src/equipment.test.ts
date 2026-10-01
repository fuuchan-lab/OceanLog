import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkedToday, checklistItems, DEFAULT_EQUIPMENT, localDay, parseEquipment } from './equipment.ts'

test('区域が広いほど項目が増え、日中だけの船には航海灯を出さない', () => {
  const heisui = checklistItems({ ...DEFAULT_EQUIPMENT, zone: 'heisui' }, 'boat', false, 'ja')
  const gentei = checklistItems({ ...DEFAULT_EQUIPMENT, zone: 'gentei' }, 'boat', false, 'ja')
  assert.ok(gentei.length > heisui.length)
  assert.ok(gentei.some((i) => i.id === 'flare'))
  assert.ok(!heisui.some((i) => i.id === 'flare'))
  assert.ok(!checklistItems(DEFAULT_EQUIPMENT, 'boat', true, 'ja').some((i) => i.id === 'lights'))
})

test('水上オートバイは専用の項目。外した項目は出さず、足した項目を出す', () => {
  const eq = { ...DEFAULT_EQUIPMENT, hidden: ['pwc-flare'], custom: [{ id: 'c1', label: '予備ロープ', qty: '1' }] }
  const ids = checklistItems(eq, 'pwc', false, 'ja').map((i) => i.id)
  assert.deepEqual(ids, ['pwc-lifejacket', 'pwc-mooring', 'c1'])
})

test('チェックは日が変わると外れる', () => {
  const now = new Date(2026, 9, 1, 8).getTime()
  const eq = { ...DEFAULT_EQUIPMENT, checked: ['mooring'], checkedDay: localDay(now) }
  assert.deepEqual(checkedToday(eq, now), ['mooring'])
  assert.deepEqual(checkedToday(eq, now + 86_400_000), [])
})

test('壊れた値は既定値にする', () => {
  assert.deepEqual(parseEquipment(null), DEFAULT_EQUIPMENT)
  assert.equal(parseEquipment({ zone: 'space' }).zone, 'gentei')
})
