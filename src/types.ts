/** 記録する地点の種類。一覧・地図のアイコンに使う */
export type MarkKind = 'point' | 'fishing' | 'anchor' | 'danger' | 'rockSubmerged' | 'rockAwash' | 'port' | 'fuel'

export const MARK_ICONS: Record<MarkKind, string> = {
  point: '📍',
  fishing: '🎣',
  anchor: '⚓',
  danger: '⚠️',
  // 海図の記号に近い形（暗岩は＋、洗岩は＊）。海図の上では、記号の絵で表示する
  rockSubmerged: '✚',
  rockAwash: '✳',
  port: '🛥️',
  fuel: '⛽',
}

export const MARK_KINDS = Object.keys(MARK_ICONS) as MarkKind[]

/** 記録した地点（ポイント） */
export interface Mark {
  id: string
  name: string
  note: string
  kind: MarkKind
  lat: number
  lon: number
  /** 記録した日時 (epoch ms) */
  createdAt: number
  /** 最後に変更した日時。同期で、新しいほうを残すのに使う */
  updatedAt: number
  /** 最後に変更した端末の ID。その端末のファイル（marks-<端末ID>.json）に書く */
  editedBy: string
  /** 削除した印（他の端末にも削除を伝えるため、記録は残す） */
  deleted?: boolean
}

/** 航跡（1回の航海） */
export interface Track {
  id: string
  name: string
  startedAt: number
  /** 記録中は null */
  endedAt: number | null
  /** 出港地点（「出港」を押した場所）。ここに戻ると自動で帰港にする */
  start?: { lat: number; lon: number } | null
  /** 出港地点から最も離れた距離 (m) */
  maxFromStart?: number
  /** 自動で帰港にした */
  autoReturned?: boolean
  /** 航行距離 (m) */
  distance: number
  /** 最高速度 (m/s) */
  maxSpeed: number
  pointCount: number
  updatedAt: number
  deviceId: string
  deleted?: boolean
}

export interface TrackPoint {
  trackId: string
  /** epoch ms */
  t: number
  lat: number
  lon: number
  /** 対地速力 (m/s)。取れなければ null */
  speed: number | null
  /** 対地針路 (度)。取れなければ null */
  course: number | null
  /** 位置の誤差 (m) */
  accuracy: number
}

/** 端末の中だけで持つ、同期の状態 */
export interface Synced {
  synced: boolean
}

/** Google ドライブの track-<ID>.json の中身 */
export interface TrackFile {
  app: 'OceanLog'
  version: 1
  track: Track
  points: Omit<TrackPoint, 'trackId'>[]
}

/** Google ドライブの marks-<端末ID>.json の中身 */
export interface MarksFile {
  app: 'OceanLog'
  version: 1
  deviceId: string
  marks: Mark[]
}
