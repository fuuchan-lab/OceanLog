/**
 * Google ログインのトークンを待つ処理。ブラウザ機能に依存しない。
 *
 * ログイン用のポップアップが閉じた、という通知（popup_closed）は、スマホのブラウザなどで、
 * ログインが成功していても、トークンが届くより少し先に来ることがある。そのため、通知を受けてすぐ
 * 失敗にせず、猶予の間にトークンが届けば成功として扱う。猶予を過ぎても届かなければ失敗にする。
 */
export interface TokenWaiter<T> {
  promise: Promise<T>
  /** トークンが届いた */
  resolve: (value: T) => void
  /** 失敗の通知（Google の error_callback の type や、callback の error）。popup_closed だけは猶予を置く */
  fail: (type: string) => void
}

export interface TokenWaiterOptions {
  /** popup_closed の通知を受けてから、トークンを待つ時間 (ms) */
  graceMs: number
  /** 何も起きないまま待ち続けない（ログイン画面を放置した時など）ための、全体の待ち時間 (ms) */
  timeoutMs: number
}

export function createTokenWaiter<T>({ graceMs, timeoutMs }: TokenWaiterOptions): TokenWaiter<T> {
  let done = false
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  let overallTimer: ReturnType<typeof setTimeout> | undefined
  let settle!: { resolve: (v: T) => void; reject: (e: Error) => void }
  const promise = new Promise<T>((resolve, reject) => {
    settle = { resolve, reject }
  })

  const finish = () => {
    done = true
    clearTimeout(graceTimer)
    clearTimeout(overallTimer)
  }
  const rejectWith = (message: string) => {
    if (done) return
    finish()
    settle.reject(new Error(message))
  }

  overallTimer = setTimeout(() => rejectWith('login_timeout'), timeoutMs)

  return {
    promise,
    resolve: (value) => {
      if (done) return
      finish()
      settle.resolve(value)
    },
    fail: (type) => {
      if (done) return
      if (type === 'popup_closed') {
        // 猶予の間にトークンが届けば、resolve が勝つ。すでに猶予中なら、時間を延ばさない
        graceTimer ??= setTimeout(() => rejectWith('popup_closed'), graceMs)
        return
      }
      rejectWith(type)
    },
  }
}
