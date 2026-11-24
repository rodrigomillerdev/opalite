/// <reference types="vite/client" />
import type { OpaliteApi } from '../../shared/types'

declare global {
  interface Window {
    opalite: OpaliteApi
  }
}

export {}
