import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'
import { I18nProvider } from './i18n/I18nProvider.tsx'
import { applyTheme, loadTheme } from './theme.ts'

applyTheme(loadTheme())

/** 船の上では何日も開きっぱなしにすることがあるので、1時間ごとに新しい配信がないか確認する（LeadLog と同じ） */
registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return
    setInterval(() => {
      if (registration.installing || !navigator.onLine) return
      void registration.update()
    }, 60 * 60 * 1000)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
)
