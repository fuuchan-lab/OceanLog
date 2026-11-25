// 画面の下の Google AdSense 広告。ID を入れるまでは何も表示しない（場所も取らない）。
// AdSense の管理画面で発行した「パブリッシャー ID」と「広告ユニットの ID」を入れてください。
export const ADSENSE_CLIENT: string = 'ca-pub-0807456611167337' // 例: 'ca-pub-1234567890123456'
export const ADSENSE_SLOT: string = '8727228636' // 例: '1234567890'

const APP_FLAG_KEY = 'opened-from-android-app'

/**
 * Android アプリ（Google Play 版の TWA）から開かれたか。
 * TWA は起動した最初の読み込みで、referrer が android-app://パッケージ名 になる。
 * 画面を読み込み直すと referrer は消えるので、見つけたら、そのタブの間は覚えておく。
 * アプリ内では AdSense を出さない（AdSense はウェブサイト向けで、アプリ内の広告は AdMob の扱いのため）。
 */
export function isAndroidApp(): boolean {
  const fromApp = document.referrer.startsWith('android-app://')
  try {
    if (fromApp) sessionStorage.setItem(APP_FLAG_KEY, '1')
    return fromApp || sessionStorage.getItem(APP_FLAG_KEY) === '1'
  } catch {
    return fromApp
  }
}
