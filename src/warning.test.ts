import assert from 'node:assert/strict'
import { test } from 'node:test'
import { translate, type TFn } from './i18n/context.ts'
import { assessTrend } from './warning.ts'
import type { PressureForecast } from './weather.ts'

const tJa: TFn = (key, vars) => translate('ja', key, vars)
const tEn: TFn = (key, vars) => translate('en', key, vars)

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 8, 20, 12)

/** 現在 1010hPa で、今後 h 時間後の気圧が drop だけ下がる予報 */
function forecast(drops: Record<number, number>): PressureForecast {
  const series = Array.from({ length: 19 }, (_, i) => {
    const h = i - 6
    return { t: NOW + h * HOUR, hpa: 1010 - (drops[h] ?? 0), code: 0, isDay: true }
  })
  return { current: 1010, weather: { code: 0, isDay: true, temperature: 20, humidity: 50 }, series, fine: [] }
}

test('気圧が安定していれば none', () => {
  assert.equal(assessTrend(forecast({}), tJa, NOW).level, 'none')
})

test('3時間で2hPa以上下がる見込みなら caution、4hPa以上なら warning', () => {
  assert.equal(assessTrend(forecast({ 3: 2 }), tJa, NOW).level, 'caution')
  assert.equal(assessTrend(forecast({ 3: 4 }), tJa, NOW).level, 'warning')
})

test('6時間で3hPa以上なら caution、6hPa以上なら warning', () => {
  assert.equal(assessTrend(forecast({ 6: 3 }), tJa, NOW).level, 'caution')
  assert.equal(assessTrend(forecast({ 6: 6 }), tJa, NOW).level, 'warning')
})

test('警告の文言に（）の説明や数値は付けない', () => {
  for (const t of [tJa, tEn]) {
    for (const drops of [{ 3: 2 }, { 3: 5 }]) {
      const { message } = assessTrend(forecast(drops), t, NOW)
      assert.ok(!/[（()）]/.test(message), message)
      assert.ok(!/\d/.test(message), message)
    }
  }
  assert.equal(assessTrend(forecast({ 3: 2 }), tJa, NOW).message, '気圧が下がりつつあります。天候の変化に注意してください。')
  assert.equal(assessTrend(forecast({ 3: 5 }), tJa, NOW).message, '気圧が急に下がる見込みです。天候の急変・強風に注意し、早めの帰港を検討してください。')
})
