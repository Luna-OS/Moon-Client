import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { MoonApi } from '../shared/api'

const invoke =
  <Args extends unknown[], R>(channel: string) =>
  (...args: Args): Promise<R> =>
    ipcRenderer.invoke(channel, ...args) as Promise<R>

function subscribe<T>(channel: string) {
  return (cb: (payload: T) => void) => {
    const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }
}

const api: MoonApi = {
  platform: process.platform,
  app: {
    version: invoke('app:version'),
    openExternal: invoke('app:openExternal'),
    windowAction: (action) => ipcRenderer.send('app:window', action),
    dataDir: invoke('app:dataDir'),
    openDataDir: invoke('app:openDataDir')
  },
  versions: {
    minecraft: invoke('versions:minecraft'),
    loaderGameVersions: invoke('versions:loaderGame'),
    loaderVersions: invoke('versions:loader')
  },
  instances: {
    list: invoke('instances:list'),
    create: invoke('instances:create'),
    update: invoke('instances:update'),
    remove: invoke('instances:remove'),
    openFolder: invoke('instances:openFolder'),
    content: invoke('instances:content'),
    setContentEnabled: invoke('instances:setContentEnabled'),
    deleteContent: invoke('instances:deleteContent'),
    addLocalContent: invoke('instances:addLocalContent'),
    importModpack: invoke('instances:importModpack'),
    launch: invoke('instances:launch'),
    kill: invoke('instances:kill'),
    running: invoke('instances:running')
  },
  content: {
    search: invoke('content:search'),
    versions: invoke('content:versions'),
    install: invoke('content:install'),
    installModpack: invoke('content:installModpack')
  },
  accounts: {
    state: invoke('accounts:state'),
    loginMicrosoft: invoke('accounts:loginMicrosoft'),
    cancelLogin: invoke('accounts:cancelLogin'),
    addOffline: invoke('accounts:addOffline'),
    remove: invoke('accounts:remove'),
    select: invoke('accounts:select')
  },
  settings: {
    get: invoke('settings:get'),
    set: invoke('settings:set')
  },
  on: {
    task: subscribe('task'),
    log: subscribe('game:log'),
    game: subscribe('game:state'),
    deviceCode: subscribe('auth:deviceCode')
  }
}

contextBridge.exposeInMainWorld('moon', api)
