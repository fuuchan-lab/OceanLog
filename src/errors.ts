/** エラーを、原因の切り分けに使える短い文字列にする（画面に「詳細」として出す用） */
export function describeError(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'code' in e && 'message' in e) {
    // GeolocationPositionError など
    return `${(e as { code: unknown }).code}: ${String((e as { message: unknown }).message)}`
  }
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e)
}

/**
 * 電波がない・通信できないことによる失敗か。
 * fetch は通信できないと TypeError になる。Google のログイン用スクリプトを読み込めない場合も同じ扱いにする。
 * 認証の失敗（401 など）やユーザーの操作による中止は含めない。
 */
export function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true
  return e instanceof Error && e.message === 'google-identity-not-loaded'
}
