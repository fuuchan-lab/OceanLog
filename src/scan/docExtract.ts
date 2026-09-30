/**
 * 船舶検査手帳（船舶検査証書）・小型船舶操縦免許証の OCR の文字から、入力欄に入れる値を取り出す。
 * ブラウザ機能に依存しない。OCR は読み違いもあるので、取り出した値は入力欄に入れて、人が確かめて直す前提。
 */

export interface BoatExtract {
  name?: string
  registration?: string
  length?: number
  beam?: number
  depth?: number
  capacity?: number
  horsepower?: number
  /** 次回の船舶検査の時期（検査証書の有効期間の満了日） YYYY-MM-DD */
  inspectionExpiry?: string
  /** 航行時間の制限「日出から日没まで」（航行上の条件） */
  daylightOnly?: boolean
}

export interface LicenseExtract {
  licenseType?: string
  /** 次の更新（有効期間の満了日） YYYY-MM-DD */
  licenseExpiry?: string
}

/** 全角の数字・記号を半角にし、日本語の文字の間に入った空白（OCR でよく入る）を消す */
export function normalize(text: string): string {
  return text
    .replace(/[０-９Ａ-Ｚａ-ｚ．：－（）]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[ｍＭ]/g, 'm')
    .replace(/[　\t]/g, ' ')
    .replace(/([぀-ヿ一-鿿]) +(?=[぀-ヿ一-鿿])/g, '$1')
    .replace(/(\d) +(?=[.．]\d)/g, '$1')
}

const pad = (n: number) => String(n).padStart(2, '0')

function toIso(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

interface FoundDate {
  iso: string
  index: number
}

/** 和暦（令和・平成）と西暦の日付をすべて探す */
export function findDates(text: string): FoundDate[] {
  const out: FoundDate[] = []
  const era = /(令和|平成|R|H)\s*(\d{1,2}|元)\s*[年.]\s*(\d{1,2})\s*[月.]\s*(\d{1,2})\s*日?/g
  for (const m of text.matchAll(era)) {
    const n = m[2] === '元' ? 1 : Number(m[2])
    const y = m[1] === '令和' || m[1] === 'R' ? 2018 + n : 1988 + n
    const iso = toIso(y, Number(m[3]), Number(m[4]))
    if (iso) out.push({ iso, index: m.index ?? 0 })
  }
  const western = /(20\d{2})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?/g
  for (const m of text.matchAll(western)) {
    const iso = toIso(Number(m[1]), Number(m[2]), Number(m[3]))
    if (iso) out.push({ iso, index: m.index ?? 0 })
  }
  return out.sort((a, b) => a.index - b.index)
}

/** 有効期限の日付: 見出し（有効期間・満了・まで有効 など）の近くの日付。なければ一番先の日付 */
function expiryDate(text: string, keywords: RegExp): string | undefined {
  const dates = findDates(text)
  if (dates.length === 0) return undefined
  const kw = keywords.exec(text)
  if (kw) {
    // 見出しの後ろにある最初の日付（「令和9年10月1日まで有効」のように前にある場合は、見出しの直前の日付）
    const after = dates.find((d) => d.index >= kw.index)
    const before = [...dates].reverse().find((d) => d.index < kw.index && kw.index - d.index < 20)
    const pick = before ?? after
    if (pick) return pick.iso
  }
  return dates.map((d) => d.iso).sort().at(-1)
}

const num = (s: string | undefined) => (s === undefined ? undefined : Number(s))

export function extractBoat(raw: string): BoatExtract {
  const text = normalize(raw)
  const out: BoatExtract = {}
  const name = /船\s*名[\s:：]*([^\s\d:：、,]{1,16}?)(?=長さ|船籍|総トン|用途|航行区域|\s|\d|$)/.exec(text)
  if (name) out.name = name[1]
  const reg = /(\d{3})\s*[-ー−―]\s*(\d{4,5})/.exec(text)
  if (reg) out.registration = `${reg[1]}-${reg[2]}`
  const len = /長\s*さ[^\d\n]{0,6}(\d{1,2}(?:\.\d{1,2})?)/.exec(text)
  if (len) out.length = num(len[1])
  const beam = /幅[^\d\n]{0,6}(\d{1,2}(?:\.\d{1,2})?)/.exec(text)
  if (beam) out.beam = num(beam[1])
  const depth = /深\s*さ[^\d\n]{0,6}(\d{1,2}(?:\.\d{1,2})?)/.exec(text)
  if (depth) out.depth = num(depth[1])
  // 定員: 「最大搭載人員 旅客0人 船員1人 その他4人 計5人」なら計を使う
  const capIdx = text.search(/最大搭載人員|搭載人員|定員/)
  if (capIdx >= 0) {
    const part = text.slice(capIdx, capIdx + 60)
    const total = /計[^\d\n]{0,3}(\d{1,3})\s*人/.exec(part)
    const first = /(\d{1,3})\s*人/.exec(part)
    const v = total?.[1] ?? first?.[1]
    if (v) out.capacity = Number(v)
  }
  const ps = /(\d{1,4}(?:\.\d)?)\s*(?:PS|ps|Ps|馬力|HP|hp)/.exec(text)
  const kw = /(\d{1,4}(?:\.\d{1,2})?)\s*(?:kW|KW|kw)/.exec(text)
  if (ps) out.horsepower = Number(ps[1])
  else if (kw) out.horsepower = Math.round(Number(kw[1]) * 1.36)
  const exp = expiryDate(text, /有効期間|満了|次回|まで有効|有効期限/)
  if (exp) out.inspectionExpiry = exp
  if (/日出(から|より)?.{0,3}日没|日の出.{0,4}日の入|昼間に限/.test(text)) out.daylightOnly = true
  return out
}

export function extractLicense(raw: string): LicenseExtract {
  const text = normalize(raw).replace(/[ー−―-]\s*級/g, '一級')
  const out: LicenseExtract = {}
  const type = /(一級|二級|特殊)/.exec(text)
  if (type) out.licenseType = `${type[1]}小型船舶操縦士${type[1] === '二級' && /湖川小型(?!を除)/.test(text) ? '（湖川小型）' : ''}`
  const exp = expiryDate(text, /まで有効|有効期間|有効期限|満了/)
  if (exp) out.licenseExpiry = exp
  return out
}
