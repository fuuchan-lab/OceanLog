/** 同期で、端末の記録とドライブの記録を突き合わせる処理。ブラウザ機能に依存しない */
import type { Mark } from './types.ts'

/**
 * 地点の記録を ID ごとに突き合わせ、新しく変更されたほう（updatedAt が大きいほう）を残す。
 * 同じ日時なら端末側を残す。戻り値の fromRemote は、ドライブ側を採用したもの（端末に保存し直す）。
 */
export function mergeMarks(local: Mark[], remote: Mark[]): { merged: Mark[]; fromRemote: Mark[] } {
  const byId = new Map<string, Mark>()
  for (const m of local) byId.set(m.id, m)
  const fromRemote: Mark[] = []
  for (const r of remote) {
    const cur = byId.get(r.id)
    if (!cur || r.updatedAt > cur.updatedAt) {
      byId.set(r.id, r)
      fromRemote.push(r)
    }
  }
  return { merged: [...byId.values()], fromRemote }
}

/** この端末のファイルに書く地点（この端末が最後に変更したもの）。作った順 */
export function marksForDevice(marks: Mark[], deviceId: string): Mark[] {
  return marks.filter((m) => m.editedBy === deviceId).sort((a, b) => a.createdAt - b.createdAt)
}

export const MARKS_FILE = /^marks-([a-z0-9]{8})\.json$/
export const TRACK_FILE = /^track-([0-9a-f-]{36})\.json$/

export const marksFileName = (deviceId: string) => `marks-${deviceId}.json`
export const trackFileName = (trackId: string) => `track-${trackId}.json`
