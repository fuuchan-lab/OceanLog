import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'
import { createTokenWaiter } from './tokenWaiter.ts'

beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }))
afterEach(() => mock.timers.reset())

const options = { graceMs: 8000, timeoutMs: 180000 }

/** 決着したか（resolve / reject 済みか）を、テストから確かめるための印を付ける */
function track<T>(p: Promise<T>) {
  const state: { status: 'pending' | 'resolved' | 'rejected'; value?: T; error?: string } = { status: 'pending' }
  p.then(
    (value) => Object.assign(state, { status: 'resolved', value }),
    (e: Error) => Object.assign(state, { status: 'rejected', error: e.message }),
  )
  return state
}
const flush = () => new Promise<void>((r) => setImmediate(r))

test('トークンが届けば、その値で成功する', async () => {
  const w = createTokenWaiter<string>(options)
  const s = track(w.promise)
  w.resolve('token')
  await flush()
  assert.deepEqual([s.status, s.value], ['resolved', 'token'])
})

test('popup_closed の通知だけでは、すぐには失敗にしない', async () => {
  const w = createTokenWaiter<string>(options)
  const s = track(w.promise)
  w.fail('popup_closed')
  mock.timers.tick(7_999)
  await flush()
  assert.equal(s.status, 'pending')
})

test('popup_closed の後でも、猶予の間にトークンが届けば成功する（スマホでの取りこぼし対策）', async () => {
  const w = createTokenWaiter<string>(options)
  const s = track(w.promise)
  w.fail('popup_closed')
  mock.timers.tick(3_000)
  w.resolve('late-token')
  mock.timers.tick(60_000) // 猶予の時間が過ぎても、成功のまま
  await flush()
  assert.deepEqual([s.status, s.value], ['resolved', 'late-token'])
})

test('猶予を過ぎてもトークンが届かなければ、popup_closed で失敗する', async () => {
  const w = createTokenWaiter<string>(options)
  const s = track(w.promise)
  w.fail('popup_closed')
  mock.timers.tick(8_000)
  await flush()
  assert.deepEqual([s.status, s.error], ['rejected', 'popup_closed'])
})

test('popup_closed が何度来ても、猶予は最初の通知から数える', async () => {
  const w = createTokenWaiter<string>(options)
  const s = track(w.promise)
  w.fail('popup_closed')
  mock.timers.tick(5_000)
  w.fail('popup_closed')
  mock.timers.tick(3_000) // 最初の通知から 8 秒
  await flush()
  assert.equal(s.status, 'rejected')
})

test('ポップアップを開けなかった・拒否された等は、猶予を置かずすぐ失敗にする', async () => {
  for (const type of ['popup_failed_to_open', 'access_denied', 'unknown']) {
    const w = createTokenWaiter<string>(options)
    const s = track(w.promise)
    w.fail(type)
    await flush()
    assert.deepEqual([s.status, s.error], ['rejected', type], type)
  }
})

test('何も起きないまま長く待たされたら、login_timeout で失敗する', async () => {
  const w = createTokenWaiter<string>(options)
  const s = track(w.promise)
  mock.timers.tick(179_999)
  await flush()
  assert.equal(s.status, 'pending')
  mock.timers.tick(1)
  await flush()
  assert.deepEqual([s.status, s.error], ['rejected', 'login_timeout'])
})

test('決着したあとの通知は無視する（成功のあとに popup_closed が来ても、成功のまま）', async () => {
  const w = createTokenWaiter<string>(options)
  const s = track(w.promise)
  w.resolve('token')
  w.fail('popup_closed')
  w.fail('access_denied')
  mock.timers.tick(200_000)
  await flush()
  assert.deepEqual([s.status, s.value], ['resolved', 'token'])
})
