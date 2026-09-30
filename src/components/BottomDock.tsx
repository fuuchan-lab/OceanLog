import { useEffect, useRef, type ReactNode } from 'react'
import { useI18n } from '../i18n/useI18n.ts'

export type Tab = 'chart' | 'sea' | 'tide' | 'docs' | 'settings'

export const TABS: Tab[] = ['chart', 'sea', 'tide', 'docs', 'settings']

// アイコンは currentColor で塗る（LeadLog と同じ作り）。抜き部分は .cut（ドックの背景色）
const ICONS: Record<Tab, ReactNode> = {
  // 海図: 羅針盤
  chart: (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9.6" fill="currentColor" />
      <circle className="cut" cx="12" cy="12" r="7.4" />
      <path d="M12 4.6 14.2 12H9.8z" fill="currentColor" />
      <path d="M12 19.4 9.8 12h4.4z" fill="currentColor" opacity=".45" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    </svg>
  ),
  // 波・気象: 雲と波
  sea: (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 12.2a4 4 0 0 1 .5-8 5 5 0 0 1 9.3 1.6A3.3 3.3 0 0 1 17 12.2z" fill="currentColor" opacity=".6" />
      <path
        d="M2.5 16.2c1.6 0 1.6-1.3 3.2-1.3s1.6 1.3 3.2 1.3 1.6-1.3 3.1-1.3 1.6 1.3 3.2 1.3 1.6-1.3 3.2-1.3 1.6 1.3 3.1 1.3M2.5 20.2c1.6 0 1.6-1.3 3.2-1.3s1.6 1.3 3.2 1.3 1.6-1.3 3.1-1.3 1.6 1.3 3.2 1.3 1.6-1.3 3.2-1.3 1.6 1.3 3.1 1.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  ),
  // 日の出・潮: 水平線の太陽と潮の曲線
  tide: (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6.5 12.5a5.5 5.5 0 0 1 11 0z" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M12 2.8v2.4M4.6 5.9l1.7 1.7M19.4 5.9l-1.7 1.7M2.5 12.5h19" />
      </g>
      <path
        d="M2.5 18.5c2.4 0 2.4-3 4.8-3s2.4 3 4.7 3 2.4-3 4.8-3 2.3 3 4.7 3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        opacity=".7"
      />
    </svg>
  ),
  // 資格・船舶: 免許証のカード
  docs: (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.2" y="4.6" width="19.6" height="14.8" rx="2.4" fill="currentColor" />
      <circle className="cut" cx="8" cy="10.4" r="2.3" />
      <path className="cut" d="M4.6 16.4c.5-2 1.8-3 3.4-3s2.9 1 3.4 3z" />
      <rect className="cut" x="13.2" y="8.6" width="6" height="1.6" rx=".8" />
      <rect className="cut" x="13.2" y="11.8" width="4.4" height="1.6" rx=".8" />
    </svg>
  ),
  settings: (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      <g fill="currentColor">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <rect key={deg} x="10.2" y="1.6" width="3.6" height="5.4" rx="1.1" transform={`rotate(${deg} 12 12)`} />
        ))}
        <circle cx="12" cy="12" r="7.4" />
      </g>
      <circle className="cut" cx="12" cy="12" r="3.2" />
    </svg>
  ),
}

interface Props {
  tab: Tab
  onTab: (tab: Tab) => void
  /** 航跡を記録中なら、海図のボタンに赤い印を付ける */
  recording: boolean
  /** 注意報・警報などがあれば、波・気象のボタンに「！」を付ける */
  alert: boolean
  /** 危険潮位・日没（航行限定の船）が近ければ、日の出・潮のボタンに「！」を付ける */
  tideAlert: boolean
  /** 免許の更新・船舶検査が1か月以内なら、資格・船舶のボタンに「！」を付ける */
  docsAlert: boolean
}

/** 画面の下に固定するメニュー（LeadLog と同じ形） */
export function BottomDock({ tab, onTab, recording, alert, tideAlert, docsAlert }: Props) {
  const { t } = useI18n()
  const ref = useRef<HTMLDivElement>(null)

  // ドックの高さを --dock-h に入れる（本体の下の余白に使い、内容がドックに隠れないようにする）
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const sync = () => document.documentElement.style.setProperty('--dock-h', `${el.offsetHeight}px`)
    sync()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="bottom-dock" ref={ref}>
      <nav className="bottom-nav" aria-label={t('nav.menu')}>
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            className={`nav-item${tab === id ? ' active' : ''}`}
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => onTab(id)}
          >
            <span className="nav-icon-wrap">
              {ICONS[id]}
              {id === 'chart' && recording && <span className="nav-dot nav-dot-rec" />}
              {((id === 'sea' && alert) || (id === 'tide' && tideAlert)) && (
                <span className="nav-bang" aria-label={t('nav.alert')}>
                  !
                </span>
              )}
              {id === 'docs' && docsAlert && (
                <span className="nav-bang" aria-label={t('renew.badge')}>
                  !
                </span>
              )}
            </span>
            <span>{t(`nav.${id}`)}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
