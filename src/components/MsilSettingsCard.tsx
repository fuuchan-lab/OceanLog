import { useState } from 'react'
import { newId } from '../device.ts'
import { useI18n } from '../i18n/useI18n.ts'
import { checkMsil, customMsilLayers, isMsilUrl, MSIL_HOWTO, MSIL_PORTAL, MSIL_PRESETS, setMsilLayerOn, type MsilSettings } from '../msil.ts'

/**
 * 海しる（海上保安庁）の設定。利用登録の手順の案内・自分のキー・地図に重ねる項目
 */
export function MsilSettingsCard({ msil, onChange, signedIn }: { msil: MsilSettings; onChange: (m: MsilSettings) => void; signedIn: boolean }) {
  const { t } = useI18n()
  const [key, setKey] = useState(msil.key)
  const [showKey, setShowKey] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [saved, setSaved] = useState(false)
  // 保存した後の、海しるにつながるかの確認
  const [check, setCheck] = useState<'ok' | 'failed' | 'offline' | 'checking' | null>(null)
  // 手順は、キーが入っていない時だけ最初から開く（保存した時に閉じて画面がずれないよう、開閉は利用者に任せる）
  const [stepsOpen] = useState(!msil.key)
  // 別の端末で入れたキーをドライブから読み込んだ時は、入力欄も合わせる
  const [keyFrom, setKeyFrom] = useState(msil.key)
  if (keyFrom !== msil.key) {
    setKeyFrom(msil.key)
    setKey(msil.key)
  }
  const dirty = key.trim() !== msil.key

  const presets = MSIL_PRESETS.map((p) => ({ id: p.id, name: t(p.name), url: p.url }))

  const verify = async (k: string) => {
    if (!k) return setCheck(null)
    setCheck('checking')
    // 等深線の画像が1枚取れるかで確かめる（どの項目でもキーは同じ）
    setCheck(await checkMsil(MSIL_PRESETS[0].url, k))
  }

  return (
    <section className="card">
      <h2>{t('msil.title')}</h2>
      <p className="muted small">{t('msil.lead')}</p>
      <details className="details" open={stepsOpen}>
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
            setCheck(null)
          }}
        />
      </label>
      <label className="check small">
        <input type="checkbox" checked={showKey} onChange={(e) => setShowKey(e.target.checked)} />
        {t('msil.showKey')}
      </label>
      <div className="row gap">
        <button
          className={dirty ? 'primary' : 'secondary'}
          disabled={!dirty}
          onClick={() => {
            const k = key.trim()
            // はじめてキーを入れた時は、等深線を表示する（何も表示しないと、保存できたか分かりにくいため）
            onChange(msil.enabled.length === 0 && k ? setMsilLayerOn({ ...msil, key: k }, presets[0], true) : { ...msil, key: k })
            setKey(k)
            setSaved(true)
            navigator.vibrate?.(30)
            void verify(k)
          }}
        >
          {dirty || !msil.key ? t('common.save') : `✓ ${t('msil.savedButton')}`}
        </button>
        {msil.key && (
          <button
            className="link danger"
            onClick={() => {
              setKey('')
              setSaved(false)
              setCheck(null)
              onChange({ ...msil, key: '', enabled: [] })
            }}
          >
            {t('msil.removeKey')}
          </button>
        )}
      </div>
      {/* いまの状態: キーが保存されているか（保存した時は、ドライブへの保存と海しるにつながるかも示す） */}
      <div className={msil.key ? 'ok' : 'banner banner-caution'} role="status" aria-live="polite">
        {msil.key ? (
          <>
            ✅ {saved ? t('msil.saved') : t('msil.keySet', { tail: msil.key.slice(-4) })}
            {saved && signedIn && <> {t('msil.savedDrive')}</>}
            {check === 'checking' && <div>⏳ {t('msil.checking')}</div>}
            {check === 'ok' && <div>✅ {t('msil.checkOk')}</div>}
            {check === 'failed' && <div className="error">⚠️ {t('msil.checkBadKey')}</div>}
            {check === 'offline' && <div>⚠️ {t('msil.checkNetwork')}</div>}
          </>
        ) : (
          t('msil.noKey')
        )}
      </div>
      <p className="muted small">{t('msil.keyLocal')}</p>

      <h3>{t('msil.layers')}</h3>
      <p className="muted small">{t('msil.presetsLead')}</p>
      {presets.map((l) => (
        <label key={l.id} className="check">
          <input type="checkbox" checked={msil.enabled.includes(l.id)} onChange={(e) => onChange(setMsilLayerOn(msil, l, e.target.checked))} />
          {l.name}
        </label>
      ))}
      <p className="muted small">{t('msil.presetsNote')}</p>
      <h3>{t('msil.customLayers')}</h3>
      <p className="muted small">{t('msil.layersLead')}</p>
      <ul className="log-list">
        {customMsilLayers(msil).map((l) => (
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
