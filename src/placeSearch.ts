/**
 * 地名・住所から位置を探す。国土地理院の地名検索（無料・キー不要。出典: 国土地理院）を使う。
 * 港・マリーナの名前や、住所・地名で探せる
 */
export interface Place {
  title: string
  lat: number
  lon: number
}

interface GsiFeature {
  geometry?: { coordinates?: [number, number] }
  properties?: { title?: string }
}

export function parsePlaces(data: unknown): Place[] {
  if (!Array.isArray(data)) return []
  return (data as GsiFeature[]).flatMap((f): Place[] => {
    const c = f.geometry?.coordinates
    const title = f.properties?.title
    if (!c || typeof title !== 'string' || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) return []
    return [{ title, lat: c[1], lon: c[0] }]
  })
}

export async function searchPlaces(query: string): Promise<Place[]> {
  const res = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(query.trim())}`)
  if (!res.ok) throw new Error(`place-search-${res.status}`)
  return parsePlaces(await res.json())
}
