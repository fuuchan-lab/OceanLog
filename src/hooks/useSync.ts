import { useCallback, useEffect, useRef, useState } from 'react'
import { describeError, isNetworkError } from '../errors.ts'
import { syncAll, type PrefsAccess, type ProfileAccess } from '../sync.ts'
import type { DriveAccount } from './useGoogleAuth.ts'

export interface SyncState {
  status: 'idle' | 'syncing' | 'error' | 'offline'
  lastSyncAt: number | null
  error: string | null
  syncNow: () => Promise<void>
  /** 記録を変えた時に呼ぶ。少し待ってから同期する */
  request: () => void
  /** 変更があり、同期を待っている（数秒後に送る） */
  pending: boolean
}

/** ログイン中は、記録を変えた時・ネットが戻った時・定期的に、Google ドライブと同期する */
export function useSync(account: DriveAccount | null, profile: ProfileAccess, prefs: PrefsAccess, onRemoteChange: () => void): SyncState {
  const [status, setStatus] = useState<SyncState['status']>('idle')
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const running = useRef(false)
  const again = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const folderId = account?.folderId ?? null
  const onRemoteChangeRef = useRef(onRemoteChange)
  const profileRef = useRef(profile)
  const prefsRef = useRef(prefs)
  useEffect(() => {
    onRemoteChangeRef.current = onRemoteChange
    profileRef.current = profile
    prefsRef.current = prefs
  })

  const syncNow = useCallback(async () => {
    if (!folderId) return
    if (running.current) {
      again.current = true
      return
    }
    if (navigator.onLine === false) {
      setStatus('offline')
      return
    }
    running.current = true
    setPending(false)
    setStatus('syncing')
    try {
      await syncAll(
        folderId,
        { get: () => profileRef.current.get(), apply: (p) => profileRef.current.apply(p) },
        { get: () => prefsRef.current.get(), apply: (v, s) => prefsRef.current.apply(v, s) },
      )
      setStatus('idle')
      setError(null)
      setLastSyncAt(Date.now())
      // 送っている間に消した航跡などは、ここで一覧に反映する
      onRemoteChangeRef.current()
    } catch (e) {
      console.error('[sync]', e)
      setStatus(isNetworkError(e) ? 'offline' : 'error')
      setError(describeError(e))
    } finally {
      running.current = false
      if (again.current) {
        again.current = false
        void syncNow()
      }
    }
  }, [folderId])

  const request = useCallback(() => {
    if (!folderId) return
    setPending(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void syncNow(), 3000)
  }, [syncNow, folderId])

  useEffect(() => {
    if (!folderId) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void syncNow()
    const onOnline = () => void syncNow()
    const interval = setInterval(() => void syncNow(), 5 * 60_000)
    window.addEventListener('online', onOnline)
    return () => {
      clearInterval(interval)
      window.removeEventListener('online', onOnline)
    }
  }, [folderId, syncNow])

  return { status, lastSyncAt, error, syncNow, request, pending }
}
