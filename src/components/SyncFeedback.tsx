import { useEffect, useState } from 'react'
import type { SyncState } from '../hooks/useSync.ts'
import { useI18n } from '../i18n/useI18n.ts'

/**
 * 保存した後の、Google ドライブへの送信の進み具合（送信待ち → 送信中 → 送信済み）。
 * savedAt: 保存した日時。ログインしていなければ、端末に保存したことだけを示す
 */
export function DriveProgress({ sync, signedIn, savedAt }: { sync: SyncState; signedIn: boolean; savedAt: number }) {
  const { t } = useI18n()
  if (!signedIn) return <span className="drive-step">{t('drive.localOnly')}</span>
  if (sync.status === 'syncing') return <span className="drive-step drive-busy">⏳ {t('drive.sending')}</span>
  if (sync.status === 'offline') return <span className="drive-step">📴 {t('drive.offline')}</span>
  if (sync.status === 'error') return <span className="drive-step error">⚠️ {t('drive.failed')}</span>
  if (sync.lastSyncAt !== null && sync.lastSyncAt >= savedAt) return <span className="drive-step drive-done">☁️ {t('drive.sent')}</span>
  return <span className="drive-step drive-busy">⏳ {t('drive.waiting')}</span>
}

/** ドライブへの送信が終わったか（保存の表示を消してよいか） */
export const driveSettled = (sync: SyncState, signedIn: boolean, savedAt: number) =>
  !signedIn || sync.status === 'offline' || sync.status === 'error' || (sync.status === 'idle' && !sync.pending && sync.lastSyncAt !== null && sync.lastSyncAt >= savedAt)

/** 「今すぐ同期」ボタン。押すと「同期中…」になり、終わると少しの間「✓ 同期しました」と緑になる */
export function SyncNowButton({ sync, className = 'secondary' }: { sync: SyncState; className?: string }) {
  const { t } = useI18n()
  const [pressedAt, setPressedAt] = useState<number | null>(null)
  const busy = sync.status === 'syncing'
  const done = pressedAt !== null && !busy && sync.lastSyncAt !== null && sync.lastSyncAt >= pressedAt
  const failed = pressedAt !== null && !busy && (sync.status === 'error' || sync.status === 'offline')
  useEffect(() => {
    if (!done && !failed) return
    const id = setTimeout(() => setPressedAt(null), 3000)
    return () => clearTimeout(id)
  }, [done, failed])
  return (
    <button
      className={`${className} sync-now${busy ? ' is-busy' : ''}${done ? ' is-done' : ''}${failed ? ' is-failed' : ''}`}
      disabled={busy}
      aria-live="polite"
      onClick={() => {
        setPressedAt(Date.now())
        void sync.syncNow()
      }}
    >
      {busy ? (
        <>
          <span className="spinner" aria-hidden="true" /> {t('sync.syncing')}
        </>
      ) : done ? (
        `✓ ${t('drive.syncDone')}`
      ) : failed ? (
        `⚠️ ${t('drive.syncFailed')}`
      ) : (
        `🔄 ${t('account.syncNow')}`
      )}
    </button>
  )
}
