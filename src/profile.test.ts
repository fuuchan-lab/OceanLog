import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMPTY_PROFILE, daysUntil, parseProfile, upcomingRenewals } from './profile.ts'

test('壊れた値や古い形でも読み込める', () => {
  const p = parseProfile({ ports: [{ name: 'A', lat: 35, lon: 139 }, { name: 'bad' }], boat: { name: '海風丸', length: 5.8 }, docs: { licenseExpiry: 'x' } })
  assert.equal(p.ports.length, 1)
  assert.equal(p.ports[0].z0, 0)
  assert.equal(p.boat.name, '海風丸')
  assert.equal(p.boat.capacity, null)
  assert.equal(p.docs.licenseExpiry, '')
  assert.deepEqual(parseProfile(null), EMPTY_PROFILE)
})

test('有効期限までの日数と、1か月前からのお知らせ', () => {
  const now = new Date(2026, 8, 30, 10).getTime()
  assert.equal(daysUntil('2026-09-30', now), 0)
  assert.equal(daysUntil('2026-10-30', now), 30)
  assert.equal(daysUntil('2026-09-29', now), -1)
  const p = { ...EMPTY_PROFILE, docs: { ...EMPTY_PROFILE.docs, licenseExpiry: '2026-10-20', inspectionExpiry: '2027-05-01' } }
  assert.deepEqual(
    upcomingRenewals(p, now).map((r) => r.kind),
    ['license'],
  )
})
