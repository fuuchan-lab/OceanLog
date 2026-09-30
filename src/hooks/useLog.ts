import { useCallback, useEffect, useRef, useState } from 'react'
import { addPoint, getAllMarks, getAllTracks, getPoints, getTrack, putMark, putTrack, type StoredMark, type StoredTrack } from '../db.ts'
import { getDeviceId, newId } from '../device.ts'
import { distance, type LatLon } from '../geo.ts'
import { checkReturn, shouldRecord } from '../voyage.ts'
import type { Mark, MarkKind, TrackPoint } from '../types.ts'
import type { Fix } from './useGeolocation.ts'

const ACTIVE_KEY = 'oceanlog-active-track'

/** 止まっている間の GPS の揺れを、距離に数えないための最小の移動 (m) */
const MIN_STEP_M = 15

export interface NewMark {
  name: string
  note: string
  kind: MarkKind
  lat: number
  lon: number
}

function loadActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}

function saveActiveId(id: string | null) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id)
    else localStorage.removeItem(ACTIVE_KEY)
  } catch {
    // 保存できなくても、その回の記録は続く
  }
}

/**
 * 地点と航跡の記録（端末の IndexedDB）。変更するたびに onChange を呼ぶ（同期の合図）
 */
export function useLog(fix: Fix | null, onChange: () => void, onAutoReturn: () => void = () => {}) {
  const [marks, setMarks] = useState<StoredMark[]>([])
  const [tracks, setTracks] = useState<StoredTrack[]>([])
  const [activeId, setActiveId] = useState<string | null>(loadActiveId)
  /** 記録中の航跡の点（地図に線を引くため、メモリにも持つ） */
  const [livePoints, setLivePoints] = useState<TrackPoint[]>([])
  const lastPoint = useRef<TrackPoint | null>(null)
  const onChangeRef = useRef(onChange)
  const onAutoReturnRef = useRef(onAutoReturn)
  useEffect(() => {
    onChangeRef.current = onChange
    onAutoReturnRef.current = onAutoReturn
  })
  const stopRef = useRef<(auto: boolean) => Promise<void>>(async () => {})
  /** 前の位置の処理（端末への保存）が終わるまで、次の位置は見送る（点が二重にならないように） */
  const busy = useRef(false)

  const reload = useCallback(async () => {
    const [m, t] = await Promise.all([getAllMarks(), getAllTracks()])
    setMarks(m.filter((x) => !x.deleted).sort((a, b) => b.createdAt - a.createdAt))
    setTracks(t.filter((x) => !x.deleted).sort((a, b) => b.startedAt - a.startedAt))
  }, [])

  useEffect(() => {
    void (async () => {
      await reload()
      // アプリを閉じる前に記録中だった航跡は、続きから記録する
      const id = loadActiveId()
      if (!id) return
      const track = await getTrack(id)
      if (!track || track.endedAt !== null || track.deleted) {
        saveActiveId(null)
        setActiveId(null)
        return
      }
      const points = await getPoints(id)
      lastPoint.current = points.at(-1) ?? null
      setLivePoints(points)
    })()
  }, [reload])

  // 記録中は、位置が届くたびに、出港地点に戻ったかを確かめ、1分おきに点を足す
  useEffect(() => {
    if (!activeId || !fix) return
    const prev = lastPoint.current
    if ((prev && fix.t <= prev.t) || busy.current) return
    const id = activeId
    busy.current = true
    void (async () => {
      try {
        await handleFix(id, prev)
      } finally {
        busy.current = false
      }
    })()
    async function handleFix(id: string, prev: TrackPoint | null) {
      if (!fix) return
      const track = await getTrack(id)
      if (!track || track.endedAt !== null) return
      const { maxFromStart, returned } = checkReturn({ start: track.start ?? null, maxFromStart: track.maxFromStart ?? 0 }, fix)
      const record = shouldRecord(prev, fix)
      if (!record && maxFromStart === (track.maxFromStart ?? 0) && !returned) return
      let next = { ...track, maxFromStart }
      if (record) {
        const step = prev ? distance(prev, fix) : 0
        // 止まっている間（誤差の範囲の揺れ）は距離に数えない
        const counted = prev && step > Math.max(fix.accuracy, MIN_STEP_M) ? step : 0
        const point: TrackPoint = { trackId: id, t: fix.t, lat: fix.lat, lon: fix.lon, speed: fix.speed, course: fix.course, accuracy: fix.accuracy }
        lastPoint.current = point
        setLivePoints((ps) => [...ps, point])
        await addPoint(point)
        next = { ...next, distance: next.distance + counted, maxSpeed: Math.max(next.maxSpeed, fix.speed ?? 0), pointCount: next.pointCount + 1 }
      }
      await putTrack(next)
      setTracks((ts) => ts.map((t) => (t.id === next.id ? next : t)))
      if (returned) {
        await stopRef.current(true)
        onAutoReturnRef.current()
      }
    }
  }, [fix, activeId])

  const startTrack = useCallback(
    async (name: string, start: LatLon | null) => {
      const now = Date.now()
      const track: StoredTrack = {
        id: newId(),
        name,
        startedAt: now,
        endedAt: null,
        start: start ? { lat: start.lat, lon: start.lon } : null,
        maxFromStart: 0,
        distance: 0,
        maxSpeed: 0,
        pointCount: 0,
        updatedAt: now,
        deviceId: getDeviceId(),
        synced: false,
      }
      await putTrack(track)
      lastPoint.current = null
      setLivePoints([])
      saveActiveId(track.id)
      setActiveId(track.id)
      await reload()
    },
    [reload],
  )

  const stopTrack = useCallback(async (auto = false) => {
    if (!activeId) return
    const track = await getTrack(activeId)
    if (track) await putTrack({ ...track, endedAt: Date.now(), updatedAt: Date.now(), autoReturned: auto, synced: false })
    saveActiveId(null)
    setActiveId(null)
    setLivePoints([])
    lastPoint.current = null
    await reload()
    onChangeRef.current()
  }, [activeId, reload])
  useEffect(() => {
    stopRef.current = stopTrack
  })

  const renameTrack = useCallback(
    async (id: string, name: string) => {
      const track = await getTrack(id)
      if (!track) return
      await putTrack({ ...track, name, updatedAt: Date.now(), synced: false })
      await reload()
      onChangeRef.current()
    },
    [reload],
  )

  const deleteTrack = useCallback(
    async (id: string) => {
      const track = await getTrack(id)
      if (!track) return
      if (id === activeId) {
        saveActiveId(null)
        setActiveId(null)
        setLivePoints([])
      }
      // ドライブからも消すため、印を付けて残す（同期で消える）
      await putTrack({ ...track, deleted: true, updatedAt: Date.now(), synced: false })
      await reload()
      onChangeRef.current()
    },
    [activeId, reload],
  )

  const addMark = useCallback(
    async (input: NewMark) => {
      const now = Date.now()
      await putMark({ ...input, id: newId(), createdAt: now, updatedAt: now, editedBy: getDeviceId(), synced: false })
      await reload()
      onChangeRef.current()
    },
    [reload],
  )

  const updateMark = useCallback(
    async (mark: Mark) => {
      await putMark({ ...mark, updatedAt: Date.now(), editedBy: getDeviceId(), synced: false })
      await reload()
      onChangeRef.current()
    },
    [reload],
  )

  const deleteMark = useCallback(
    async (mark: Mark) => {
      await putMark({ ...mark, deleted: true, updatedAt: Date.now(), editedBy: getDeviceId(), synced: false })
      await reload()
      onChangeRef.current()
    },
    [reload],
  )

  const unsyncedCount = marks.filter((m) => !m.synced).length + tracks.filter((t) => !t.synced && t.endedAt !== null).length

  return {
    marks,
    tracks,
    activeTrack: tracks.find((t) => t.id === activeId) ?? null,
    livePoints,
    unsyncedCount,
    reload,
    startTrack,
    stopTrack,
    renameTrack,
    deleteTrack,
    addMark,
    updateMark,
    deleteMark,
  }
}

export type LogState = ReturnType<typeof useLog>
