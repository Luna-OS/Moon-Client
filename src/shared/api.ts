import type {
  Account,
  AccountsState,
  ContentKind,
  ContentSearchQuery,
  ContentSearchResult,
  ContentVersion,
  DeviceCodeInfo,
  GameLogLine,
  GameState,
  InstalledContent,
  Instance,
  LoaderType,
  LoaderVersion,
  MinecraftVersion,
  ModpackResult,
  NewInstance,
  Platform,
  Settings,
  TaskProgress
} from './types'

export type FileKind = Exclude<ContentKind, 'modpack'>

/** The API the preload script exposes to the renderer as `window.moon`. */
export interface MoonApi {
  platform: NodeJS.Platform
  app: {
    version(): Promise<string>
    openExternal(url: string): Promise<void>
    windowAction(action: 'minimize' | 'maximize' | 'close'): void
    dataDir(): Promise<string>
    openDataDir(): Promise<void>
  }
  versions: {
    minecraft(): Promise<MinecraftVersion[]>
    loaderGameVersions(loader: LoaderType): Promise<string[] | null>
    loaderVersions(loader: LoaderType, mcVersion: string): Promise<LoaderVersion[]>
  }
  instances: {
    list(): Promise<Instance[]>
    create(data: NewInstance): Promise<Instance>
    update(id: string, patch: Partial<Instance>): Promise<Instance>
    remove(id: string): Promise<void>
    openFolder(id: string, sub?: string): Promise<void>
    content(id: string, kind: FileKind): Promise<InstalledContent[]>
    setContentEnabled(id: string, kind: FileKind, fileName: string, enabled: boolean): Promise<void>
    deleteContent(id: string, kind: FileKind, fileName: string): Promise<void>
    addLocalContent(id: string, kind: FileKind): Promise<number>
    importModpack(): Promise<ModpackResult | null>
    launch(id: string): Promise<void>
    kill(id: string): Promise<void>
    running(): Promise<string[]>
  }
  content: {
    search(q: ContentSearchQuery): Promise<ContentSearchResult>
    versions(
      platform: Platform,
      projectId: string,
      kind: ContentKind,
      mcVersion?: string,
      loader?: LoaderType
    ): Promise<ContentVersion[]>
    install(
      instanceId: string,
      platform: Platform,
      kind: FileKind,
      projectId: string,
      title: string,
      versionId?: string
    ): Promise<string[]>
    installModpack(platform: Platform, projectId: string, title: string, versionId?: string): Promise<ModpackResult>
  }
  accounts: {
    state(): Promise<AccountsState>
    loginMicrosoft(): Promise<Account>
    cancelLogin(): Promise<void>
    addOffline(name: string): Promise<Account>
    remove(id: string): Promise<void>
    select(id: string): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  on: {
    task(cb: (t: TaskProgress) => void): () => void
    log(cb: (l: GameLogLine) => void): () => void
    game(cb: (s: GameState) => void): () => void
    deviceCode(cb: (d: DeviceCodeInfo) => void): () => void
  }
}
