import type { TFn } from './i18n/context.ts'
import { splitDuration } from './safety.ts'

export function fmtTime(ms: number, locale: string): string {
  return new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

export function fmtDateTime(ms: number, locale: string): string {
  return new Date(ms).toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** 「1時間25分」「25分」 */
export function fmtDuration(ms: number, t: TFn): string {
  const { h, m } = splitDuration(ms)
  return h > 0 ? t('dur.hm', { h, m }) : t('dur.m', { m })
}

/** 数値を小数 digits 桁で。null は「—」 */
export function fmtNum(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(digits)
}
