/// <reference types="vite/client" />
import type { MoonApi } from '@shared/api'

declare global {
  interface Window {
    moon: MoonApi
  }
}
