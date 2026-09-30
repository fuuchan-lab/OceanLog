import { useCallback, useEffect, useRef, useState } from 'react'
import { describeError } from '../errors.ts'
import { useI18n } from '../i18n/useI18n.ts'
import type { Quad } from '../scan/document.ts'

/** 名刺の縦横比（91×55mm） */
const CARD_RATIO = 91 / 55
/** 映像の中の、名刺を合わせる枠の大きさ（映像の幅に対する割合） */
const GUIDE_WIDTH = 0.62

/**
 * Windows のカメラの AI 効果（Windows Studio Effects）を表す、ブラウザの非標準の制約。
 * Surface などの内蔵カメラでは、顔だけを認識してそれ以外（手に持った名刺など）をぼかす「背景効果」が
 * 既定でオンになっていることがある。Chrome/Edge には、これを Web ページから個別にオフにする仕組みがある
 * （対応していないブラウザでは、指定しても無視されるだけで害はない）
 */
interface WindowsCameraConstraints extends MediaTrackConstraintSet {
  backgroundBlur?: boolean
  backgroundSegmentationMask?: boolean
  eyeGazeCorrection?: boolean
  faceFraming?: boolean
}

/** 名刺を撮るのに邪魔になる、カメラの AI 効果をオフにする（できる範囲で。失敗しても撮影は続けられる） */
async function disableCameraEffects(track: MediaStreamTrack) {
  const capabilities = track.getCapabilities?.() as WindowsCameraConstraints | undefined
  const off: WindowsCameraConstraints = {}
  if (capabilities?.backgroundBlur) off.backgroundBlur = false
  if (capabilities?.backgroundSegmentationMask) off.backgroundSegmentationMask = false
  if (capabilities?.faceFraming) off.faceFraming = false
  if (Object.keys(off).length === 0) return
  try {
    await track.applyConstraints({ advanced: [off] })
  } catch (e) {
    // このカメラ・ブラウザでは切り替えられない。Windows の設定から手動でオフにしてもらう
    console.error('[camera-effects]', e)
  }
}

interface Props {
  /** 撮った画像と、名刺を合わせる枠の位置（画像の座標）。四隅を自動で見つけられない時の初期値に使う */
  onCapture: (image: Blob, guide: Quad) => void
  onClose: () => void
  /** カメラを使えない時に、画像ファイルを選ぶ */
  onPickFile: () => void
}

/**
 * パソコンのカメラ（インカメラ）で、手に持った名刺を撮る。
 * パソコンのブラウザでは、ファイル選択の capture 指定でカメラが起動しないため、アプリの中で映像を表示して撮る。
 * プレビューは鏡のように左右反転して表示するが（手に持った名刺を動かしやすい）、撮った画像は反転しない（文字が読めるように）
 */
export function CameraModal({ onCapture, onClose, onPickFile }: Props) {
  const { t } = useI18n()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState<string>('')
  /** 名刺を横向き（一般的な名刺）・縦向き（縦型の名刺）のどちらで持つか。枠の形をそれに合わせる */
  const [portrait, setPortrait] = useState(false)

  const stop = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  const start = useCallback(async (id: string) => {
    stop()
    setReady(false)
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...(id ? { deviceId: { exact: id } } : { facingMode: 'user' }),
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })
      streamRef.current = stream
      const track = stream.getVideoTracks()[0]
      if (track) void disableCameraEffects(track)
      const video = videoRef.current
      if (video) {
        video.srcObject = stream
        await video.play()
        setReady(true)
      }
      // カメラが複数あれば切り替えられるようにする（許可の後でないと名前が取れない）
      const all = await navigator.mediaDevices.enumerateDevices()
      setDevices(all.filter((d) => d.kind === 'videoinput'))
      setDeviceId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? id)
    } catch (e) {
      console.error('[camera]', e)
      setError(describeError(e))
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void start('')
    return stop
  }, [start])


  const capture = () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const w = video.videoWidth
    const h = video.videoHeight
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(video, 0, 0, w, h)
    // 枠の位置（プレビューは左右反転しているが、枠は中央なので同じ位置）
    // 横向きの名刺は幅を基準に、縦向きの名刺は高さを基準に、枠の大きさを決める
    let gw: number
    let gh: number
    if (portrait) {
      gh = Math.min(h * 0.9, w * 0.9 * CARD_RATIO)
      gw = gh / CARD_RATIO
    } else {
      gw = w * GUIDE_WIDTH
      gh = Math.min(h * 0.9, gw / CARD_RATIO)
    }
    const x0 = (w - gw) / 2
    const y0 = (h - gh) / 2
    const guide: Quad = [
      { x: x0, y: y0 },
      { x: x0 + gw, y: y0 },
      { x: x0 + gw, y: y0 + gh },
      { x: x0, y: y0 + gh },
    ]
    canvas.toBlob(
      (blob) => {
        if (!blob) return
        stop()
        onCapture(blob, guide)
      },
      'image/jpeg',
      0.92,
    )
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      // スペースキー・Enter でも撮れる（名刺を両手で持っている時のため）
      if ((e.key === ' ' || e.key === 'Enter') && ready) {
        e.preventDefault()
        capture()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card camera-card" role="dialog" aria-modal="true" aria-labelledby="camera-title" onClick={(e) => e.stopPropagation()}>
        <div className="scan-head">
          <div className="row">
            <h2 id="camera-title">{t('camera.title')}</h2>
            <button className="link" onClick={onClose} aria-label={t('common.close')}>
              ✕
            </button>
          </div>
          <p className="muted small">{t('camera.help')}</p>
        </div>
        {/* 名刺の向き（横向き・縦向き）に合わせて、枠の形を切り替える */}
        <div className="seg-tabs camera-orientation" role="tablist">
          <button type="button" role="tab" aria-selected={!portrait} className={portrait ? '' : 'on'} onClick={() => setPortrait(false)}>
            ▭ {t('camera.landscape')}
          </button>
          <button type="button" role="tab" aria-selected={portrait} className={portrait ? 'on' : ''} onClick={() => setPortrait(true)}>
            ▯ {t('camera.portrait')}
          </button>
        </div>
        {error ? (
          <div className="banner banner-warning" role="alert">
            {t('camera.failed')}
            <br />
            <span className="small">
              {t('err.detail')}: {error}
            </span>
          </div>
        ) : (
          <div className="camera-stage">
            <video ref={videoRef} className="camera-video" playsInline muted />
            <div
              className="camera-guide"
              style={
                portrait
                  ? { height: `${GUIDE_WIDTH * 100}%`, aspectRatio: `${1 / CARD_RATIO}` }
                  : { width: `${GUIDE_WIDTH * 100}%`, aspectRatio: `${CARD_RATIO}` }
              }
            />
            {!ready && <p className="camera-loading">{t('camera.starting')}</p>}
          </div>
        )}
        {devices.length > 1 && (
          <select
            className="language-select"
            aria-label={t('camera.switch')}
            value={deviceId}
            onChange={(e) => {
              setDeviceId(e.target.value)
              void start(e.target.value)
            }}
          >
            {devices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `${t('camera.switch')} ${i + 1}`}
              </option>
            ))}
          </select>
        )}
        <div className="scan-main-actions">
          <button
            className="secondary"
            onClick={() => {
              stop()
              onPickFile()
            }}
          >
            {t('capture.pick')}
          </button>
          <button className="primary" disabled={!ready} onClick={capture}>
            {t('camera.shoot')}
          </button>
        </div>
      </div>
    </div>
  )
}

