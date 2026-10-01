/**
 * Googleログイン（Google Identity Services のトークン方式）と Google ドライブ操作。
 * CapLog と同じ方式: ログイン状態とアクセストークンを localStorage に保存し、
 * 再訪問時は有効なトークンを再利用、期限切れなら無言で再取得を試みる。
 */

import { createTokenWaiter } from './tokenWaiter.ts'

export const driveConfig = {
  // 保存先のフォルダー名。言語に関わらず同じ。同じアカウントでログインした全端末が、このフォルダーに集約する
  folderName: 'OceanLog',
  legacyFolderNames: [] as string[],
  // 公開されるクライアントID（秘密ではない）。当面は LeadLog と同じ OAuth クライアント（承認済みの生成元に
  // https://fuuchan-lab.github.io が登録済み。https://oceanlog.doitmyself.net は追加が必要）を使う。OceanLog 専用のクライアントを作ったら、
  // .env.local（または GitHub Actions の変数）の VITE_GOOGLE_CLIENT_ID で差し替える。
  clientId:
    (import.meta.env?.VITE_GOOGLE_CLIENT_ID as string | undefined) ||
    '942895331241-pjiplv9bi1but307aia3ansjp2d71ro0.apps.googleusercontent.com',
  scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile',
}

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'

const TOKEN_KEY = 'oceanlog-drive-token'
const SESSION_KEY = 'oceanlog-drive-session'

let accessToken: string | null = null
let folderIdCache: string | null = null

export function isDriveConfigured(): boolean {
  return driveConfig.clientId.trim() !== '' && driveConfig.clientId.trim() !== 'YOUR_GOOGLE_CLIENT_ID'
}

export function hasSession(): boolean {
  try {
    return localStorage.getItem(SESSION_KEY) === '1'
  } catch {
    return false
  }
}

export function setSession(active: boolean) {
  try {
    if (active) localStorage.setItem(SESSION_KEY, '1')
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    // 保存できなくても、その回のログインは有効
  }
}

function storeToken(token: string, expiresInSeconds: string | number) {
  const ms = Number(expiresInSeconds) > 0 ? Number(expiresInSeconds) * 1000 : 55 * 60_000
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ accessToken: token, expiresAt: Date.now() + ms }))
  } catch {
    // トークンはメモリ上でも使える
  }
}

/** 前回保存した有効なトークンがあればメモリに戻して true を返す */
export function restoreStoredToken(): boolean {
  try {
    const raw = localStorage.getItem(TOKEN_KEY)
    if (!raw) return false
    const parsed = JSON.parse(raw) as { accessToken?: string; expiresAt?: number }
    if (!parsed.accessToken || !Number.isFinite(parsed.expiresAt)) return false
    if ((parsed.expiresAt as number) <= Date.now() + 30_000) return false
    accessToken = parsed.accessToken
    return true
  } catch {
    return false
  }
}

export function clearToken() {
  accessToken = null
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // 無視
  }
}

function waitForGis(timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      if (typeof google !== 'undefined' && google.accounts?.oauth2) resolve()
      else if (Date.now() - start > timeoutMs) reject(new Error('google-identity-not-loaded'))
      else setTimeout(tick, 100)
    }
    tick()
  })
}

/** ポップアップが閉じた通知のあと、トークンが届くのを待つ時間 */
const LOGIN_GRACE_MS = 8000
/** ログイン画面を開いたまま放置された時に、待ち続けない時間 */
const LOGIN_TIMEOUT_MS = 3 * 60_000

/**
 * アクセストークンを取得する。
 * 初回（トークンなし）は consent、以降は無言の再取得 ('')。アカウント切替は select_account。
 */
export async function getAccessToken(interactive = true, promptOverride: string | null = null): Promise<string> {
  await waitForGis()
  // ポップアップが閉じた通知は、ログインが成功していても、スマホなどでトークンより先に届くことがある。
  // すぐ失敗にせず、猶予の間にトークンが届けば成功にする（詳しくは tokenWaiter.ts）
  const waiter = createTokenWaiter<string>({ graceMs: LOGIN_GRACE_MS, timeoutMs: LOGIN_TIMEOUT_MS })
  const client = google.accounts.oauth2.initTokenClient({
    client_id: driveConfig.clientId,
    scope: driveConfig.scope,
    callback: (res) => {
      if (res.error) {
        waiter.fail(res.error)
        return
      }
      // ログインの確認画面では、項目ごとにチェックを外して許可できる。ドライブへのアクセスが外されていたら失敗にする
      if (!google.accounts.oauth2.hasGrantedAllScopes(res, DRIVE_SCOPE)) {
        waiter.fail('drive_scope_not_granted')
        return
      }
      accessToken = res.access_token
      storeToken(res.access_token, res.expires_in)
      waiter.resolve(res.access_token)
    },
    // ログイン画面を閉じた・開けなかった場合など。これがないと処理が終わらず「接続中」のままになる
    error_callback: (err) => waiter.fail(err.type),
  })
  client.requestAccessToken({ prompt: promptOverride ?? (interactive && !accessToken ? 'consent' : '') })
  return waiter.promise
}

async function driveFetch(url: string, init: RequestInit = {}, allowRetry = true): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${accessToken}` },
  })
  if (res.status === 401 && allowRetry) {
    await getAccessToken(false)
    return driveFetch(url, init, false)
  }
  if (!res.ok) throw new Error(`drive-request-failed-${res.status}${await errorReason(res)}`)
  return res
}

/**
 * Google の API のエラー応答から、原因（例: accessNotConfigured = Drive API が有効になっていない、
 * insufficientPermissions = ドライブへのアクセスが許可されていない）を取り出す。画面の「詳細」で原因が分かるように
 */
async function errorReason(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { errors?: { reason?: string }[]; status?: string; message?: string } }
    const reason = data.error?.errors?.[0]?.reason ?? data.error?.status
    const message = data.error?.message?.split('\n')[0]
    return reason ? ` ${reason}${message ? `: ${message.slice(0, 160)}` : ''}` : ''
  } catch {
    return ''
  }
}

const escapeQuery = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

/**
 * 指定の名前のフォルダーを探して ID を返す（なければ null）。
 * 複数の端末が同時に初めてログインして、同じ名前のフォルダーが2つできた場合も、
 * 全端末が同じもの（いちばん古いもの）を使うように、作成日時の順で選ぶ。
 */
async function findFolder(name: string): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${escapeQuery(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  )
  const list = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&orderBy=createdTime&spaces=drive`,
  )
  const { files } = (await list.json()) as { files?: { id: string }[] }
  return files && files.length > 0 ? files[0].id : null
}

/** アプリ用フォルダー(OceanLog)の ID を返す。なければ作る */
export async function ensureFolder(): Promise<string> {
  if (folderIdCache) return folderIdCache

  const current = await findFolder(driveConfig.folderName)
  if (current) return (folderIdCache = current)

  for (const legacyName of driveConfig.legacyFolderNames) {
    const legacy = await findFolder(legacyName)
    if (!legacy) continue
    try {
      await driveFetch(`https://www.googleapis.com/drive/v3/files/${legacy}?fields=id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: driveConfig.folderName }),
      })
    } catch (e) {
      // 名前を変えられなくても、旧フォルダーのまま使い続ける（同期は止めない）
      console.error('[folder-rename]', e)
    }
    return (folderIdCache = legacy)
  }

  const created = await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: driveConfig.folderName, mimeType: 'application/vnd.google-apps.folder' }),
  })
  return (folderIdCache = ((await created.json()) as { id: string }).id)
}

export interface UserInfo {
  email: string | null
  name: string | null
  picture: string | null
}

export async function fetchUserInfo(): Promise<UserInfo> {
  try {
    const res = await driveFetch('https://www.googleapis.com/oauth2/v2/userinfo')
    const data = (await res.json()) as { email?: string; name?: string; picture?: string }
    return { email: data.email ?? null, name: data.name ?? null, picture: data.picture ?? null }
  } catch {
    return { email: null, name: null, picture: null }
  }
}

/** トークンを失効させ、保存済みのログイン状態を消す */
export function signOutDrive() {
  const token = accessToken
  setSession(false)
  folderIdCache = null
  clearToken()
  if (token && typeof google !== 'undefined' && google.accounts?.oauth2) {
    google.accounts.oauth2.revoke(token, () => {})
  }
}

export interface DriveFile {
  id: string
  name: string
  modifiedTime: string
  createdTime: string
}

/**
 * 指定した親フォルダーの中に、名前のフォルダーを探す。無ければ作る。
 * 書き出したファイル（GPX など）を、1つのフォルダーにまとめるのに使う
 */
export async function ensureSubfolder(parentId: string, name: string): Promise<string> {
  const q = encodeURIComponent(
    `name='${escapeQuery(name)}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`,
  )
  const list = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&orderBy=createdTime&spaces=drive`,
  )
  const { files } = (await list.json()) as { files?: { id: string }[] }
  if (files && files.length > 0) return files[0].id
  const created = await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  })
  return ((await created.json()) as { id: string }).id
}

/** フォルダー内のファイルを全件取得する */
export async function listFolderFiles(folderId: string): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`)
  const files: DriveFile[] = []
  let pageToken = ''
  do {
    const url =
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,modifiedTime,createdTime)` +
      `&pageSize=1000&spaces=drive${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
    const data = (await (await driveFetch(url)).json()) as { files?: DriveFile[]; nextPageToken?: string }
    files.push(...(data.files ?? []))
    pageToken = data.nextPageToken ?? ''
  } while (pageToken)
  return files
}

export async function downloadText(fileId: string): Promise<string> {
  return (await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`)).text()
}

export interface UploadParams {
  /** 指定すると既存ファイルの内容を更新する */
  id?: string
  name: string
  mimeType: string
  blob: Blob
  parentId: string
}

export async function uploadFile({ id, name, mimeType, blob, parentId }: UploadParams): Promise<{ id: string; modifiedTime: string }> {
  const metadata = id ? { name } : { name, parents: [parentId] }
  const boundary = `oceanlog-${Date.now()}`
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ])
  const base = 'https://www.googleapis.com/upload/drive/v3/files'
  const url = `${id ? `${base}/${id}` : base}?uploadType=multipart&fields=id,modifiedTime`
  const res = await driveFetch(url, {
    method: id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  return (await res.json()) as { id: string; modifiedTime: string }
}

export async function deleteFile(fileId: string) {
  await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: 'DELETE' })
}

export async function downloadBlob(fileId: string): Promise<Blob> {
  return (await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`)).blob()
}
