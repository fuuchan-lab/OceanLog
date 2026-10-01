import { useEffect, useRef, useState } from 'react'
import { deletePhoto, getPhoto, putPhoto } from '../db.ts'
import { newId } from '../device.ts'
import { LOCALES } from '../i18n/context.ts'
import type { MessageKey } from '../i18n/messages.ts'
import { useI18n } from '../i18n/useI18n.ts'
import { extractBoat, extractLicense } from '../scan/docExtract.ts'
import { recognize, type OcrProgress } from '../scan/ocr.ts'
import { PhotoCapture } from './PhotoCapture.tsx'
import { DOC_KINDS, RENEWAL_NOTICE_DAYS, daysUntil, type Boat, type DocKind, type DocPhoto, type Profile } from '../profile.ts'

interface Props {
  profile: Profile
  onChange: (update: (p: Profile) => Profile) => void
  signedIn: boolean
}

/** 端末に保存した写真を表示する。写真の ID が変わったら読み直す */
function usePhotoUrl(id: string | null, version = 0): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUrl(null)
      return
    }
    let objectUrl: string | null = null
    let cancelled = false
    void getPhoto(id).then((blob) => {
      if (cancelled || !blob) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [id, version])
  return url
}

function Thumb({ id, alt, onOpen }: { id: string; alt: string; onOpen: (url: string) => void }) {
  const url = usePhotoUrl(id)
  const { t } = useI18n()
  return url ? (
    <button className="thumb" onClick={() => onOpen(url)} aria-label={t('docs.open', { name: alt })}>
      <img src={url} alt={alt} />
    </button>
  ) : (
    <div className="thumb thumb-missing" title={t('docs.notYet')}>
      ⏳
    </div>
  )
}

/** 写真を画面いっぱいに表示する（いざという時に見せられるように） */
function Viewer({ url, onClose }: { url: string; onClose: () => void }) {
  const { t } = useI18n()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="viewer" onClick={onClose} role="dialog" aria-modal="true" aria-label={t('docs.viewer')}>
      <img src={url} alt="" />
      <button className="viewer-close" aria-label={t('common.close')}>
        ✕
      </button>
    </div>
  )
}

const numField = (v: string): number | null => {
  const n = Number(v.replace(',', '.'))
  return v.trim() === '' || !Number.isFinite(n) ? null : n
}

/** 入力中の値（数は文字のまま持ち、保存する時に数にする） */
interface Draft {
  type: Boat['type']
  name: string
  registration: string
  length: string
  beam: string
  depth: string
  capacity: string
  horsepower: string
  maxSpeed: string
  dangerWave: string
  daylightOnly: boolean
  licenseType: string
  licenseExpiry: string
  inspectionExpiry: string
}

type NumKey = 'length' | 'beam' | 'depth' | 'capacity' | 'horsepower' | 'maxSpeed' | 'dangerWave'
const NUM_KEYS: NumKey[] = ['length', 'beam', 'depth', 'capacity', 'horsepower', 'maxSpeed', 'dangerWave']

function toDraft(p: Profile): Draft {
  const b = p.boat
  const num = (v: number | null) => (v === null ? '' : String(v))
  return {
    type: b.type,
    name: b.name,
    registration: b.registration,
    length: num(b.length),
    beam: num(b.beam),
    depth: num(b.depth),
    capacity: num(b.capacity),
    horsepower: num(b.horsepower),
    maxSpeed: num(b.maxSpeed),
    dangerWave: num(b.dangerWave),
    daylightOnly: b.daylightOnly,
    licenseType: p.docs.licenseType,
    licenseExpiry: p.docs.licenseExpiry,
    inspectionExpiry: p.docs.inspectionExpiry,
  }
}

function applyDraft(p: Profile, d: Draft): Profile {
  const nums = Object.fromEntries(NUM_KEYS.map((k) => [k, numField(d[k])])) as Record<NumKey, number | null>
  return {
    ...p,
    boat: { ...p.boat, type: d.type, name: d.name.trim(), registration: d.registration.trim(), daylightOnly: d.daylightOnly, ...nums },
    docs: { ...p.docs, licenseType: d.licenseType.trim(), licenseExpiry: d.licenseExpiry, inspectionExpiry: d.inspectionExpiry },
  }
}

/** 保存すると変わるか（入力の書き方の違い、例: 「5.0」と「5」は変わらないとみなす） */
function changed(p: Profile, d: Draft): boolean {
  const next = applyDraft(p, d)
  return JSON.stringify([next.boat, next.docs]) !== JSON.stringify([p.boat, p.docs])
}

/** 資格・船舶情報: 船の情報と写真、船舶検査手帳・免許証の写真、有効期限 */
export function DocsPage({ profile, onChange, signedIn }: Props) {
  const { t, lang } = useI18n()
  const [viewing, setViewing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(() => toDraft(profile))
  const [saved, setSaved] = useState(false)
  const dirty = changed(profile, draft)
  // 別の端末の変更をドライブから読み込んだ時は、入力中でなければ入力欄も合わせる
  const [from, setFrom] = useState(profile)
  if (from !== profile) {
    setFrom(profile)
    if (!changed(from, draft)) setDraft(toDraft(profile))
  }
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }))
    setSaved(false)
  }
  const save = () => {
    onChange((p) => applyDraft(p, draft))
    setDraft(toDraft(applyDraft(profile, draft)))
    setSaved(true)
    navigator.vibrate?.(30)
  }
  // 保存せずにほかの画面に移った時も、入力した内容をなくさないよう保存する
  const pending = useRef<{ dirty: boolean; draft: Draft }>({ dirty, draft })
  pending.current = { dirty, draft }
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(
    () => () => {
      if (pending.current.dirty) {
        const d = pending.current.draft
        onChangeRef.current((p) => applyDraft(p, d))
      }
    },
    [],
  )
  const [ocr, setOcr] = useState<{ kind: DocKind; progress: OcrProgress | null; result?: string; error?: string } | null>(null)

  /**
   * 書類の写真から文字を読み取り、空いている欄に入れる（すでに入っている欄は変えない）。
   * 読み取った値は間違っていることもあるので、入れた欄を知らせて確かめてもらう
   */
  const readDoc = async (kind: DocKind, canvas: HTMLCanvasElement) => {
    if (kind === 'other') return
    setOcr({ kind, progress: { phase: 'loading', progress: 0 } })
    try {
      const { text } = await recognize(canvas, (progress) => setOcr({ kind, progress }))
      const filled: string[] = []
      // 読み取った値は入力欄に入れるだけ。確かめてから「保存」を押してもらう
      setDraft((d) => {
        const boat = { ...d }
        const docs = boat
        if (kind === 'boatBook') {
          const x = extractBoat(text)
          const setNum = (key: 'length' | 'beam' | 'depth' | 'capacity' | 'horsepower', v: number | undefined, label: MessageKey) => {
            if (v !== undefined && boat[key] === '') {
              boat[key] = String(v)
              filled.push(t(label))
            }
          }
          if (x.name && !boat.name) {
            boat.name = x.name
            filled.push(t('boat.name'))
          }
          if (x.registration && !boat.registration) {
            boat.registration = x.registration
            filled.push(t('boat.registration'))
          }
          setNum('length', x.length, 'boat.length')
          setNum('beam', x.beam, 'boat.beam')
          setNum('depth', x.depth, 'boat.depth')
          setNum('capacity', x.capacity, 'boat.capacity')
          setNum('horsepower', x.horsepower, 'boat.hp')
          if (x.daylightOnly && !boat.daylightOnly) {
            boat.daylightOnly = true
            filled.push(t('boat.daylightOnly'))
          }
          if (x.inspectionExpiry && !docs.inspectionExpiry) {
            docs.inspectionExpiry = x.inspectionExpiry
            filled.push(t('docs.inspectionExpiry'))
          }
        } else {
          const x = extractLicense(text)
          if (x.licenseType && !docs.licenseType) {
            docs.licenseType = x.licenseType
            filled.push(t('docs.licenseType'))
          }
          if (x.licenseExpiry && !docs.licenseExpiry) {
            docs.licenseExpiry = x.licenseExpiry
            filled.push(t('docs.licenseExpiry'))
          }
        }
        return boat
      })
      setSaved(false)
      setOcr({ kind, progress: null, result: filled.length ? t('ocr.filled', { fields: filled.join('・') }) : t('ocr.nothing') })
    } catch (e) {
      console.error('[ocr]', e)
      setOcr({ kind, progress: null, error: t('ocr.failed') })
    }
  }
  const boat = profile.boat
  const boatPhoto = usePhotoUrl(boat.photoId)
  const setBoat = (patch: Partial<Boat>) => onChange((p) => ({ ...p, boat: { ...p.boat, ...patch } }))
  const numInput = (key: NumKey, label: MessageKey, mode: 'decimal' | 'numeric' = 'decimal') => (
    <label>
      {t(label)}
      <input inputMode={mode} value={draft[key]} onChange={(e) => set({ [key]: e.target.value })} />
    </label>
  )

  const addDoc = async (kind: DocKind, blob: Blob, canvas?: HTMLCanvasElement) => {
    if (canvas) void readDoc(kind, canvas)
    const id = newId()
    await putPhoto(id, blob)
    const count = profile.docs.items.filter((d) => d.kind === kind).length
    const label = kind === 'license' ? (count === 0 ? t('docs.front') : count === 1 ? t('docs.back') : '') : ''
    const item: DocPhoto = { id, kind, label, createdAt: Date.now() }
    onChange((p) => ({ ...p, docs: { ...p.docs, items: [...p.docs.items, item] } }))
  }

  /** 撮り直す: 新しい ID の写真にする（他の端末にも、新しい写真として伝わる） */
  const retakeDoc = async (item: DocPhoto, blob: Blob, canvas?: HTMLCanvasElement) => {
    if (canvas) void readDoc(item.kind, canvas)
    const id = newId()
    await putPhoto(id, blob)
    onChange((p) => ({ ...p, docs: { ...p.docs, items: p.docs.items.map((x) => (x.id === item.id ? { ...x, id, createdAt: Date.now() } : x)) } }))
    await deletePhoto(item.id)
  }

  const removeDoc = async (item: DocPhoto) => {
    if (!confirm(t('docs.deleteConfirm'))) return
    await deletePhoto(item.id)
    onChange((p) => ({ ...p, docs: { ...p.docs, items: p.docs.items.filter((d) => d.id !== item.id) } }))
  }

  const setBoatPhoto = async (blob: Blob) => {
    const id = newId()
    await putPhoto(id, blob)
    const old = boat.photoId
    setBoat({ photoId: id })
    if (old) await deletePhoto(old)
  }

  const expiry = (key: 'licenseExpiry' | 'inspectionExpiry', label: MessageKey) => {
    const value = draft[key]
    const days = daysUntil(value, Date.now())
    return (
      <label>
        {t(label)}
        <input type="date" value={value} onChange={(e) => set({ [key]: e.target.value })} />
        {days !== null && (
          <span className={`small ${days < 0 ? 'error' : days <= RENEWAL_NOTICE_DAYS ? 'caution-text' : 'muted'}`}>
            {days <= RENEWAL_NOTICE_DAYS && <span className="bang">!</span>}
            {days < 0 ? t('docs.expired') : days <= RENEWAL_NOTICE_DAYS ? t('docs.renewSoon', { n: days }) : t('docs.daysLeft', { n: days })}
          </span>
        )}
      </label>
    )
  }

  return (
    <>
      <section className="card">
        <h2>{t('boat.title')}</h2>
        <div className="boat-head">
          {boatPhoto ? (
            <button className="boat-photo" onClick={() => setViewing(boatPhoto)} aria-label={t('boat.photo')}>
              <img src={boatPhoto} alt={boat.name} />
            </button>
          ) : (
            <div className="boat-photo boat-photo-empty" aria-hidden="true">
              {boat.type === 'pwc' ? '🚤' : '🛥️'}
            </div>
          )}
          <div className="boat-name">
            <p className="big-name">{draft.name || t('boat.unnamed')}</p>
            {boat.registration && <p className="muted small">{t('boat.registrationShort', { v: boat.registration })}</p>}
            <PhotoCapture document={false} label={boatPhoto ? t('boat.retakePhoto') : t('boat.takePhoto')} onPhoto={(b) => void setBoatPhoto(b)} />
          </div>
        </div>
        <div className="seg" role="radiogroup" aria-label={t('boat.type')}>
          {(['boat', 'pwc'] as const).map((type) => (
            <button key={type} role="radio" aria-checked={draft.type === type} className={draft.type === type ? 'on' : ''} onClick={() => set({ type })}>
              {t(`boat.type.${type}`)}
            </button>
          ))}
        </div>
        <label>
          {t('boat.name')}
          <input value={draft.name} placeholder={t(draft.type === 'pwc' ? 'boat.namePlaceholderPwc' : 'boat.namePlaceholder')} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label>
          {t('boat.registration')}
          <input value={draft.registration} onChange={(e) => set({ registration: e.target.value })} />
        </label>
        <div className="grid2">
          {numInput('length', 'boat.length')}
          {numInput('beam', 'boat.beam')}
          {numInput('depth', 'boat.depth')}
          {numInput('capacity', 'boat.capacity', 'numeric')}
          {numInput('horsepower', 'boat.hp')}
          {numInput('maxSpeed', 'boat.maxSpeed')}
          {numInput('dangerWave', 'boat.dangerWave')}
        </div>
        <label className="check">
          <input type="checkbox" checked={draft.daylightOnly} onChange={(e) => set({ daylightOnly: e.target.checked })} />
          {t('boat.daylightOnly')}
        </label>
        <p className="muted small">{t('boat.daylightOnlyHint')}</p>
        <p className="muted small">{t('boat.hint')}</p>
      </section>

      {DOC_KINDS.map((kind) => {
        const items = profile.docs.items.filter((d) => d.kind === kind)
        return (
          <section className="card" key={kind}>
            <h2>{t(`docs.${kind}`)}</h2>
            <p className="muted small">{t(`docs.${kind}Hint`)}</p>
            {kind === 'license' && (
              <label>
                {t('docs.licenseType')}
                <input
                  list="license-types"
                  value={draft.licenseType}
                  placeholder={t('docs.licenseTypePlaceholder')}
                  onChange={(e) => set({ licenseType: e.target.value })}
                />
                <datalist id="license-types">
                  <option value="一級小型船舶操縦士" />
                  <option value="二級小型船舶操縦士" />
                  <option value="二級小型船舶操縦士（湖川小型）" />
                  <option value="特殊小型船舶操縦士" />
                </datalist>
              </label>
            )}
            {kind === 'license' && expiry('licenseExpiry', 'docs.licenseExpiry')}
            {kind === 'boatBook' && expiry('inspectionExpiry', 'docs.inspectionExpiry')}
            {items.length > 0 && (
              <ul className="doc-list">
                {items.map((d) => (
                  <li key={d.id}>
                    <Thumb id={d.id} alt={d.label || t(`docs.${kind}`)} onOpen={setViewing} />
                    <div className="doc-meta">
                      <input
                        value={d.label}
                        placeholder={t('docs.labelPlaceholder')}
                        aria-label={t('docs.label')}
                        onChange={(e) =>
                          onChange((p) => ({
                            ...p,
                            docs: { ...p.docs, items: p.docs.items.map((x) => (x.id === d.id ? { ...x, label: e.target.value } : x)) },
                          }))
                        }
                      />
                      <span className="muted small">{new Date(d.createdAt).toLocaleDateString(LOCALES[lang])}</span>
                      <PhotoCapture document label={t('docs.retake')} onPhoto={(b, c) => void retakeDoc(d, b, c)} />
                      <button className="link danger" onClick={() => void removeDoc(d)}>
                        {t('common.delete')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {ocr?.kind === kind && (
              <p className={`small ${ocr.error ? 'error' : 'muted'}`} role="status">
                {ocr.progress
                  ? t(ocr.progress.phase === 'loading' ? 'ocr.loading' : 'ocr.recognizing', { p: Math.round(ocr.progress.progress * 100) })
                  : (ocr.error ?? ocr.result)}
              </p>
            )}
            <PhotoCapture document label={t('docs.add')} onPhoto={(b, c) => void addDoc(kind, b, c)} />
          </section>
        )
      })}
      <p className="muted small">{t('docs.privacy')}</p>
      {/* 保存ボタン（画面の下に固定）。変更がある時だけ押せる */}
      <div className={`save-bar${dirty ? ' save-bar-dirty' : ''}`} role="status" aria-live="polite">
        <span className="small">
          {dirty ? t('docs.unsaved') : saved ? `✅ ${t('docs.saved')}${signedIn ? ' ' + t('docs.savedDrive') : ''}` : `✓ ${t('docs.allSaved')}`}
        </span>
        {dirty && (
          <button className="link" onClick={() => setDraft(toDraft(profile))}>
            {t('docs.revert')}
          </button>
        )}
        <button className={dirty ? 'primary' : 'secondary'} disabled={!dirty} onClick={save}>
          {dirty ? t('common.save') : `✓ ${t('msil.savedButton')}`}
        </button>
      </div>
      {viewing && <Viewer url={viewing} onClose={() => setViewing(null)} />}
    </>
  )
}
