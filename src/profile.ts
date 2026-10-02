/**
 * 出航地（マザーポート）とボートの情報。Google ドライブの profile.json で、同じアカウントの端末の間で共有する。
 */
import { newId } from './device.ts'
import { DEFAULT_EQUIPMENT, parseEquipment, type EquipmentSettings } from './equipment.ts'
import { parseUserCharts, type UserChart } from './chartGeo.ts'

export interface HomePort {
  id: string
  name: string
  lat: number
  lon: number
  /**
   * 平均水面の高さ Z0 (m)。潮位表の基準（基本水準面 = 最低水面の目安）から、平均水面までの高さ。
   * 予報の潮位（平均水面が 0）に足して、潮位表と同じ基準の潮位にする。分からなければ 0（平均水面が基準）
   */
  z0: number
  /** 干潮危険潮位 (m、潮位表の基準)。これより潮位が低いと、桟橋・スロープが使いにくい */
  dangerLevel: number
}

/** 小型船舶（モーターボートなど）/ 特殊小型船舶（水上オートバイ・ジェットスキー） */
export type BoatType = 'boat' | 'pwc'

export interface Boat {
  type: BoatType
  /** 船名（例: 〇〇丸） */
  name: string
  /** 船舶番号 */
  registration: string
  /** 船の写真（端末の photos に保存。ID） */
  photoId: string | null
  /** 全長 (m) */
  length: number | null
  /** 全幅 (m) */
  beam: number | null
  /** 深さ (m) */
  depth: number | null
  /** 定員（最大搭載人員） */
  capacity: number | null
  /** 船外機（エンジン）の出力 (馬力) */
  horsepower: number | null
  /** 最高速度 (ノット) */
  maxSpeed: number | null
  /** 危険な波の高さ (m)。予報の波高がこれを超えそうなら警告する */
  dangerWave: number | null
  /** 航行時間の制限「日出から日没まで」（船舶検査証書の航行上の条件）。あれば日没を警告する */
  daylightOnly: boolean
}

export type DocKind = 'boatBook' | 'license' | 'other'

export const DOC_KINDS: DocKind[] = ['license', 'boatBook', 'other']

/** 書類の写真（船舶検査手帳・小型船舶操縦免許証など） */
export interface DocPhoto {
  id: string
  kind: DocKind
  /** 「表」「裏」「3ページ目」など */
  label: string
  createdAt: number
}

export interface Docs {
  items: DocPhoto[]
  /** 免許の種類（例: 二級小型船舶操縦士） */
  licenseType: string
  /** 免許の有効期限 (YYYY-MM-DD)。空なら未設定 */
  licenseExpiry: string
  /** 船舶検査の有効期限 (YYYY-MM-DD) */
  inspectionExpiry: string
}

export interface Profile {
  ports: HomePort[]
  boat: Boat
  docs: Docs
  /** 法定備品のチェックリスト */
  equipment: EquipmentSettings
  /** 自分で撮影・アップロードした海図（画像は photos、基準点はここ） */
  charts: UserChart[]
  /** 出港時・安全の表示に使う出航地 */
  activePortId: string | null
  updatedAt: number
}

export const EMPTY_BOAT: Boat = { type: 'boat', name: '', registration: '', photoId: null, length: null, beam: null, depth: null, capacity: null, horsepower: null, maxSpeed: null, dangerWave: null, daylightOnly: false }

export const EMPTY_DOCS: Docs = { items: [], licenseType: '', licenseExpiry: '', inspectionExpiry: '' }

export const EMPTY_PROFILE: Profile = { ports: [], boat: EMPTY_BOAT, docs: EMPTY_DOCS, equipment: DEFAULT_EQUIPMENT, charts: [], activePortId: null, updatedAt: 0 }

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const KEY = 'oceanlog-profile'

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const numOr = (v: unknown, d: number) => numOrNull(v) ?? d

export function parseProfile(value: unknown): Profile {
  if (typeof value !== 'object' || value === null) return EMPTY_PROFILE
  const v = value as Partial<Profile>
  const ports = Array.isArray(v.ports)
    ? v.ports.flatMap((p): HomePort[] => {
        if (typeof p !== 'object' || p === null) return []
        const lat = numOrNull(p.lat)
        const lon = numOrNull(p.lon)
        if (lat === null || lon === null) return []
        return [
          {
            id: typeof p.id === 'string' ? p.id : newId(),
            name: typeof p.name === 'string' ? p.name : '',
            lat,
            lon,
            z0: numOr(p.z0, 0),
            dangerLevel: numOr(p.dangerLevel, 0),
          },
        ]
      })
    : []
  const b = (typeof v.boat === 'object' && v.boat !== null ? v.boat : {}) as Partial<Boat>
  return {
    ports,
    boat: {
      type: b.type === 'pwc' ? 'pwc' : 'boat',
      name: typeof b.name === 'string' ? b.name : '',
      registration: typeof b.registration === 'string' ? b.registration : '',
      photoId: typeof b.photoId === 'string' ? b.photoId : null,
      length: numOrNull(b.length),
      beam: numOrNull(b.beam),
      depth: numOrNull(b.depth),
      capacity: numOrNull(b.capacity),
      horsepower: numOrNull(b.horsepower),
      maxSpeed: numOrNull(b.maxSpeed),
      dangerWave: numOrNull(b.dangerWave),
      daylightOnly: b.daylightOnly === true,
    },
    docs: parseDocs(v.docs),
    equipment: parseEquipment(v.equipment),
    charts: parseUserCharts(v.charts),
    activePortId: typeof v.activePortId === 'string' && ports.some((p) => p.id === v.activePortId) ? v.activePortId : null,
    updatedAt: numOr(v.updatedAt, 0),
  }
}

function parseDocs(value: unknown): Docs {
  if (typeof value !== 'object' || value === null) return EMPTY_DOCS
  const d = value as Partial<Docs>
  const items = Array.isArray(d.items)
    ? d.items.flatMap((x): DocPhoto[] =>
        typeof x === 'object' && x !== null && typeof x.id === 'string'
          ? [
              {
                id: x.id,
                kind: x.kind === 'boatBook' || x.kind === 'license' ? x.kind : 'other',
                label: typeof x.label === 'string' ? x.label : '',
                createdAt: numOr(x.createdAt, 0),
              },
            ]
          : [],
      )
    : []
  return {
    items,
    licenseType: typeof d.licenseType === 'string' ? d.licenseType : '',
    licenseExpiry: typeof d.licenseExpiry === 'string' && DATE_RE.test(d.licenseExpiry) ? d.licenseExpiry : '',
    inspectionExpiry: typeof d.inspectionExpiry === 'string' && DATE_RE.test(d.inspectionExpiry) ? d.inspectionExpiry : '',
  }
}

/** プロフィールが使っている写真の ID（船の写真・書類の写真・自分の海図） */
export function referencedPhotoIds(p: Profile): string[] {
  return [...(p.boat.photoId ? [p.boat.photoId] : []), ...p.docs.items.map((d) => d.id), ...p.charts.map((c) => c.id)]
}

/** 有効期限までの日数（期限の日を含む）。未設定なら null。過ぎていれば負 */
export function daysUntil(date: string, now: number): number | null {
  if (!DATE_RE.test(date)) return null
  const [y, m, d] = date.split('-').map(Number)
  const end = new Date(y, m - 1, d, 23, 59, 59).getTime()
  return Math.floor((end - now) / 86_400_000)
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? parseProfile(JSON.parse(raw)) : EMPTY_PROFILE
  } catch {
    return EMPTY_PROFILE
  }
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // 保存できなくても、その回は反映される
  }
}

const PROFILE_SYNCED_KEY = 'oceanlog-profile-synced'

/** ドライブに送った profile の updatedAt。変えていなければ送らない */
export function loadSyncedProfileAt(): number {
  try {
    return Number(localStorage.getItem(PROFILE_SYNCED_KEY)) || 0
  } catch {
    return 0
  }
}

export function saveSyncedProfileAt(at: number) {
  try {
    localStorage.setItem(PROFILE_SYNCED_KEY, String(at))
  } catch {
    // 次の同期でもう一度送るだけ
  }
}

/** 更新のお知らせを出す日数（1か月前から） */
export const RENEWAL_NOTICE_DAYS = 31

export interface Renewal {
  kind: 'license' | 'inspection'
  date: string
  days: number
}

/** 1か月以内に来る（または過ぎた）、免許の更新・船舶検査 */
export function upcomingRenewals(p: Profile, now: number): Renewal[] {
  const out: Renewal[] = []
  for (const [kind, date] of [
    ['license', p.docs.licenseExpiry],
    ['inspection', p.docs.inspectionExpiry],
  ] as const) {
    const days = daysUntil(date, now)
    if (days !== null && days <= RENEWAL_NOTICE_DAYS) out.push({ kind, date, days })
  }
  return out
}
