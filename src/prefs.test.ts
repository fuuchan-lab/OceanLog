import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMPTY_MSIL } from './msil.ts'
import { mergePrefs, parsePrefsFile, ZERO_STAMPS, type Prefs } from './prefs.ts'
import { DEFAULT_SETTINGS } from './settings.ts'

const msilWithKey = { key: 'abc123', layers: [{ id: 'l1', name: '底質', url: 'https://api.msil.go.jp/x/MapServer' }], enabled: ['l1'] }

const local = (stamps: Partial<Prefs['stamps']>, values: Partial<Prefs['values']> = {}): Prefs => ({
  values: { settings: DEFAULT_SETTINGS, msil: EMPTY_MSIL, lang: null, theme: 'auto', ...values },
  stamps: { ...ZERO_STAMPS, ...stamps },
})

test('新しい端末は、ドライブの設定（海しるのキーなど）を引き継ぐ', () => {
  const remote = parsePrefsFile({ sections: { msil: { at: 100, value: msilWithKey }, lang: { at: 50, value: 'en' } } })
  const r = mergePrefs(local({}), remote)
  assert.deepEqual(r.apply.msil, msilWithKey)
  assert.equal(r.apply.lang, 'en')
  assert.equal(r.stamps.msil, 100)
  assert.equal(r.upload, null)
})

test('新しい端末で地図を変えても、ドライブの海しるのキーは消えない', () => {
  const remote = parsePrefsFile({ sections: { msil: { at: 100, value: msilWithKey } } })
  const r = mergePrefs(local({ settings: 200 }, { settings: { ...DEFAULT_SETTINGS, baseLayer: 'gsi-photo' } }), remote)
  assert.deepEqual(r.apply.msil, msilWithKey)
  assert.ok(r.upload)
  assert.deepEqual(r.upload.sections.msil, { at: 100, value: msilWithKey })
  assert.equal(r.upload.sections.settings?.value.baseLayer, 'gsi-photo')
})

test('端末のほうが新しければドライブに送り、同じなら何もしない', () => {
  const remote = parsePrefsFile({ sections: { msil: { at: 100, value: EMPTY_MSIL } } })
  const newer = mergePrefs(local({ msil: 300 }, { msil: msilWithKey }), remote)
  assert.deepEqual(newer.apply, {})
  assert.deepEqual(newer.upload?.sections.msil, { at: 300, value: msilWithKey })
  const same = mergePrefs(local({ msil: 100 }, { msil: EMPTY_MSIL }), remote)
  assert.equal(same.upload, null)
})

test('ドライブに設定がなく、端末でも変えていなければ送らない', () => {
  assert.equal(mergePrefs(local({}), null).upload, null)
  assert.ok(mergePrefs(local({ theme: 1 }, { theme: 'dark' }), null).upload)
})

test('壊れたまとまりは無視する', () => {
  const r = parsePrefsFile({ sections: { theme: { at: 5, value: 'purple' }, lang: { at: 'x', value: 'ja' }, settings: { at: 9, value: { windUnit: 'kn' } } } })
  assert.equal(r.values.theme, undefined)
  assert.equal(r.values.lang, undefined)
  assert.equal(r.values.settings?.windUnit, 'kn')
  assert.equal(r.stamps.settings, 9)
  assert.deepEqual(parsePrefsFile(null).stamps, ZERO_STAMPS)
})
