import { useEffect, useState } from 'react'
import { driveConfig } from '../drive.ts'
import type { GoogleAuth } from '../hooks/useGoogleAuth.ts'
import { useOnline } from '../hooks/useOnline.ts'
import type { SyncState } from '../hooks/useSync.ts'
import { LOCALES, type TFn } from '../i18n/context.ts'
import { useI18n } from '../i18n/useI18n.ts'
import { GoogleLogo } from './GoogleLogo.tsx'
import { SyncNowButton } from './SyncFeedback.tsx'

interface Props {
  auth: GoogleAuth
  sync: SyncState
  unsyncedCount: number
}

/** アプリ名と Google ログインボタン（LeadLog と同じ形） */
export function Header({ auth, sync, unsyncedCount }: Props) {
  const { t } = useI18n()
  const { account, connecting, login } = auth
  const [accountOpen, setAccountOpen] = useState(false)
  const online = useOnline()
  const live = account !== null && !connecting && online
  const label = connecting ? t('google.connecting') : account ? t('google.connected') : t('google.login')

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src="./icon-192.png" alt="" />
          <div className="brand-text">
            <p className="eyebrow">{t('header.eyebrow')}</p>
            <h1>{t('header.title')}</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            className={`google-button${live ? ' google-button-live' : ''}${account && (sync.status === 'syncing' || sync.pending) ? ' google-button-syncing' : ''}`}
            disabled={connecting}
            onClick={() => (account ? setAccountOpen(true) : void login())}
          >
            <span
              className="google-mark"
              aria-hidden="true"
              style={account?.avatarUrl ? { backgroundImage: `url(${account.avatarUrl})` } : undefined}
            >
              {!account?.avatarUrl && <GoogleLogo />}
            </span>
            <span className={`google-text${account && !connecting ? ' connected' : ''}`}>{label}</span>
            {account && unsyncedCount > 0 && (
              <span className="sync-badge" aria-label={t('sync.badge', { n: unsyncedCount })}>
                {unsyncedCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {auth.notice && (
        <p
          className={`banner ${auth.notice.kind === 'ok' ? 'banner-none' : 'banner-warning'}`}
          role={auth.notice.kind === 'ok' ? 'status' : 'alert'}
          onClick={auth.dismissNotice}
        >
          {t(auth.notice.key, auth.notice.vars)}
          {auth.notice.detail && (
            <>
              <br />
              <span className="small">
                {t('err.detail')}: {auth.notice.detail}
              </span>
            </>
          )}
          {auth.notice.kind === 'error' && (
            <>
              <br />
              <span className="small muted">{t('notice.dismissHint')}</span>
            </>
          )}
        </p>
      )}

      {accountOpen && account && (
        <AccountModal
          auth={auth}
          sync={sync}
          unsyncedCount={unsyncedCount}
          onClose={() => setAccountOpen(false)}
        />
      )}
    </>
  )
}

export function syncText(sync: SyncState, unsyncedCount: number, t: TFn, locale: string): string {
  if (sync.status === 'syncing') return t('sync.syncing')
  if (sync.status === 'offline') return t('sync.offline', { n: unsyncedCount })
  if (sync.status === 'error') return t('sync.error', { n: unsyncedCount })
  if (unsyncedCount > 0) return t('sync.unsynced', { n: unsyncedCount })
  if (sync.lastSyncAt) {
    const time = new Date(sync.lastSyncAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    return t('sync.done', { time })
  }
  return t('sync.preparing')
}

interface ModalProps {
  auth: GoogleAuth
  sync: SyncState
  unsyncedCount: number
  onClose: () => void
}

function AccountModal({ auth, sync, unsyncedCount, onClose }: ModalProps) {
  const { t, lang } = useI18n()
  const account = auth.account
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  if (!account) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="account-title" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 id="account-title">{t('account.title')}</h2>
          <button className="link" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <p>{account.email ?? account.name ?? t('account.fallback')}</p>
        <p className="muted">{t('account.storage', { folder: driveConfig.folderName })}</p>
        <p className="muted small">{t('account.shared')}</p>
        <p className={sync.status === 'error' ? 'error' : 'muted'} role="status">
          {syncText(sync, unsyncedCount, t, LOCALES[lang])}
        </p>
        {sync.status === 'error' && sync.error && (
          <p className="muted small">
            {t('err.detail')}: {sync.error}
          </p>
        )}
        <SyncNowButton sync={sync} />
        <button
          className="secondary"
          onClick={() => {
            onClose()
            void auth.switchAccount()
          }}
        >
          {t('account.switch')}
        </button>
        <button
          className="danger-btn"
          onClick={() => {
            onClose()
            auth.signOut()
          }}
        >
          {t('account.signOut')}
        </button>
      </div>
    </div>
  )
}
