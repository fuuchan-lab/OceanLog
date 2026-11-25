import { useEffect, useRef, useState } from 'react'
import { ADSENSE_CLIENT, ADSENSE_SLOT, isAndroidApp } from '../adsense.ts'

declare global {
  interface Window {
    adsbygoogle?: unknown[]
  }
}

const enabled = ADSENSE_CLIENT !== '' && ADSENSE_SLOT !== '' && !isAndroidApp()

/** この時間たっても広告が届かなければ、あきらめて枠ごと消す */
const GIVE_UP_MS = 15_000

/**
 * ナビの真上に置く AdSense の広告。
 * ID が入っていない間と、Android アプリ（TWA）の中では何も表示しない。
 * 広告を読み出せない時（スクリプトが読めない＝広告ブロッカー・オフライン、配信なし "unfilled"、
 * 一定時間たっても届かない、push の例外）は、空白の枠を残さず、広告の DOM ごと取り除く。
 */
export function AdBanner() {
  const requested = useRef(false)
  const insRef = useRef<HTMLModElement>(null)
  const [removed, setRemoved] = useState(false)

  useEffect(() => {
    if (!enabled) return
    const giveUp = () => setRemoved(true)
    if (!requested.current) {
      requested.current = true
      const script = document.createElement('script')
      script.async = true
      script.crossOrigin = 'anonymous'
      script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADSENSE_CLIENT)}`
      script.onerror = giveUp
      document.head.append(script)
      try {
        ;(window.adsbygoogle = window.adsbygoogle || []).push({})
      } catch (error) {
        console.error('[ads]', error)
        giveUp()
      }
    }

    const ins = insRef.current
    if (!ins) return
    let timer: number | undefined
    const check = () => {
      const status = ins.getAttribute('data-ad-status')
      if (status === 'unfilled') giveUp()
      else if (status === 'filled') window.clearTimeout(timer)
    }
    const observer = new MutationObserver(check)
    observer.observe(ins, { attributes: true, attributeFilter: ['data-ad-status'] })
    timer = window.setTimeout(() => {
      if (ins.getAttribute('data-ad-status') !== 'filled') giveUp()
    }, GIVE_UP_MS)
    check()
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [])

  if (!enabled || removed) return null
  return (
    <div className="ad-banner">
      <ins
        ref={insRef}
        className="adsbygoogle"
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={ADSENSE_SLOT}
        data-ad-format="horizontal"
      />
    </div>
  )
}
