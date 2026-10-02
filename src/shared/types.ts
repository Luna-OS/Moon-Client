// Types shared between the Electron main process and the renderer.

export type LoaderType = 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge'

export const LOADER_LABELS: Record<LoaderType, string> = {
  vanilla: 'Vanilla',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge'
}

export type Platform = 'modrinth' | 'curseforge'
export type ContentKind = 'mod' | 'modpack' | 'resourcepack' | 'shader'

export interface InstanceSource {
  platform: Platform
  projectId: string
  versionId: string
  name: string
}

export interface Instance {
  id: string
  name: string
  mcVersion: string
  loader: LoaderType
  loaderVersion?: string
  iconUrl?: string
  createdAt: number
  lastPlayed?: number
  playTimeMs?: number
  /** Overrides the global setting when set. */
  memoryMb?: number
  javaPath?: string
  jvmArgs?: string
  width?: number
  height?: number
  source?: InstanceSource
}

export type NewInstance = Pick<Instance, 'name' | 'mcVersion' | 'loader' | 'loaderVersion' | 'iconUrl' | 'source'>

export interface InstalledContentMeta {
  platform: Platform
  projectId: string
  versionId: string
  title: string
  versionNumber?: string
  iconUrl?: string
}

export interface InstalledContent {
  /** File name inside the kind folder (mods/, resourcepacks/, shaderpacks/). */
  fileName: string
  enabled: boolean
  size: number
  meta?: InstalledContentMeta
}

export interface MinecraftVersion {
  id: string
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha'
  releaseTime: string
}

export interface LoaderVersion {
  version: string
  stable: boolean
  recommended?: boolean
}

export interface Account {
  /** Minecraft profile UUID without dashes. */
  id: string
  name: string
  type: 'microsoft' | 'offline'
}

export interface AccountsState {
  accounts: Account[]
  selectedId?: string
}

export interface DeviceCodeInfo {
  userCode: string
  verificationUri: string
  expiresIn: number
  message: string
}

export interface Settings {
  memoryMb: number
  javaPath: string
  jvmArgs: string
  curseforgeApiKey: string
  msaClientId: string
  closeOnLaunch: boolean
  showSnapshots: boolean
  downloadConcurrency: number
}

export interface TaskProgress {
  id: string
  title: string
  detail?: string
  current: number
  total: number
  state: 'running' | 'done' | 'error'
  error?: string
}

export interface ContentSearchQuery {
  platform: Platform
  kind: ContentKind
  query: string
  mcVersion?: string
  loader?: LoaderType
  sort: 'relevance' | 'downloads' | 'updated' | 'newest'
  offset: number
  limit: number
}

export interface ContentHit {
  platform: Platform
  kind: ContentKind
  id: string
  slug: string
  title: string
  description: string
  author: string
  iconUrl?: string
  downloads: number
  categories: string[]
  url: string
  updatedAt?: string
}

export interface ContentSearchResult {
  hits: ContentHit[]
  total: number
}

export interface ContentVersion {
  platform: Platform
  id: string
  projectId: string
  name: string
  versionNumber: string
  gameVersions: string[]
  loaders: string[]
  type: 'release' | 'beta' | 'alpha'
  date: string
  downloads: number
}

export interface GameLogLine {
  instanceId: string
  line: string
  stream: 'stdout' | 'stderr' | 'launcher'
}

export interface GameState {
  instanceId: string
  running: boolean
  exitCode?: number | null
}

export interface ModpackResult {
  instance: Instance
  warnings: string[]
}
