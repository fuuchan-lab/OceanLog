import type { ComponentProps } from 'react'
import { useI18n } from '../i18n/useI18n.ts'
import { PositionCard } from './PositionCard.tsx'
import { SafetyCard } from './SafetyCard.tsx'
import { WaveCard } from './WaveCard.tsx'
import { WeatherCard } from './WeatherCard.tsx'

/** 波・気象の画面: 安全の目安、天気・気圧・風、波、現在地（App から、開いた時に読み込む） */
export function SeaPage({
  safety,
  weather,
  wave,
  position,
}: {
  safety: ComponentProps<typeof SafetyCard>
  weather: ComponentProps<typeof WeatherCard>
  wave: ComponentProps<typeof WaveCard>
  position: ComponentProps<typeof PositionCard>
}) {
  const { t } = useI18n()
  return (
    <>
      <SafetyCard {...safety} />
      <WeatherCard {...weather} />
      <WaveCard {...wave} />
      <PositionCard {...position} />
      <p className="muted small">{t('sea.sources')}</p>
    </>
  )
}
