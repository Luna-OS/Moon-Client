import fsp from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { FileKind } from '../shared/api'
import type { ContentKind, ContentSearchQuery, Instance, LoaderType, NewInstance, Platform, Settings } from '../shared/types'
import { accountsState, addOfflineAccount, cancelLogin, loginMicrosoft, removeAccount, selectAccount } from './accounts'
import { contentVersions, importModpackFile, installContent, installModpack, searchContent } from './core/content'
import { LAUNCHER_VERSION } from './core/http'
import {
  contentDir,
  createInstance,
  deleteContent,
  deleteInstance,
  getInstance,
  listContent,
  listInstances,
  setContentEnabled,
  updateInstance
} from './core/instances'
import { listLoaderVersions, loaderGameVersions } from './core/loaders'
import { paths } from './core/paths'
import { listMinecraftVersions } from './core/versions'
import { killInstance, launchInstance, runningInstances } from './game'
import { getSettings, updateSettings } from './settings'
import { runTask, setTaskEmitter } from './tasks'

let win: BrowserWindow | undefined

function send(channel: string, payload: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    backgroundColor: '#070912',
    title: 'Moon Client',
    icon: path.join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.on('ready-to-show', () => win?.show())

  // Never navigate the launcher window; open links in the user's browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) e.preventDefault()
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function handle<Args extends unknown[], R>(channel: string, fn: (...args: Args) => Promise<R> | R) {
  ipcMain.handle(channel, (_event, ...args) => fn(...(args as Args)))
}

function registerIpc() {
  setTaskEmitter((t) => send('task', t))

  handle('app:version', () => LAUNCHER_VERSION)
  handle('app:openExternal', async (url: string) => {
    if (!/^https:\/\//.test(url)) throw new Error('Nur https-Links werden geöffnet')
    await shell.openExternal(url)
  })
  handle('app:dataDir', () => paths.root)
  handle('app:openDataDir', async () => {
    await shell.openPath(paths.root)
  })
  ipcMain.on('app:window', (_e, action: 'minimize' | 'maximize' | 'close') => {
    if (!win) return
    if (action === 'minimize') win.minimize()
    else if (action === 'maximize') (win.isMaximized() ? win.unmaximize() : win.maximize())
    else win.close()
  })

  handle('versions:minecraft', () => listMinecraftVersions())
  handle('versions:loaderGame', async (loader: LoaderType) => (await loaderGameVersions(loader)) ?? null)
  handle('versions:loader', (loader: LoaderType, mc: string) => listLoaderVersions(loader, mc))

  handle('instances:list', () => listInstances())
  handle('instances:create', (data: NewInstance) => createInstance(data))
  handle('instances:update', (id: string, patch: Partial<Instance>) => updateInstance(id, patch))
  handle('instances:remove', async (id: string) => {
    if (runningInstances().includes(id)) throw new Error('Die Instanz läuft gerade')
    await deleteInstance(id)
  })
  handle('instances:openFolder', async (id: string, sub?: string) => {
    const dir = sub ? path.join(paths.instanceDir(id), path.basename(sub)) : paths.instanceDir(id)
    await fsp.mkdir(dir, { recursive: true })
    await shell.openPath(dir)
  })
  handle('instances:content', (id: string, kind: FileKind) => listContent(id, kind))
  handle('instances:setContentEnabled', (id: string, kind: FileKind, file: string, enabled: boolean) =>
    setContentEnabled(id, kind, path.basename(file), enabled)
  )
  handle('instances:deleteContent', (id: string, kind: FileKind, file: string) => deleteContent(id, kind, file))
  handle('instances:addLocalContent', async (id: string, kind: FileKind) => {
    const result = await dialog.showOpenDialog(win!, {
      title: 'Dateien hinzufügen',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: kind === 'mod' ? 'Mods' : 'Pakete', extensions: kind === 'mod' ? ['jar'] : ['zip'] }]
    })
    if (result.canceled) return 0
    const dir = contentDir(id, kind)
    await fsp.mkdir(dir, { recursive: true })
    for (const file of result.filePaths) await fsp.copyFile(file, path.join(dir, path.basename(file)))
    return result.filePaths.length
  })
  handle('instances:importModpack', async () => {
    const result = await dialog.showOpenDialog(win!, {
      title: 'Modpack importieren',
      properties: ['openFile'],
      filters: [{ name: 'Modpacks', extensions: ['mrpack', 'zip'] }]
    })
    if (result.canceled || !result.filePaths[0]) return null
    const file = result.filePaths[0]
    const settings = await getSettings()
    return runTask(`Importiere ${path.basename(file)}`, (task) =>
      importModpackFile(settings, file, (c, t) => task.update('Dateien werden geladen', c, t))
    )
  })
  handle('instances:launch', (id: string) =>
    launchInstance(id, {
      log: (l) => send('game:log', l),
      state: (s) => send('game:state', s),
      visibility: (hide) => (hide ? win?.hide() : win?.show())
    })
  )
  handle('instances:kill', (id: string) => killInstance(id))
  handle('instances:running', () => runningInstances())

  handle('content:search', async (q: ContentSearchQuery) => searchContent(await getSettings(), q))
  handle(
    'content:versions',
    async (platform: Platform, projectId: string, kind: ContentKind, mc?: string, loader?: LoaderType) =>
      contentVersions(await getSettings(), platform, projectId, kind, mc, loader)
  )
  handle(
    'content:install',
    async (instanceId: string, platform: Platform, kind: FileKind, projectId: string, title: string, versionId?: string) => {
      const [settings, inst] = await Promise.all([getSettings(), getInstance(instanceId)])
      return runTask(`${title} → ${inst.name}`, (task) =>
        installContent(settings, inst, platform, kind, projectId, versionId, (_c, _t, d) =>
          task.update(d ? `${d} installiert` : 'Wird installiert')
        )
      )
    }
  )
  handle('content:installModpack', async (platform: Platform, projectId: string, title: string, versionId?: string) => {
    const settings = await getSettings()
    return runTask(`Modpack ${title}`, (task) =>
      installModpack(settings, platform, projectId, versionId, (c, t) => task.update('Dateien werden geladen', c, t))
    )
  })

  handle('accounts:state', () => accountsState())
  handle('accounts:loginMicrosoft', () => loginMicrosoft((info) => send('auth:deviceCode', info)))
  handle('accounts:cancelLogin', () => cancelLogin())
  handle('accounts:addOffline', (name: string) => addOfflineAccount(name))
  handle('accounts:remove', (id: string) => removeAccount(id))
  handle('accounts:select', (id: string) => selectAccount(id))

  handle('settings:get', () => getSettings())
  handle('settings:set', (patch: Partial<Settings>) => updateSettings(patch))
}

paths.setRoot(process.env.MOON_DATA_DIR || path.join(app.getPath('appData'), '.moonclient'))

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  void app.whenReady().then(() => {
    app.setAppUserModelId('os.luna.moonclient')
    registerIpc()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
