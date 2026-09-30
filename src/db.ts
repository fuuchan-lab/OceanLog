import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Mark, Synced, Track, TrackPoint } from './types.ts'

export type StoredMark = Mark & Synced
export type StoredTrack = Track & Synced & {
  /** ドライブ上のファイルの更新日時。他の端末で名前を変えた時などに、取り直すかの判断に使う */
  remoteModified?: string
}

interface OceanDB extends DBSchema {
  marks: { key: string; value: StoredMark }
  tracks: { key: string; value: StoredTrack }
  points: { key: [string, number]; value: TrackPoint; indexes: { 'by-track': string } }
  photos: { key: string; value: StoredPhoto }
}

/**
 * 写真（書類・船）。iPhone の Safari では IndexedDB に入れた Blob を後で読めないことがあるため、
 * LeadLog と同じくバイト列（ArrayBuffer）で保存する
 */
export interface StoredPhoto {
  id: string
  data: ArrayBuffer
  type: string
  synced: boolean
}

let dbPromise: Promise<IDBPDatabase<OceanDB>> | null = null

function getDB() {
  dbPromise ??= openDB<OceanDB>('oceanlog', 1, {
    upgrade(db) {
      db.createObjectStore('marks', { keyPath: 'id' })
      db.createObjectStore('tracks', { keyPath: 'id' })
      const points = db.createObjectStore('points', { keyPath: ['trackId', 't'] })
      points.createIndex('by-track', 'trackId')
      db.createObjectStore('photos', { keyPath: 'id' })
    },
  })
  return dbPromise
}

export async function getAllMarks(): Promise<StoredMark[]> {
  return (await getDB()).getAll('marks')
}

export async function putMark(mark: StoredMark) {
  await (await getDB()).put('marks', mark)
}

/** 同期の間に編集されていなければ、同期済みにする */
export async function markMarksSynced(items: { id: string; updatedAt: number }[]) {
  const db = await getDB()
  const tx = db.transaction('marks', 'readwrite')
  for (const { id, updatedAt } of items) {
    const cur = await tx.store.get(id)
    if (cur && cur.updatedAt === updatedAt) await tx.store.put({ ...cur, synced: true })
  }
  await tx.done
}

export async function getAllTracks(): Promise<StoredTrack[]> {
  return (await getDB()).getAll('tracks')
}

export async function getTrack(id: string): Promise<StoredTrack | undefined> {
  return (await getDB()).get('tracks', id)
}

export async function putTrack(track: StoredTrack) {
  await (await getDB()).put('tracks', track)
}

export async function addPoint(point: TrackPoint) {
  await (await getDB()).put('points', point)
}

export async function getPoints(trackId: string): Promise<TrackPoint[]> {
  const points = await (await getDB()).getAllFromIndex('points', 'by-track', trackId)
  return points.sort((a, b) => a.t - b.t)
}

/** 航跡と、その点をすべて端末から消す */
export async function removeTrack(trackId: string) {
  const db = await getDB()
  const tx = db.transaction(['tracks', 'points'], 'readwrite')
  await tx.objectStore('tracks').delete(trackId)
  const index = tx.objectStore('points').index('by-track')
  for (let cursor = await index.openCursor(trackId); cursor; cursor = await cursor.continue()) await cursor.delete()
  await tx.done
}

/** 他の端末の航跡を、点ごとまとめて保存する */
export async function putTrackWithPoints(track: StoredTrack, points: TrackPoint[]) {
  const db = await getDB()
  const tx = db.transaction(['tracks', 'points'], 'readwrite')
  await tx.objectStore('tracks').put(track)
  for (const p of points) await tx.objectStore('points').put(p)
  await tx.done
}

/**
 * ログアウト・アカウントの切り替えの時に、すべてを「未同期」に戻す。
 * 別のアカウントのドライブに無い航跡を「他の端末で削除された」と取り違えて消さないため。
 * 次にログインしたアカウントのドライブへ、改めて送る
 */
export async function markAllUnsynced() {
  const db = await getDB()
  const tx = db.transaction(['marks', 'tracks'], 'readwrite')
  for (const m of await tx.objectStore('marks').getAll()) await tx.objectStore('marks').put({ ...m, synced: false })
  for (const t of await tx.objectStore('tracks').getAll()) await tx.objectStore('tracks').put({ ...t, synced: false, remoteModified: undefined })
  await tx.done
  const photos = db.transaction('photos', 'readwrite')
  for (const p of await photos.store.getAll()) await photos.store.put({ ...p, synced: false })
  await photos.done
}

export async function putPhoto(id: string, blob: Blob, synced = false) {
  const data = await blob.arrayBuffer()
  await (await getDB()).put('photos', { id, data, type: blob.type || 'image/jpeg', synced })
}

export async function getPhoto(id: string): Promise<Blob | null> {
  const p = await (await getDB()).get('photos', id)
  return p ? new Blob([p.data], { type: p.type }) : null
}

export async function getAllPhotoInfo(): Promise<{ id: string; synced: boolean }[]> {
  return (await (await getDB()).getAll('photos')).map((p) => ({ id: p.id, synced: p.synced }))
}

export async function markPhotoSynced(id: string) {
  const db = await getDB()
  const cur = await db.get('photos', id)
  if (cur) await db.put('photos', { ...cur, synced: true })
}

export async function deletePhoto(id: string) {
  await (await getDB()).delete('photos', id)
}
