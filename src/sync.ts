/**
 * Google ドライブとの同期（LeadLog と同じ考え方）。
 * - 地点: 端末ごとのファイル marks-<端末ID>.json に、その端末が最後に変更した地点を書く。
 *   全端末のファイルを読み、ID ごとに新しく変更されたほうを残す。削除は印（deleted）で伝える。
 * - 航跡: 1回の航海ごとに track-<航跡ID>.json。記録を終えた航跡だけを送る。
 *   ドライブから消えた航跡（他の端末で削除）は、この端末からも消す。
 * - 出航地・ボート: profile.json。新しく変更したほうを残す。
 * - 設定（単位・地図・海しるのキー・言語・配色）: prefs.json。まとまりごとに新しく変更したほうを残す。
 * どれも ID で突き合わせるので、何度送り直しても二重にならない。
 */
import { deletePhoto, getAllPhotoInfo, markPhotoSynced, putPhoto, getPhoto, getAllMarks, getAllTracks, getPoints, markMarksSynced, putMark, putTrack, putTrackWithPoints, removeTrack } from './db.ts'
import { getDeviceId } from './device.ts'
import { deleteFile, downloadBlob, downloadText, listFolderFiles, uploadFile } from './drive.ts'
import { MARKS_FILE, TRACK_FILE, marksFileName, marksForDevice, mergeMarks, trackFileName } from './syncMerge.ts'
import { loadSyncedProfileAt, parseProfile, referencedPhotoIds, saveSyncedProfileAt, type Profile } from './profile.ts'
import { mergePrefs, parsePrefsFile, type Prefs, type PrefStamps, type PrefValues } from './prefs.ts'
import type { Mark, MarksFile, TrackFile } from './types.ts'

export interface ProfileAccess {
  get: () => Profile
  /** ドライブのほうが新しかった時に、端末に反映する */
  apply: (p: Profile) => void
}

export interface PrefsAccess {
  get: () => Prefs
  /** ドライブのほうが新しかったまとまりを、端末に反映する */
  apply: (values: Partial<PrefValues>, stamps: PrefStamps) => void
}

const PROFILE_FILE = 'profile.json'
const PREFS_FILE = 'prefs.json'
const PHOTO_FILE = /^photo-([0-9a-f-]{36})\.jpg$/
const photoFileName = (id: string) => `photo-${id}.jpg`

export interface SyncResult {
  /** ドライブから取り込んだり、消したりして、端末の記録が変わった */
  changed: boolean
}

const stripSynced = <T extends { synced?: boolean }>(x: T): Omit<T, 'synced'> => {
  const { synced: _synced, ...rest } = x
  void _synced
  return rest
}

export async function syncAll(folderId: string, profile: ProfileAccess, prefs: PrefsAccess): Promise<SyncResult> {
  const deviceId = getDeviceId()
  const files = await listFolderFiles(folderId)
  let changed = false

  // --- 設定（単位・地図・海しるのキー・言語・配色）。まとまりごとに新しいほうを残す ---
  const prefsFile = files.find((f) => f.name === PREFS_FILE)
  let remotePrefs: ReturnType<typeof parsePrefsFile> | null = null
  if (prefsFile) {
    try {
      remotePrefs = parsePrefsFile(JSON.parse(await downloadText(prefsFile.id)))
    } catch (e) {
      console.error('[sync-prefs-read]', e)
    }
  }
  // 読めなかった時は、ドライブの設定を上書きしない
  if (!prefsFile || remotePrefs) {
    const merge = mergePrefs(prefs.get(), remotePrefs)
    if (Object.keys(merge.apply).length > 0) prefs.apply(merge.apply, merge.stamps)
    if (merge.upload) {
      await uploadFile({
        id: prefsFile?.id,
        name: PREFS_FILE,
        mimeType: 'application/json',
        blob: new Blob([JSON.stringify(merge.upload)], { type: 'application/json' }),
        parentId: folderId,
      })
    }
  }

  // --- 出航地・ボート ---
  const profileFile = files.find((f) => f.name === PROFILE_FILE)
  let remoteProfile: Profile | null = null
  if (profileFile) {
    try {
      remoteProfile = parseProfile(JSON.parse(await downloadText(profileFile.id)))
    } catch (e) {
      console.error('[sync-profile-read]', e)
    }
  }
  const localProfile = profile.get()
  let current = localProfile
  if (remoteProfile && remoteProfile.updatedAt > localProfile.updatedAt) {
    current = remoteProfile
    profile.apply(remoteProfile)
    saveSyncedProfileAt(remoteProfile.updatedAt)
  } else if (localProfile.updatedAt > 0 && (localProfile.updatedAt !== loadSyncedProfileAt() || !profileFile)) {
    await uploadFile({
      id: profileFile?.id,
      name: PROFILE_FILE,
      mimeType: 'application/json',
      blob: new Blob([JSON.stringify(localProfile)], { type: 'application/json' }),
      parentId: folderId,
    })
    saveSyncedProfileAt(localProfile.updatedAt)
  }

  // --- 写真（書類・船）。profile.json が指している写真だけを持つ ---
  const wanted = new Set(referencedPhotoIds(current))
  const remotePhotos = new Map<string, string>()
  for (const f of files) {
    const m = PHOTO_FILE.exec(f.name)
    if (m) remotePhotos.set(m[1], f.id)
  }
  const localPhotos = await getAllPhotoInfo()
  for (const p of localPhotos) {
    if (!wanted.has(p.id)) {
      // 削除した写真（他の端末で消した場合も、profile.json から外れる）
      await deletePhoto(p.id)
      continue
    }
    if (!p.synced) {
      const blob = await getPhoto(p.id)
      if (blob) {
        await uploadFile({ id: remotePhotos.get(p.id), name: photoFileName(p.id), mimeType: blob.type || 'image/jpeg', blob, parentId: folderId })
        await markPhotoSynced(p.id)
      }
    }
  }
  const localIds = new Set(localPhotos.map((p) => p.id))
  for (const id of wanted) {
    const fileId = remotePhotos.get(id)
    if (localIds.has(id) || !fileId) continue
    try {
      await putPhoto(id, await downloadBlob(fileId), true)
      changed = true
    } catch (e) {
      console.error('[sync-photo-read]', id, e)
    }
  }
  // どこからも使われていないドライブの写真は消す（profile.json を最新にした後なので、他の端末の写真を消すことはない）
  if (current.updatedAt === loadSyncedProfileAt()) {
    for (const [id, fileId] of remotePhotos) if (!wanted.has(id)) await deleteFile(fileId)
  }

  // --- 地点 ---
  const remoteMarks: Mark[] = []
  let ownFileId: string | undefined
  for (const f of files) {
    const m = MARKS_FILE.exec(f.name)
    if (!m) continue
    if (m[1] === deviceId) ownFileId = f.id
    try {
      const data = JSON.parse(await downloadText(f.id)) as MarksFile
      if (Array.isArray(data.marks)) remoteMarks.push(...data.marks)
    } catch (e) {
      console.error('[sync-marks-read]', f.name, e)
    }
  }
  const localMarks = await getAllMarks()
  const { merged, fromRemote } = mergeMarks(localMarks.map(stripSynced), remoteMarks)
  for (const m of fromRemote) await putMark({ ...m, synced: true })
  if (fromRemote.length > 0) changed = true
  const unsynced = localMarks.filter((m) => !m.synced)
  if (unsynced.length > 0 || (!ownFileId && merged.some((m) => m.editedBy === deviceId))) {
    const body: MarksFile = { app: 'OceanLog', version: 1, deviceId, marks: marksForDevice(merged, deviceId) }
    await uploadFile({
      id: ownFileId,
      name: marksFileName(deviceId),
      mimeType: 'application/json',
      blob: new Blob([JSON.stringify(body)], { type: 'application/json' }),
      parentId: folderId,
    })
    await markMarksSynced(unsynced.map((m) => ({ id: m.id, updatedAt: m.updatedAt })))
  }

  // --- 航跡 ---
  const remoteTracks = new Map<string, { id: string; modifiedTime: string }>()
  for (const f of files) {
    const m = TRACK_FILE.exec(f.name)
    if (m) remoteTracks.set(m[1], { id: f.id, modifiedTime: f.modifiedTime })
  }
  const localTracks = await getAllTracks()
  const localTrackIds = new Set(localTracks.map((t) => t.id))

  for (const track of localTracks) {
    const remote = remoteTracks.get(track.id)
    if (track.deleted) {
      if (remote) await deleteFile(remote.id)
      await removeTrack(track.id)
      continue
    }
    if (track.endedAt === null) continue // 記録中
    if (!track.synced) {
      const points = await getPoints(track.id)
      const body: TrackFile = {
        app: 'OceanLog',
        version: 1,
        track: stripSynced(track),
        points: points.map(({ trackId: _id, ...p }) => {
          void _id
          return p
        }),
      }
      const res = await uploadFile({
        id: remote?.id,
        name: trackFileName(track.id),
        mimeType: 'application/json',
        blob: new Blob([JSON.stringify(body)], { type: 'application/json' }),
        parentId: folderId,
      })
      // 送っている間に名前を変えた場合は、次の同期でもう一度送る
      const cur = localTracks.find((t) => t.id === track.id)
      if (cur && cur.updatedAt === track.updatedAt) await putTrack({ ...track, synced: true, remoteModified: res.modifiedTime })
      continue
    }
    if (!remote) {
      // 同期済みなのにドライブから消えている = 他の端末で削除した
      await removeTrack(track.id)
      changed = true
    } else if (track.remoteModified && remote.modifiedTime !== track.remoteModified) {
      // 他の端末で名前などを変えた
      await importTrack(track.id, remote)
      changed = true
    }
  }

  for (const [trackId, remote] of remoteTracks) {
    if (localTrackIds.has(trackId)) continue
    await importTrack(trackId, remote)
    changed = true
  }
  return { changed }
}

async function importTrack(trackId: string, remote: { id: string; modifiedTime: string }) {
  try {
    const data = JSON.parse(await downloadText(remote.id)) as TrackFile
    if (!data.track || data.track.id !== trackId || !Array.isArray(data.points)) return
    await removeTrack(trackId)
    await putTrackWithPoints(
      { ...data.track, synced: true, remoteModified: remote.modifiedTime },
      data.points.map((p) => ({ ...p, trackId })),
    )
  } catch (e) {
    console.error('[sync-track-read]', trackId, e)
  }
}
