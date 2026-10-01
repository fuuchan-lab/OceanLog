import { useState } from 'react'
import { newId } from '../device.ts'
import { checkedToday, checklistItems, localDay, ZONES, type EquipmentSettings } from '../equipment.ts'
import { useI18n } from '../i18n/useI18n.ts'
import type { Profile } from '../profile.ts'

interface Props {
  profile: Profile
  onChange: (update: (p: Profile) => Profile) => void
  onBack: () => void
}

/** 法定備品のチェックリスト。出港前に、備品が揃っているかを1つずつ確かめる */
export function EquipmentPage({ profile, onChange, onBack }: Props) {
  const { t, lang } = useI18n()
  const eq = profile.equipment
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState('')
  const [qty, setQty] = useState('')
  const now = Date.now()
  const checked = checkedToday(eq, now)
  const items = checklistItems(eq, profile.boat.type, profile.boat.daylightOnly, lang, editing)
  const done = items.filter((i) => checked.includes(i.id) && !eq.hidden.includes(i.id)).length
  const total = items.filter((i) => !eq.hidden.includes(i.id)).length

  const update = (f: (e: EquipmentSettings) => EquipmentSettings) => onChange((p) => ({ ...p, equipment: f(p.equipment) }))
  const toggle = (id: string, on: boolean) =>
    update((e) => {
      const cur = checkedToday(e, Date.now())
      return { ...e, checked: on ? [...cur.filter((x) => x !== id), id] : cur.filter((x) => x !== id), checkedDay: localDay(Date.now()) }
    })

  return (
    <>
      <button className="back-button" onClick={onBack}>
        ← {t('log.back')}
      </button>
      <section className="card">
        <h2>✅ {t('equip.title')}</h2>
        <p className="muted small">{t('equip.lead')}</p>
        <p className="banner banner-caution small">{t('equip.official')}</p>

        <h3>{t('equip.zone')}</h3>
        {profile.boat.type === 'pwc' ? (
          <p className="small">{t('equip.pwc')}</p>
        ) : (
          <div className="seg">
            {ZONES.map((z) => (
              <button key={z} className={eq.zone === z ? 'on' : ''} onClick={() => update((e) => ({ ...e, zone: z }))}>
                {t(`equip.zone.${z}`)}
              </button>
            ))}
          </div>
        )}
        {profile.boat.type !== 'pwc' && <p className="muted small">{t(`equip.zoneHint.${eq.zone}`)}</p>}

        <div className={done === total && total > 0 ? 'ok' : 'banner banner-caution'} role="status">
          {done === total && total > 0 ? `✅ ${t('equip.allDone')}` : t('equip.progress', { done, total })}
        </div>

        <ul className="equip-list">
          {items.map((i) => {
            const hidden = eq.hidden.includes(i.id)
            return (
              <li key={i.id} className={hidden ? 'equip-hidden' : checked.includes(i.id) ? 'equip-done' : ''}>
                {editing ? (
                  <div className="equip-row">
                    <span>
                      <b>{i.label}</b> <span className="muted">{i.qty}</span>
                    </span>
                    {i.custom ? (
                      <button className="link danger" onClick={() => update((e) => ({ ...e, custom: e.custom.filter((c) => c.id !== i.id) }))}>
                        {t('common.delete')}
                      </button>
                    ) : (
                      <button
                        className="link"
                        onClick={() => update((e) => ({ ...e, hidden: hidden ? e.hidden.filter((x) => x !== i.id) : [...e.hidden, i.id] }))}
                      >
                        {hidden ? t('equip.restore') : t('equip.hide')}
                      </button>
                    )}
                  </div>
                ) : (
                  <label className="check equip-check">
                    <input type="checkbox" checked={checked.includes(i.id)} onChange={(e) => toggle(i.id, e.target.checked)} />
                    <span>
                      <b>{i.label}</b> <span className="equip-qty">{i.qty}</span>
                      {i.note && (
                        <>
                          <br />
                          <span className="muted small">{i.note}</span>
                        </>
                      )}
                    </span>
                  </label>
                )}
              </li>
            )
          })}
        </ul>

        {editing && (
          <>
            <div className="grid2">
              <label>
                {t('equip.itemName')}
                <input value={label} placeholder={t('equip.itemPlaceholder')} onChange={(e) => setLabel(e.target.value)} />
              </label>
              <label>
                {t('equip.qty')}
                <input value={qty} placeholder="1" onChange={(e) => setQty(e.target.value)} />
              </label>
            </div>
            <button
              className="secondary"
              disabled={!label.trim()}
              onClick={() => {
                update((e) => ({ ...e, custom: [...e.custom, { id: newId(), label: label.trim(), qty: qty.trim() }] }))
                setLabel('')
                setQty('')
              }}
            >
              ＋ {t('equip.add')}
            </button>
          </>
        )}

        <div className="row gap">
          {!editing && checked.length > 0 && (
            <button className="secondary" onClick={() => update((e) => ({ ...e, checked: [], checkedDay: localDay(Date.now()) }))}>
              {t('equip.clear')}
            </button>
          )}
          <button className={editing ? 'primary' : 'secondary'} onClick={() => setEditing(!editing)}>
            {editing ? t('equip.editDone') : `✏️ ${t('equip.edit')}`}
          </button>
        </div>
        <p className="muted small">{t('equip.daily')}</p>
        <p className="muted small">
          {t('equip.source')}{' '}
          <a href="https://jci.go.jp/inspection/houteibihin.html" target="_blank" rel="noopener">
            {t('equip.jci')}
          </a>
        </p>
      </section>
    </>
  )
}
