/**
 * 海況の取得。Open-Meteo（APIキー不要）の天気予報 API と海洋（Marine）API を使う。
 * 気圧の部分（PressureForecast）は頭痛ログと同じ形・同じ取り方（15分ごとの地上気圧）にして、
 * 推移グラフ（forecast.ts）と気圧変化の判定（warning.ts）をそのまま使えるようにしている。
 */
import type { TFn } from './i18n/context.ts'

interface PressurePoint {
  /** epoch ms */
  t: number
  hpa: number
  /** WMO 天気コード */
  code: number
  isDay: boolean
}

/** 推移グラフ用の、細かい間隔の気圧 */
interface FinePoint {
  /** epoch ms */
  t: number
  hpa: number
}

export interface PressureForecast {
  /** 現在の気圧 (hPa) */
  current: number
  /** 現在の天気 */
  weather: { code: number; isDay: boolean; temperature: number; humidity: number }
  /** 過去6時間〜先12時間の1時間ごとの気圧と天気 */
  series: PressurePoint[]
  /** 過去6時間〜先12時間の15分ごとの気圧。取得できない地域では空 */
  fine: FinePoint[]
}

export interface WindNow {
  /** 平均風速 (m/s) */
  speed: number
  /** 最大瞬間風速 (m/s) */
  gust: number
  /** 風が吹いてくる方角 (度、北=0 時計回り) */
  direction: number
}

export interface WindHour extends WindNow {
  /** epoch ms */
  t: number
  code: number
  isDay: boolean
  /** 降水確率 (%)。取れなければ null */
  precipProb: number | null
}

export interface Weather {
  pressure: PressureForecast
  wind: WindNow
  /** 視程 (m)。取れなければ null */
  visibility: number | null
  /** 雲量 (%) */
  cloudCover: number | null
  /** 今後24時間の1時間ごとの風と天気 */
  hourly: WindHour[]
}

export interface WaveNow {
  /** 有義波高 (m) */
  height: number | null
  /** 波の来る方角 (度) */
  direction: number | null
  /** 周期 (秒) */
  period: number | null
  swellHeight: number | null
  swellDirection: number | null
  swellPeriod: number | null
  /** 海面水温 (℃) */
  seaTemp: number | null
  /** 海流の速さ (m/s) と、流れていく方角 (度) */
  currentSpeed: number | null
  currentDirection: number | null
}

export interface SeaLevelPoint {
  /** epoch ms */
  t: number
  /** 平均海面からの高さ (m)。潮汐を含む */
  h: number
}

export interface Marine {
  now: WaveNow
  /** 今後24時間の1時間ごとの波高 */
  waves: { t: number; height: number | null; period: number | null; direction: number | null }[]
  /** 潮位（海面の高さ）。前日から3日先まで1時間ごと。沿岸などでデータがない時は空 */
  seaLevel: SeaLevelPoint[]
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

interface ForecastResponse {
  current: {
    time: number
    surface_pressure: number
    weather_code: number
    is_day: number
    temperature_2m: number
    relative_humidity_2m: number
    wind_speed_10m: number
    wind_direction_10m: number
    wind_gusts_10m: number
    cloud_cover?: number
    visibility?: number
  }
  hourly: {
    time: number[]
    surface_pressure: number[]
    weather_code: number[]
    is_day: number[]
    wind_speed_10m: (number | null)[]
    wind_direction_10m: (number | null)[]
    wind_gusts_10m: (number | null)[]
    precipitation_probability?: (number | null)[]
  }
  minutely_15?: { time: number[]; surface_pressure: (number | null)[] }
}

const HOUR = 3_600_000

/** Open-Meteo から現在地の気圧・天気・風と予報を取得する */
export async function fetchWeather(lat: number, lon: number): Promise<Weather> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current:
      'surface_pressure,weather_code,is_day,temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,visibility',
    hourly: 'surface_pressure,weather_code,is_day,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation_probability',
    past_hours: '6',
    forecast_hours: '24',
    minutely_15: 'surface_pressure',
    past_minutely_15: '24',
    forecast_minutely_15: '48',
    wind_speed_unit: 'ms',
    timeformat: 'unixtime',
  })
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
  if (!res.ok) throw new Error(`weather-fetch-failed-${res.status}`)
  const data = (await res.json()) as ForecastResponse
  const h = data.hourly
  const all = h.time.map((t, i) => ({
    t: t * 1000,
    hpa: h.surface_pressure[i],
    code: h.weather_code[i],
    isDay: h.is_day[i] === 1,
  }))
  // 気圧の推移は頭痛ログと同じく、直前6時間〜先12時間
  const now = data.current.time * 1000
  const series = all.filter((p) => p.t <= now + 12 * HOUR)
  const fine = (data.minutely_15?.time ?? []).flatMap((t, i): FinePoint[] => {
    const hpa = data.minutely_15?.surface_pressure[i]
    return typeof hpa === 'number' ? [{ t: t * 1000, hpa }] : []
  })
  const hourly: WindHour[] = h.time.flatMap((t, i): WindHour[] => {
    const speed = num(h.wind_speed_10m[i])
    const direction = num(h.wind_direction_10m[i])
    if (t * 1000 < now - HOUR || speed === null || direction === null) return []
    return [
      {
        t: t * 1000,
        speed,
        direction,
        gust: num(h.wind_gusts_10m[i]) ?? speed,
        code: h.weather_code[i],
        isDay: h.is_day[i] === 1,
        precipProb: num(h.precipitation_probability?.[i]),
      },
    ]
  })
  const c = data.current
  return {
    pressure: {
      current: c.surface_pressure,
      weather: { code: c.weather_code, isDay: c.is_day === 1, temperature: c.temperature_2m, humidity: c.relative_humidity_2m },
      series,
      fine,
    },
    wind: { speed: c.wind_speed_10m, gust: c.wind_gusts_10m, direction: c.wind_direction_10m },
    visibility: num(c.visibility),
    cloudCover: num(c.cloud_cover),
    hourly,
  }
}

interface MarineResponse {
  current?: Record<string, number | null>
  hourly?: {
    time: number[]
    wave_height?: (number | null)[]
    wave_period?: (number | null)[]
    wave_direction?: (number | null)[]
    sea_level_height_msl?: (number | null)[]
  }
}

/** Open-Meteo の Marine API から波・うねり・海面水温・海流・潮位を取得する */
export async function fetchMarine(lat: number, lon: number): Promise<Marine> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current:
      'wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction,swell_wave_period,sea_surface_temperature,ocean_current_velocity,ocean_current_direction',
    hourly: 'wave_height,wave_period,wave_direction,sea_level_height_msl',
    past_days: '1',
    forecast_days: '3',
    cell_selection: 'sea',
    timeformat: 'unixtime',
  })
  const res = await fetch(`https://marine-api.open-meteo.com/v1/marine?${params}`)
  if (!res.ok) throw new Error(`marine-fetch-failed-${res.status}`)
  return parseMarine((await res.json()) as MarineResponse, Date.now())
}

export function parseMarine(data: MarineResponse, now: number): Marine {
  const c = data.current ?? {}
  // 海流は km/h で返るので m/s にする
  const currentKmh = num(c.ocean_current_velocity)
  const h = data.hourly
  const times = h?.time ?? []
  const waves = times.flatMap((t, i) =>
    t * 1000 >= now - HOUR && t * 1000 <= now + 24 * HOUR
      ? [{ t: t * 1000, height: num(h?.wave_height?.[i]), period: num(h?.wave_period?.[i]), direction: num(h?.wave_direction?.[i]) }]
      : [],
  )
  const seaLevel = times.flatMap((t, i): SeaLevelPoint[] => {
    const v = num(h?.sea_level_height_msl?.[i])
    return v === null ? [] : [{ t: t * 1000, h: v }]
  })
  return {
    now: {
      height: num(c.wave_height),
      direction: num(c.wave_direction),
      period: num(c.wave_period),
      swellHeight: num(c.swell_wave_height),
      swellDirection: num(c.swell_wave_direction),
      swellPeriod: num(c.swell_wave_period),
      seaTemp: num(c.sea_surface_temperature),
      currentSpeed: currentKmh === null ? null : currentKmh / 3.6,
      currentDirection: num(c.ocean_current_direction),
    },
    waves,
    seaLevel,
  }
}

export interface WeatherView {
  icon: string
  label: string
}

/** WMO 天気コードを絵文字アイコンと、表示する言語のラベルにする（頭痛ログと同じ） */
export function describeWeather(code: number, isDay: boolean, t: TFn): WeatherView {
  if (code === 0) return { icon: isDay ? '☀️' : '🌙', label: t('w.clear') }
  if (code === 1) return { icon: isDay ? '🌤️' : '🌙', label: t('w.mostlyClear') }
  if (code === 2) return { icon: isDay ? '⛅' : '☁️', label: t('w.partlyCloudy') }
  if (code === 3) return { icon: '☁️', label: t('w.cloudy') }
  if (code === 45 || code === 48) return { icon: '🌫️', label: t('w.fog') }
  if (code >= 51 && code <= 57) return { icon: '🌦️', label: t('w.drizzle') }
  if (code >= 61 && code <= 67) return { icon: '🌧️', label: t('w.rain') }
  if (code >= 71 && code <= 77) return { icon: '🌨️', label: t('w.snow') }
  if (code >= 80 && code <= 82) return { icon: '🌦️', label: t('w.showers') }
  if (code === 85 || code === 86) return { icon: '🌨️', label: t('w.snowShowers') }
  if (code >= 95) return { icon: '⛈️', label: t('w.thunder') }
  return { icon: '🌡️', label: t('w.unknown') }
}
