/**
 * 法定備品のチェックリスト。航行区域ごとの一般的な目安（日本小型船舶検査機構 JCI の「法定備品」の表を参考）を元に、
 * 自分の船に合わせて項目を足したり外したりできる。正しくは、船舶検査手帳・船舶検査証書の記載に従う。
 * 内容は profile.json で、同じアカウントの端末と共通にする。チェックは、日が変わると外れる（出港前の点検のため）
 */
import type { BoatType } from './profile.ts'

/** 航行区域: 平水 / 限定沿海 / 沿岸（陸岸から5海里以内） / 沿海 */
export type Zone = 'heisui' | 'gentei' | 'engan' | 'enkai'

export const ZONES: Zone[] = ['heisui', 'gentei', 'engan', 'enkai']

interface Text {
  ja: string
  en: string
}

export interface EquipmentTemplate {
  id: string
  label: Text
  qty: Text
  note?: Text
  /** この区域から必要（平水 < 限定沿海 < 沿岸 < 沿海） */
  from: Zone
  /** 夜間も航行できる船だけ（「日出から日没まで」の限定がない船） */
  nightOnly?: boolean
}

const ZONE_RANK: Record<Zone, number> = { heisui: 0, gentei: 1, engan: 2, enkai: 3 }

/** モーターボートなど（小型船舶、旅客定員12名以下の一般船）の目安 */
export const BOAT_ITEMS: EquipmentTemplate[] = [
  { id: 'mooring', label: { ja: '係船索（ロープ）', en: 'Mooring lines' }, qty: { ja: '2本', en: '2' }, from: 'heisui' },
  { id: 'anchor', label: { ja: '錨（アンカー）と錨索', en: 'Anchor and rode' }, qty: { ja: '1', en: '1' }, note: { ja: '湖川・港内だけを航行する船などは、要らない場合があります', en: 'May not be required for lakes, rivers or harbors only' }, from: 'heisui' },
  { id: 'lifejacket', label: { ja: '救命胴衣（ライフジャケット）', en: 'Life jackets' }, qty: { ja: '定員分', en: 'one per person' }, note: { ja: '桜マーク（国の型式承認）付き。平水区域では救命クッションでよい場合があります', en: 'Type-approved (sakura mark). Cushions may be accepted in sheltered waters' }, from: 'heisui' },
  { id: 'extinguisher', label: { ja: '消火器（小型船舶用）', en: 'Fire extinguisher (small craft)' }, qty: { ja: '1〜2本', en: '1–2' }, note: { ja: '数は船内機・船外機などで違います。1本は赤いバケツで代えられる場合があります。使用期限・圧力を確認', en: 'Number depends on inboard/outboard; a red bucket may replace one. Check expiry and pressure' }, from: 'heisui' },
  { id: 'bailer', label: { ja: 'あかくみ（バケツなど）', en: 'Bailer (bucket)' }, qty: { ja: '1', en: '1' }, from: 'heisui' },
  { id: 'whistle', label: { ja: '音響信号器具（笛など）', en: 'Sound signal (whistle)' }, qty: { ja: '1', en: '1' }, from: 'heisui' },
  { id: 'lights', label: { ja: '航海灯', en: 'Navigation lights' }, qty: { ja: '一式', en: 'set' }, note: { ja: '夜間に航行する場合。点灯を確認', en: 'For night navigation. Check that they work' }, from: 'heisui', nightOnly: true },
  { id: 'lifebuoy', label: { ja: '救命浮環（救命浮輪）', en: 'Lifebuoy' }, qty: { ja: '1', en: '1' }, from: 'gentei' },
  { id: 'flare', label: { ja: '信号紅炎（小型船舶用）', en: 'Hand flares (small craft)' }, qty: { ja: '1組', en: '1 set' }, note: { ja: '有効期限を確認（期限切れは備品として認められません）', en: 'Check the expiry date' }, from: 'gentei' },
  { id: 'blackball', label: { ja: '黒色球形形象物（黒球）', en: 'Black ball (day shape)' }, qty: { ja: '1', en: '1' }, note: { ja: '錨泊中に掲げます', en: 'Shown when at anchor' }, from: 'gentei' },
  { id: 'radio', label: { ja: 'ラジオ（中波・短波を受信できるもの）', en: 'Radio (AM / shortwave)' }, qty: { ja: '1', en: '1' }, note: { ja: '無線設備などを備える場合は、要らない場合があります', en: 'May not be required with a marine radio' }, from: 'engan' },
  { id: 'compass', label: { ja: '磁気コンパス', en: 'Magnetic compass' }, qty: { ja: '1', en: '1' }, from: 'enkai' },
  { id: 'chart', label: { ja: '海図（航行する海域のもの）', en: 'Nautical charts for the area' }, qty: { ja: '一式', en: 'set' }, from: 'enkai' },
  { id: 'binoculars', label: { ja: '双眼鏡', en: 'Binoculars' }, qty: { ja: '1', en: '1' }, from: 'enkai' },
]

/** 水上オートバイ（特殊小型船舶）の目安 */
export const PWC_ITEMS: EquipmentTemplate[] = [
  { id: 'pwc-lifejacket', label: { ja: 'ライフジャケット（着用）', en: 'Life jacket (worn)' }, qty: { ja: '定員分', en: 'one per person' }, note: { ja: '乗る人は全員着用が義務。TYPE C・F・G は笛などの音響信号器具も必要', en: 'Everyone must wear one. Types C, F, G also need a whistle' }, from: 'heisui' },
  { id: 'pwc-mooring', label: { ja: '係船索（ロープ）', en: 'Mooring line' }, qty: { ja: '1本', en: '1' }, from: 'heisui' },
  { id: 'pwc-flare', label: { ja: '信号紅炎（小型船舶用）', en: 'Hand flares (small craft)' }, qty: { ja: '1組', en: '1 set' }, note: { ja: '有効期限を確認', en: 'Check the expiry date' }, from: 'heisui' },
]

export interface CustomItem {
  id: string
  label: string
  qty: string
}

export interface EquipmentSettings {
  zone: Zone
  /** 外した目安の項目の ID */
  hidden: string[]
  /** 自分で足した項目 */
  custom: CustomItem[]
  /** チェックした項目の ID と、チェックした日（YYYY-MM-DD）。日が変わると外れる */
  checked: string[]
  checkedDay: string
}

export const DEFAULT_EQUIPMENT: EquipmentSettings = { zone: 'gentei', hidden: [], custom: [], checked: [], checkedDay: '' }

export interface ChecklistItem {
  id: string
  label: string
  qty: string
  note?: string
  custom: boolean
}

/** この船の区域・種類・夜間航行に合わせた項目（外した項目を除き、自分で足した項目を加える） */
export function checklistItems(eq: EquipmentSettings, type: BoatType, daylightOnly: boolean, lang: 'ja' | 'en', includeHidden = false): ChecklistItem[] {
  const base = (type === 'pwc' ? PWC_ITEMS : BOAT_ITEMS).filter((i) => ZONE_RANK[i.from] <= ZONE_RANK[eq.zone] && !(i.nightOnly && daylightOnly))
  return [
    ...base
      .filter((i) => includeHidden || !eq.hidden.includes(i.id))
      .map((i) => ({ id: i.id, label: i.label[lang], qty: i.qty[lang], note: i.note?.[lang], custom: false })),
    ...eq.custom.map((c) => ({ id: c.id, label: c.label, qty: c.qty, custom: true })),
  ]
}

/** 端末の日付（YYYY-MM-DD） */
export function localDay(now: number): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 今日チェックした項目（日が変わっていれば空） */
export function checkedToday(eq: EquipmentSettings, now: number): string[] {
  return eq.checkedDay === localDay(now) ? eq.checked : []
}

export function parseEquipment(value: unknown): EquipmentSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_EQUIPMENT
  const v = value as Partial<EquipmentSettings>
  const strings = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : [])
  return {
    zone: ZONES.includes(v.zone as Zone) ? (v.zone as Zone) : DEFAULT_EQUIPMENT.zone,
    hidden: strings(v.hidden),
    custom: Array.isArray(v.custom)
      ? v.custom.flatMap((c): CustomItem[] =>
          typeof c === 'object' && c !== null && typeof c.id === 'string' && typeof c.label === 'string' ? [{ id: c.id, label: c.label, qty: typeof c.qty === 'string' ? c.qty : '' }] : [],
        )
      : [],
    checked: strings(v.checked),
    checkedDay: typeof v.checkedDay === 'string' ? v.checkedDay : '',
  }
}
