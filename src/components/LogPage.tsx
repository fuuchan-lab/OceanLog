import { useState } from 'react'
import { getPoints } from '../db.ts'
import { ensureSubfolder, uploadFile } from '../drive.ts'
import { EXPORT_FORMATS, exportFileName, exportText, MIME, type ExportFormat, type ExportTrack } from '../exporters.ts'
import { fmtDateTime, fmtDuration, fmtNum } from '../format.ts'
import { formatPosition, msToKnots, NM, type LatLon } from '../geo.ts'
import type { DriveAccount } from '../hooks/useGoogleAuth.ts'
import type { LogState } from '../hooks/useLog.ts'
import { LOCALES } from '../i18n/context.ts'
import { useI18n } from '../i18n/useI18n.ts'
import { MARK_ICONS, type Mark, type TrackPoint } from '../types.ts'
import { MarkForm } from './MarkForm.tsx'

interface Props {
  log: LogState
  account: DriveAccount | null
  onShowTrack: (points: TrackPoint[]) => void
  onShowMark: (at: LatLon) => void
  onBack: () => void
}

/** 端末に保存させる。スマホでは共有シート（ファイルに保存・メール・AirDrop など）を使えれば、それを使う */
async function saveToDevice(name: string, text: string, type: string) {
  const blob = new Blob([text], { type })
  const file = new File([blob], name, { type })
  if (navigator.canShare?.({ files: [file] }) && /Android|iPhone|iPad/.test(navigator.userAgent)) {
    try {
      await navigator.share({ files: [file], title: name })
      return
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      // 共有できなければ、ダウンロードにする
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** 記録一覧: 航跡（航海）と地点。地図に表示・名前の変更・削除、GPX などで書き出し */
export function LogPage({ log, account, onShowTrack, onShowMark, onBack }: Props) {
  const { t, lang } = useI18n()
  const locale = LOCALES[lang]
  const [format, setFormat] = useState<ExportFormat>('gpx')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [includeMarks, setIncludeMarks] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [editing, setEditing] = useState<Mark | null>(null)

  const finished = log.tracks.filter((tr) => tr.endedAt !== null)
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const buildData = async () => {
    const chosen = finished.filter((tr) => selected.size === 0 || selected.has(tr.id))
    const tracks: ExportTrack[] = []
    for (const track of chosen) tracks.push({ track, points: await getPoints(track.id) })
    return { marks: includeMarks ? log.marks : [], tracks }
  }

  const run = async (to: 'device' | 'drive') => {
    setBusy(true)
    setMessage(null)
    try {
      const data = await buildData()
      const text = exportText(format, data)
      const name = exportFileName(format, new Date())
      if (to === 'device') {
        await saveToDevice(name, text, MIME[format])
      } else if (account) {
        const folder = await ensureSubfolder(account.folderId, 'Export')
        await uploadFile({ name, mimeType: MIME[format], blob: new Blob([text], { type: MIME[format] }), parentId: folder })
        setMessage({ ok: true, text: t('export.driveDone', { name }) })
      }
    } catch (e) {
      console.error('[export]', e)
      setMessage({ ok: false, text: `${t('export.failed')} (${e instanceof Error ? e.message : String(e)})` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button className="back-button" onClick={onBack}>
        ← {t('log.back')}
      </button>
      <section className="card">
        <h2>{t('log.tracks')}</h2>
        {log.tracks.length === 0 && <p className="muted">{t('log.noTracks')}</p>}
        <ul className="log-list">
          {log.tracks.map((tr) => (
            <li key={tr.id}>
              <label className="check">
                {tr.endedAt !== null && (
                  <input type="checkbox" checked={selected.has(tr.id)} onChange={() => toggle(tr.id)} aria-label={t('export.select', { name: tr.name })} />
                )}
                <span>
                  <b>{tr.name}</b>
                  {tr.endedAt === null && <span className="rec-badge">{t('track.recording')}</span>}
                  {!tr.synced && tr.endedAt !== null && <span className="unsynced-badge">{t('log.unsynced')}</span>}
                  <br />
                  <span className="small muted">
                    {fmtDateTime(tr.startedAt, locale)} · {fmtDuration((tr.endedAt ?? Date.now()) - tr.startedAt, t)} ·{' '}
                    {(tr.distance / NM).toFixed(2)} NM · {t('log.maxSpeed', { v: fmtNum(msToKnots(tr.maxSpeed)) })}
                  </span>
                </span>
              </label>
              <div className="row-actions">
                <button className="link" onClick={() => void getPoints(tr.id).then(onShowTrack)}>
                  {t('log.showOnChart')}
                </button>
                <button
                  className="link"
                  onClick={() => {
                    const name = prompt(t('log.rename'), tr.name)
                    if (name?.trim()) void log.renameTrack(tr.id, name.trim())
                  }}
                >
                  {t('common.edit')}
                </button>
                <button
                  className="link danger"
                  onClick={() => {
                    if (confirm(t('log.deleteTrackConfirm', { name: tr.name }))) void log.deleteTrack(tr.id)
                  }}
                >
                  {t('common.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>{t('log.marks')}</h2>
        {log.marks.length === 0 && <p className="muted">{t('log.noMarks')}</p>}
        <ul className="log-list">
          {log.marks.map((m) => (
            <li key={m.id}>
              <span>
                <span aria-hidden="true">{MARK_ICONS[m.kind]} </span>
                <b>{m.name}</b>
                {!m.synced && <span className="unsynced-badge">{t('log.unsynced')}</span>}
                <br />
                <span className="small muted">
                  {formatPosition(m)} · {fmtDateTime(m.createdAt, locale)}
                </span>
                {m.note && <span className="small note">{m.note}</span>}
              </span>
              <div className="row-actions">
                <button className="link" onClick={() => onShowMark(m)}>
                  {t('log.showOnChart')}
                </button>
                <button className="link" onClick={() => setEditing(m)}>
                  {t('common.edit')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>{t('export.title')}</h2>
        <p className="muted small">{t('export.lead')}</p>
        <div className="seg">
          {EXPORT_FORMATS.map((f) => (
            <button key={f} className={format === f ? 'on' : ''} onClick={() => setFormat(f)}>
              {f.toUpperCase()}
            </button>
          ))}
        </div>
        <p className="muted small">{t(`export.about.${format}`)}</p>
        <p className="small">{selected.size === 0 ? t('export.allTracks', { n: finished.length }) : t('export.someTracks', { n: selected.size })}</p>
        <label className="check">
          <input type="checkbox" checked={includeMarks} onChange={(e) => setIncludeMarks(e.target.checked)} />
          {t('export.includeMarks', { n: log.marks.length })}
        </label>
        <button className="primary" disabled={busy} onClick={() => void run('device')}>
          ⬇️ {t('export.device')}
        </button>
        <button className="secondary" disabled={busy || !account} onClick={() => void run('drive')}>
          {t('export.drive')}
        </button>
        {!account && <p className="muted small">{t('export.loginHint')}</p>}
        {message && (
          <p className={message.ok ? 'ok-text small' : 'error small'} role="status">
            {message.text}
          </p>
        )}
      </section>

      {editing && (
        <MarkForm
          title={t('mark.edit')}
          initial={{ ...editing }}
          onClose={() => setEditing(null)}
          onSave={(d) => {
            void log.updateMark({ ...editing, ...d })
            setEditing(null)
          }}
          onDelete={() => {
            if (confirm(t('mark.deleteConfirm'))) {
              void log.deleteMark(editing)
              setEditing(null)
            }
          }}
        />
      )}
    </>
  )
}
