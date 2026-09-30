import { useEffect, useState } from 'react'
import { formatPosition, type LatLon } from '../geo.ts'
import { useI18n } from '../i18n/useI18n.ts'
import { MARK_ICONS, MARK_KINDS, type MarkKind } from '../types.ts'

export interface MarkDraft {
  name: string
  note: string
  kind: MarkKind
  lat: number
  lon: number
}

interface Props {
  initial: MarkDraft
  title: string
  /** 位置を選び直せる候補（現在地・地図の中心） */
  positions?: { label: string; at: LatLon }[]
  onSave: (draft: MarkDraft) => void
  onDelete?: () => void
  onClose: () => void
}

/** 地点の登録・編集 */
export function MarkForm({ initial, title, positions, onSave, onDelete, onClose }: Props) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(initial)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mark-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          onSave({ ...draft, name: draft.name.trim() || t('mark.defaultName') })
        }}
      >
        <div className="row">
          <h2 id="mark-title">{title}</h2>
          <button type="button" className="link" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <div className="kinds" role="radiogroup" aria-label={t('mark.kind')}>
          {MARK_KINDS.map((k) => (
            <button
              type="button"
              key={k}
              role="radio"
              aria-checked={draft.kind === k}
              className={`kind${draft.kind === k ? ' on' : ''}`}
              onClick={() => setDraft({ ...draft, kind: k })}
            >
              <span aria-hidden="true">{MARK_ICONS[k]}</span>
              <span className="small">{t(`kind.${k}`)}</span>
            </button>
          ))}
        </div>
        <label>
          {t('mark.name')}
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t('mark.defaultName')} />
        </label>
        <label>
          {t('mark.note')}
          <textarea rows={3} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
        </label>
        <p className="muted small">
          {t('mark.position')}: {formatPosition(draft)}
        </p>
        {positions && positions.length > 1 && (
          <div className="seg">
            {positions.map((p) => (
              <button
                type="button"
                key={p.label}
                className={p.at.lat === draft.lat && p.at.lon === draft.lon ? 'on' : ''}
                onClick={() => setDraft({ ...draft, lat: p.at.lat, lon: p.at.lon })}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        <button type="submit" className="primary">
          {t('common.save')}
        </button>
        {onDelete && (
          <button type="button" className="danger-btn" onClick={onDelete}>
            {t('common.delete')}
          </button>
        )}
      </form>
    </div>
  )
}
