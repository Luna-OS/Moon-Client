import type { Settings } from '../shared/types'
import { exists, readJson, writeJson } from './core/http'
import { paths } from './core/paths'

// Keys can be baked in at build time via .env (MAIN_VITE_*), see README.
const DEFAULTS: Settings = {
  memoryMb: 4096,
  javaPath: '',
  jvmArgs: '',
  curseforgeApiKey: import.meta.env.MAIN_VITE_CURSEFORGE_API_KEY ?? '',
  msaClientId: import.meta.env.MAIN_VITE_MSA_CLIENT_ID ?? '',
  closeOnLaunch: false,
  showSnapshots: false,
  downloadConcurrency: 16
}

let current: Settings | undefined

export async function getSettings(): Promise<Settings> {
  if (current) return current
  const stored = (await exists(paths.settingsFile)) ? await readJson<Partial<Settings>>(paths.settingsFile) : {}
  // Empty strings in the file must not hide build-time defaults.
  const merged = { ...DEFAULTS }
  for (const [key, value] of Object.entries(stored) as Array<[keyof Settings, never]>) {
    if (value !== '' && value !== undefined && value !== null) merged[key] = value
  }
  current = merged
  return current
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch }
  next.memoryMb = Math.max(512, Math.round(Number(next.memoryMb) || DEFAULTS.memoryMb))
  next.downloadConcurrency = Math.min(64, Math.max(1, Math.round(Number(next.downloadConcurrency) || 16)))
  current = next
  await writeJson(paths.settingsFile, next)
  return next
}
