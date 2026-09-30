import { useCallback, useEffect, useRef, useState } from 'react'
import { describeError, isNetworkError } from '../errors.ts'
import type { Vars } from '../i18n/context.ts'
import type { MessageKey } from '../i18n/messages.ts'
import { markAllUnsynced } from '../db.ts'
import {
  clearToken,
  driveConfig,
  ensureFolder,
  fetchUserInfo,
  getAccessToken,
  hasSession,
  isDriveConfigured,
  setSession,
  signOutDrive,
  restoreStoredToken,
} from '../drive.ts'

export interface DriveAccount {
  email: string | null
  name: string | null
  avatarUrl: string | null
  folderId: string
}

/** 画面に出すお知らせ。文言は表示時に言語に合わせて作る */
export interface Notice {
  kind: 'ok' | 'error'
  key: MessageKey
  vars?: Vars
  /** 原因の切り分け用の詳細（スマホなど、開発者ツールを使えない環境で分かるように画面に出す） */
  detail?: string
}

// 開発時の StrictMode で復元処理が2回走らないようにする
let restoreStarted = false

const ACCOUNT_KEY = 'oceanlog-drive-account'

/** 前回ログインできた時のアカウント情報。電波がない状態で開いた時に、ログイン中として表示するために保存しておく */
function loadCachedAccount(): DriveAccount | null {
  try {
    const raw = localStorage.getItem(ACCOUNT_KEY)
    return raw ? (JSON.parse(raw) as DriveAccount) : null
  } catch {
    return null
  }
}

function saveCachedAccount(account: DriveAccount | null) {
  try {
    if (account) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account))
    else localStorage.removeItem(ACCOUNT_KEY)
  } catch {
    // 保存できなくても、ログイン自体には影響しない
  }
}

export function useGoogleAuth() {
  const [account, setAccount] = useState<DriveAccount | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  /** 電波がなくて、前回のログイン状態を保ったまま開いている（ネットが戻ったら再接続する） */
  const offlineRestored = useRef(false)

  const say = useCallback((n: Notice) => {
    setNotice(n)
    // 成功のお知らせだけ自動で消す。失敗は、ログイン画面から戻ってきた時にも読めるよう、閉じるまで残す
    if (n.kind === 'ok') setTimeout(() => setNotice((cur) => (cur === n ? null : cur)), 8000)
  }, [])

  /** ログインしてドライブのフォルダーを確保する。成功したら true */
  const connect = useCallback(
    async (prompt: string | null = null, restoring = false): Promise<boolean> => {
      if (!isDriveConfigured()) {
        say({ kind: 'error', key: 'notice.noClientId' })
        return false
      }
      setConnecting(true)
      try {
        if (restoring) {
          // 前回のトークンが有効ならそれを使う（サードパーティCookieを止めるブラウザでは無言の再取得が失敗するため）
          if (!restoreStoredToken()) await getAccessToken(false)
        } else {
          await getAccessToken(true, prompt)
        }
        const folderId = await ensureFolder()
        const info = await fetchUserInfo()
        setSession(true)
        const next = { email: info.email, name: info.name, avatarUrl: info.picture, folderId }
        saveCachedAccount(next)
        offlineRestored.current = false
        setAccount(next)
        return true
      } catch (e) {
        // 電波がないだけなら、ログインを取り消さない。前回のアカウントのまま開き、ネットが戻ったら再接続する
        const cached = loadCachedAccount()
        if (restoring && cached && (isNetworkError(e) || navigator.onLine === false)) {
          offlineRestored.current = true
          setAccount(cached)
          return true
        }
        setAccount(null)
        setSession(false)
        clearToken()
        if (!restoring) {
          console.error('[login]', e)
          // ログイン画面を閉じた・完了しなかった場合は、専用の文言にする（原因の詳細も付ける）
          const message = e instanceof Error ? e.message : ''
          const incomplete = message === 'popup_closed' || message === 'login_timeout'
          // ドライブへのアクセスが許可されていない（確認画面でチェックを外した・API が有効でない）場合は、専用の案内にする
          const noDrive = message === 'drive_scope_not_granted' || /insufficient(Permissions|Scopes)|ACCESS_TOKEN_SCOPE_INSUFFICIENT/.test(message)
          const apiOff = /accessNotConfigured|SERVICE_DISABLED/.test(message)
          const key = noDrive ? 'notice.driveNotGranted' : apiOff ? 'notice.driveApiOff' : incomplete ? 'notice.loginIncomplete' : 'notice.loginFailed'
          say({ kind: 'error', key, detail: describeError(e) })
        }
        return false
      } finally {
        setConnecting(false)
      }
    },
    [say],
  )

  useEffect(() => {
    if (restoreStarted) return
    restoreStarted = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (isDriveConfigured() && hasSession()) void connect(null, true)
  }, [connect])

  // ネットが戻ったら、電波なしで開いた時のログイン状態を、本当のログイン（トークンの再取得）に切り替える
  useEffect(() => {
    const onOnline = () => {
      if (offlineRestored.current && hasSession()) void connect(null, true)
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [connect])

  const login = useCallback(async () => {
    if (await connect()) {
      say({ kind: 'ok', key: 'notice.loggedIn', vars: { folder: driveConfig.folderName } })
    }
  }, [connect, say])

  const signOut = useCallback(() => {
    signOutDrive()
    void markAllUnsynced()
    saveCachedAccount(null)
    offlineRestored.current = false
    setAccount(null)
  }, [])

  const switchAccount = useCallback(async () => {
    signOutDrive()
    void markAllUnsynced()
    saveCachedAccount(null)
    offlineRestored.current = false
    setAccount(null)
    if (await connect('select_account')) {
      say({ kind: 'ok', key: 'notice.switched' })
    }
  }, [connect, say])

  return { account, connecting, notice, dismissNotice: () => setNotice(null), login, signOut, switchAccount }
}

export type GoogleAuth = ReturnType<typeof useGoogleAuth>
