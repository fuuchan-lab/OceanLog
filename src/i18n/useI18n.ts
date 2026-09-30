import { useContext } from 'react'
import { I18nContext } from './context.ts'

export function useI18n() {
  return useContext(I18nContext)
}
