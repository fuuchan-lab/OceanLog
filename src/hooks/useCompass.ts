import { useCallback, useEffect, useRef, useState } from 'react'

/** iPhone の Safari が出す、方位の独自の値 */
interface IosOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number
}

type PermissionFn = () => Promise<'granted' | 'denied'>

function permissionFn(): PermissionFn | null {
  const ctor = (typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : null) as unknown as {
    requestPermission?: PermissionFn
  } | null
  return typeof ctor?.requestPermission === 'function' ? ctor.requestPermission : null
}

/** 画面の向き（横向きにした時）の分を補正する */
function screenAngle(): number {
  return typeof screen !== 'undefined' && screen.orientation ? screen.orientation.angle : 0
}

/** 方位の揺れをならす（前の値に少しずつ寄せる。0°と360°をまたいでも正しく） */
function smooth(prev: number | null, next: number): number {
  if (prev === null) return next
  const diff = ((next - prev + 540) % 360) - 180
  return (prev + diff * 0.25 + 360) % 360
}

/** 画面に出す値を変える、最小の角度の差と間隔（センサーは1秒に数十回届くので、毎回は描き直さない） */
const PUBLISH_MIN_DEG = 1
const PUBLISH_MIN_MS = 100

/**
 * スマホのコンパス（電子コンパス）で、端末の上端が向いている方角（磁方位、北=0 時計回り）。
 * iPhone は、画面をタップして許可してもらう必要がある（enable を呼ぶ）
 */
export function useCompass() {
  const [heading, setHeading] = useState<number | null>(null)
  const [needsPermission, setNeedsPermission] = useState(() => permissionFn() !== null)
  const [supported, setSupported] = useState(() => typeof window !== 'undefined' && 'DeviceOrientationEvent' in window)

  // ならした値はいつも更新し、画面（state）には 1° 以上変わった時だけ、0.1秒に1回まで出す
  const smoothed = useRef<number | null>(null)
  const published = useRef<{ at: number; value: number | null }>({ at: 0, value: null })
  const listen = useCallback(() => {
    const push = (raw: number) => {
      const value = smooth(smoothed.current, raw)
      smoothed.current = value
      const now = performance.now()
      const prev = published.current
      const diff = prev.value === null ? 360 : Math.abs(((value - prev.value + 540) % 360) - 180)
      if (diff < PUBLISH_MIN_DEG || now - prev.at < PUBLISH_MIN_MS) return
      published.current = { at: now, value }
      setHeading(value)
    }
    const onIos = (e: Event) => {
      const h = (e as IosOrientationEvent).webkitCompassHeading
      if (typeof h === 'number' && Number.isFinite(h)) push((h + screenAngle()) % 360)
    }
    const onAbsolute = (e: DeviceOrientationEvent) => {
      if (e.alpha === null) return
      push((360 - e.alpha + screenAngle()) % 360)
    }
    const hasAbsolute = 'ondeviceorientationabsolute' in window
    if (hasAbsolute) window.addEventListener('deviceorientationabsolute', onAbsolute as EventListener)
    else window.addEventListener('deviceorientation', onIos)
    return () => {
      window.removeEventListener('deviceorientationabsolute', onAbsolute as EventListener)
      window.removeEventListener('deviceorientation', onIos)
    }
  }, [])

  useEffect(() => {
    if (needsPermission || !supported) return
    return listen()
  }, [needsPermission, supported, listen])

  /** iPhone: コンパスの利用を許可してもらう（ボタンを押した時に呼ぶ） */
  const enable = useCallback(async () => {
    const fn = permissionFn()
    if (!fn) return
    try {
      if ((await fn()) === 'granted') setNeedsPermission(false)
      else setSupported(false)
    } catch {
      setSupported(false)
    }
  }, [])

  return { heading, needsPermission, supported, enable }
}

export type CompassState = ReturnType<typeof useCompass>
