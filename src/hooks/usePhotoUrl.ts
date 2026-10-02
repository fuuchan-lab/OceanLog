import { useEffect, useState } from 'react'
import { getPhoto } from '../db.ts'

/** 端末に保存した写真を表示する。写真の ID が変わったら読み直す */
export function usePhotoUrl(id: string | null, version = 0): string | null {
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
