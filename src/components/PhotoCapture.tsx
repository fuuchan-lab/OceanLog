import { useRef, useState } from 'react'
import { isDesktop } from '../device.ts'
import { describeError } from '../errors.ts'
import { shrinkImage } from '../image.ts'
import { useI18n } from '../i18n/useI18n.ts'
import type { Quad, RGBAImage } from '../scan/document.ts'
import { canvasToJpeg, findDocument, loadPhoto, makeDocument, toCanvas } from '../scan/scanImage.ts'
import { CameraModal } from './CameraModal.tsx'
import { ScanModal } from './ScanModal.tsx'

type Stage = { kind: 'idle' } | { kind: 'loading' } | { kind: 'adjust'; image: RGBAImage; quad: Quad; found: boolean } | { kind: 'processing' }

interface Props {
  /** 撮影ボタンの文字 */
  label: string
  /** 書類なら、四隅を合わせて台形補正する（LeadLog の名刺と同じ）。船の写真などは、そのまま保存する */
  document: boolean
  /** 補正した画像（書類の場合は、文字の読み取りに使うキャンバスも渡す） */
  onPhoto: (blob: Blob, canvas?: HTMLCanvasElement) => void
}

/**
 * 写真を撮る・選ぶ（LeadLog の名刺の撮影と同じ流れ）。
 * 撮影 → 書類の四隅を自動で探す → 手で合わせる（再撮影・回転もできる）→ 長方形に補正して保存（文字の読み取りは呼び出し側）
 */
export function PhotoCapture({ label, document: isDoc, onPhoto }: Props) {
  const { t } = useI18n()
  const cameraRef = useRef<HTMLInputElement>(null)
  const pickRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>({ kind: 'idle' })
  const [cameraOpen, setCameraOpen] = useState(false)
  const [source, setSource] = useState<'camera' | 'pick'>('camera')
  const [error, setError] = useState<string | null>(null)

  const open = (from: 'camera' | 'pick') => {
    setSource(from)
    setError(null)
    // パソコンでは、ファイル選択の capture 指定でカメラが起動しないので、アプリの中のカメラで撮る
    if (from === 'camera' && isDesktop()) {
      setCameraOpen(true)
      return
    }
    ;(from === 'camera' ? cameraRef : pickRef).current?.click()
  }

  const onFile = async (file: Blob | undefined, guide?: Quad) => {
    if (!file) return
    if (!isDoc) {
      onPhoto(await shrinkImage(file))
      return
    }
    setStage({ kind: 'loading' })
    try {
      const image = await loadPhoto(file)
      const detected = findDocument(image)
      const { quad, found } = !detected.found && guide ? { quad: guide, found: false } : detected
      setStage({ kind: 'adjust', image, quad, found })
    } catch (e) {
      console.error('[scan-load]', e)
      setStage({ kind: 'idle' })
      setError(`${t('scan.failed')} (${describeError(e)})`)
    }
  }

  const apply = async (image: RGBAImage, quad: Quad, rotation: number, enhance: boolean) => {
    setStage({ kind: 'processing' })
    // 補正の計算で画面が固まる前に、「補正しています」を表示させる
    await new Promise((r) => setTimeout(r, 30))
    try {
      const canvas = toCanvas(makeDocument(image, quad, rotation, enhance))
      onPhoto(await canvasToJpeg(canvas, 0.88), canvas)
    } catch (e) {
      console.error('[scan-process]', e)
      setError(`${t('scan.failed')} (${describeError(e)})`)
    } finally {
      setStage({ kind: 'idle' })
    }
  }

  const busy = stage.kind === 'loading' || stage.kind === 'processing'

  return (
    <>
      <div className="row gap">
        <button className="secondary" disabled={busy} onClick={() => open('camera')}>
          📷 {label}
        </button>
        <button className="link" disabled={busy} onClick={() => open('pick')}>
          {t('capture.pick')}
        </button>
      </div>
      {busy && <p className="muted small">{stage.kind === 'loading' ? t('scan.loading') : t('scan.processing')}</p>}
      {error && <p className="error small">{error}</p>}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          void onFile(file)
        }}
      />
      <input
        ref={pickRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          void onFile(file)
        }}
      />
      {cameraOpen && (
        <CameraModal
          onClose={() => setCameraOpen(false)}
          onPickFile={() => {
            setCameraOpen(false)
            pickRef.current?.click()
          }}
          onCapture={(blob, guide) => {
            setCameraOpen(false)
            void onFile(blob, guide)
          }}
        />
      )}
      {stage.kind === 'adjust' && (
        <ScanModal
          image={stage.image}
          initialQuad={stage.quad}
          found={stage.found}
          onClose={() => setStage({ kind: 'idle' })}
          onRetake={() => {
            setStage({ kind: 'idle' })
            open(source)
          }}
          onApply={(quad, rotation, enhance) => void apply(stage.image, quad, rotation, enhance)}
        />
      )}
    </>
  )
}
