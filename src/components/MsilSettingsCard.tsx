import { useState } from 'react'
import { newId } from '../device.ts'
import { useI18n } from '../i18n/useI18n.ts'
import { isMsilUrl, MSIL_HOWTO, MSIL_PORTAL, type MsilSettings } from '../msil.ts'

/**
 * 海しる（海上保安庁）の設定。利用登録の手順の案内・自分のキー・地図に重ねる項目
 */
export function MsilSettingsCard({ msil, onChange }: { msil: MsilSettings; onChange: (m: MsilSettings) => void }) {
  const { t } = useI18n()
  const [key, setKey] = useState(msil.key)
  const [showKey, setShowKey] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [saved, setSaved] = useState(false)
  // 別の端末で入れたキーをドライブから読み込んだ時は、入力欄も合わせる
  const [keyFrom, setKeyFrom] = useState(msil.key)
  if (keyFrom !== msil.key) {
    setKeyFrom(msil.key)
    setKey(msil.key)
  }

  return (
    <section className="card">
      <h2>{t('msil.title')}</h2>
      <p className="muted small">{t('msil.lead')}</p>
      <details className="details" open={!msil.key}>
        <summary>{t('msil.howTo')}</summary>
        <ol className="steps small">
          <li>
            {t('msil.step1')}{' '}
            <a href={MSIL_PORTAL} target="_blank" rel="noopener">
              {MSIL_PORTAL}
            </a>
          </li>
          <li>{t('msil.step2')}</li>
          <li>
            {t('msil.step3')}{' '}
            <a href={MSIL_HOWTO} target="_blank" rel="noopener">
              {MSIL_HOWTO}
            </a>
          </li>
          <li>{t('msil.step4')}</li>
          <li>{t('msil.step5')}</li>
          <li>{t('msil.step6')}</li>
        </ol>
        <p className="muted small">{t('msil.v3Note')}</p>
        <p className="muted small">{t('msil.terms')}</p>
      </details>

      <label>
        {t('msil.key')}
        <input
          type={showKey ? 'text' : 'password'}
          value={key}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setKey(e.target.value)
            setSaved(false)
          }}
        />
      </label>
      <label className="check small">
        <input type="checkbox" checked={showKey} onChange={(e) => setShowKey(e.target.checked)} />
        {t('msil.showKey')}
      </label>
      <div className="row gap">
        <button
          className="secondary"
          onClick={() => {
            onChange({ ...msil, key: key.trim() })
            setSaved(true)
          }}
        >
          {t('common.save')}
        </button>
        {msil.key && (
          <button
            className="link danger"
            onClick={() => {
              setKey('')
              onChange({ ...msil, key: '', enabled: [] })
            }}
          >
            {t('msil.removeKey')}
          </button>
        )}
      </div>
      {saved && <p className="ok-text small">{t('msil.saved')}</p>}
      <p className="muted small">{t('msil.keyLocal')}</p>

      <h3>{t('msil.layers')}</h3>
      <p className="muted small">{t('msil.layersLead')}</p>
      <ul className="log-list">
        {msil.layers.map((l) => (
          <li key={l.id}>
            <span>
              <b>{l.name}</b>
              <br />
              <span className="small muted">{l.url}</span>
            </span>
            <button
              className="link danger"
              onClick={() => onChange({ ...msil, layers: msil.layers.filter((x) => x.id !== l.id), enabled: msil.enabled.filter((x) => x !== l.id) })}
            >
              {t('common.delete')}
            </button>
          </li>
        ))}
      </ul>
      <div className="grid2">
        <label>
          {t('msil.layerName')}
          <input value={name} placeholder={t('msil.layerNamePlaceholder')} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          {t('msil.layerUrl')}
          <input value={url} placeholder="https://…/MapServer" onChange={(e) => setUrl(e.target.value)} />
        </label>
      </div>
      {url && !isMsilUrl(url) && <p className="error small">{t('msil.urlInvalid')}</p>}
      <button
        className="secondary"
        disabled={!name.trim() || !isMsilUrl(url)}
        onClick={() => {
          const id = newId()
          onChange({ ...msil, layers: [...msil.layers, { id, name: name.trim(), url: url.trim() }], enabled: [...msil.enabled, id] })
          setName('')
          setUrl('')
        }}
      >
        ＋ {t('msil.addLayer')}
      </button>
      <p className="muted small">{t('msil.notice')}</p>
    </section>
  )
}
