import { useEffect, useState } from 'react'
import { LOCALES } from '../i18n/context.ts'
import { useI18n } from '../i18n/useI18n.ts'
import type { Renewal } from '../profile.ts'

const SHOWN_KEY = 'oceanlog-renewal-notified'

/** 端末の通知は、1日1回だけ出す */
function notifiedToday(): boolean {
  try {
    return localStorage.getItem(SHOWN_KEY) === new Date().toDateString()
  } catch {
    return false
  }
}

function markNotified() {
  try {
    localStorage.setItem(SHOWN_KEY, new Date().toDateString())
  } catch {
    // 次に開いた時にもう一度出るだけ
  }
}

async function showSystemNotification(title: string, body: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) await reg.showNotification(title, { body, icon: './icon-192.png', badge: './favicon-32.png', tag: 'oceanlog-renewal' })
    else new Notification(title, { body, icon: './icon-192.png' })
    markNotified()
  } catch {
    // 通知を出せない端末では、画面のお知らせだけ
  }
}

/**
 * 免許の更新・次回の船舶検査が1か月以内になったら、画面の上にお知らせを出す（端末の通知も、許可されていれば1日1回）
 */
export function RenewalNotice({ renewals, onOpen }: { renewals: Renewal[]; onOpen: () => void }) {
  const { t, lang } = useI18n()
  const [permission, setPermission] = useState(() => (typeof Notification === 'undefined' ? 'denied' : Notification.permission))
  const lines = renewals.map((r) => {
    const name = t(r.kind === 'license' ? 'renew.license' : 'renew.inspection')
    const date = new Date(`${r.date}T00:00:00`).toLocaleDateString(LOCALES[lang])
    return r.days < 0 ? t('renew.expired', { name, date }) : t('renew.banner', { name, n: r.days, date })
  })
  const text = lines.join('\n')

  useEffect(() => {
    if (text && permission === 'granted' && !notifiedToday()) void showSystemNotification(t('app.title'), text)
  }, [text, permission, t])

  if (renewals.length === 0) return null
  return (
    <div className="banner banner-caution renewal" role="alert">
      <span className="bang" aria-hidden="true">
        !
      </span>
      <div>
        {lines.map((l) => (
          <p key={l}>{l}</p>
        ))}
        <div className="row gap">
          <button className="link" onClick={onOpen}>
            {t('renew.open')}
          </button>
          {permission === 'default' && (
            <button
              className="link"
              onClick={() => void Notification.requestPermission().then((p) => setPermission(p))}
            >
              {t('renew.allowNotify')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
