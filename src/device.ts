/** この端末の識別。同じ Google アカウントで複数の端末（スマホ・タブレット）を使っても、記録が消し合わないようにする */

const DEVICE_ID_KEY = 'oceanlog-device-id'

let cachedId: string | null = null

/** 端末 ID（8文字）。初回に作ってこの端末に保存する */
export function getDeviceId(): string {
  if (cachedId) return cachedId
  try {
    const saved = localStorage.getItem(DEVICE_ID_KEY)
    if (saved && /^[a-z0-9]{8}$/.test(saved)) return (cachedId = saved)
  } catch {
    // 保存できない環境では、その回だけの ID になる
  }
  const id = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  try {
    localStorage.setItem(DEVICE_ID_KEY, id)
  } catch {
    // 無視
  }
  return (cachedId = id)
}

export function newId(): string {
  return crypto.randomUUID()
}

/**
 * パソコン（タブレット・スマホでない）か。パソコンでは「撮影する」でアプリの中のカメラを使う（LeadLog と同じ）。
 * iPad は Mac と同じ名乗りをするので、タッチ操作ができるかで見分ける
 */
export function isDesktop(): boolean {
  const ua = navigator.userAgent
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return false
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return false
  return typeof navigator.mediaDevices?.getUserMedia === 'function'
}
