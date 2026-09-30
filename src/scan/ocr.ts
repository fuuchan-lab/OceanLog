/**
 * 文字の読み取り（OCR）。LeadLog と同じく tesseract.js（端末の中で動く OCR）で、日本語と英語を読む。
 * 初回だけ、読み取り用のデータ（数十MB）をダウンロードする。以降はブラウザに保存されたものを使う。
 */
import type { Worker } from 'tesseract.js'

export interface OcrLine {
  text: string
  height: number
}

export interface OcrProgress {
  /** 'loading' はデータの準備中、'recognizing' は読み取り中 */
  phase: 'loading' | 'recognizing'
  /** 0〜1 */
  progress: number
}

type Listener = (p: OcrProgress) => void

let workerPromise: Promise<Worker> | null = null
let listener: Listener | null = null
let ready = false

function getWorker(): Promise<Worker> {
  workerPromise ??= (async () => {
    // 大きいライブラリなので、使う時だけ読み込む
    const { createWorker, PSM } = await import('tesseract.js')
    const worker = await createWorker(['jpn', 'eng'], 1, {
      logger: (m) => {
        const phase = m.status === 'recognizing text' ? 'recognizing' : 'loading'
        listener?.({ phase, progress: typeof m.progress === 'number' ? m.progress : 0 })
      },
    })
    // 表の形の書類（免許証・検査手帳）は、自動のページ分割（PSM 3）で読む
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO })
    ready = true
    return worker
  })().catch((e: unknown) => {
    workerPromise = null // 通信の失敗などの後に、もう一度試せるようにする
    throw e
  })
  return workerPromise
}

export const isOcrReady = () => ready

/** 読み取り用のデータを先にダウンロードしておく */
export async function prepareOcr(onProgress?: Listener): Promise<void> {
  listener = onProgress ?? null
  try {
    await getWorker()
  } finally {
    listener = null
  }
}

export interface OcrResult {
  text: string
  lines: OcrLine[]
}

export async function recognize(image: HTMLCanvasElement, onProgress?: Listener): Promise<OcrResult> {
  listener = onProgress ?? null
  try {
    const worker = await getWorker()
    const { data } = await worker.recognize(image, {}, { text: true, blocks: true })
    const lines: OcrLine[] = []
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          const text = line.text.replace(/\n/g, ' ').trim()
          if (text) lines.push({ text, height: line.rowAttributes?.rowHeight || line.bbox.y1 - line.bbox.y0 })
        }
      }
    }
    return { text: data.text.trim(), lines }
  } finally {
    listener = null
  }
}
