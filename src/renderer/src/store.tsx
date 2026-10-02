import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AccountsState, GameLogLine, Instance, Settings, TaskProgress } from '@shared/types'
import type { FileKind } from '@shared/api'
import { errorMessage } from './format'

export type Route =
  | { page: 'home' }
  | { page: 'instances' }
  | { page: 'instance'; id: string; tab?: 'mods' | 'resourcepacks' | 'shaders' | 'logs' | 'settings' }
  | { page: 'browse'; kind?: 'mod' | 'modpack' | 'resourcepack' | 'shader'; targetId?: string }
  | { page: 'accounts' }
  | { page: 'settings' }

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
}

interface Store {
  route: Route
  navigate(route: Route): void
  instances: Instance[]
  refreshInstances(): Promise<void>
  selectedInstanceId?: string
  selectInstance(id: string): void
  accounts: AccountsState
  refreshAccounts(): Promise<void>
  settings?: Settings
  saveSettings(patch: Partial<Settings>): Promise<void>
  running: Set<string>
  launching: Set<string>
  launch(id: string): Promise<void>
  tasks: TaskProgress[]
  dismissTask(id: string): void
  logs: Record<string, GameLogLine[]>
  clearLogs(id: string): void
  toasts: Toast[]
  toast(text: string, kind?: Toast['kind']): void
  /** Runs an async action and shows its error as a toast. */
  attempt<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined>
}

const StoreContext = createContext<Store | null>(null)
const MAX_LOG_LINES = 3000
const SELECTED_KEY = 'moon:selectedInstance'

export const KIND_TO_TAB: Record<FileKind, 'mods' | 'resourcepacks' | 'shaders'> = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaders'
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>({ page: 'home' })
  const [instances, setInstances] = useState<Instance[]>([])
  const [selectedInstanceId, setSelected] = useState<string | undefined>(() => {
    try {
      return localStorage.getItem(SELECTED_KEY) ?? undefined
    } catch {
      return undefined
    }
  })
  const [accounts, setAccounts] = useState<AccountsState>({ accounts: [] })
  const [settings, setSettings] = useState<Settings>()
  const [running, setRunning] = useState<Set<string>>(new Set())
  const [launching, setLaunching] = useState<Set<string>>(new Set())
  const [tasks, setTasks] = useState<TaskProgress[]>([])
  const [logs, setLogs] = useState<Record<string, GameLogLine[]>>({})
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++toastId.current
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 4500)
  }, [])

  const attempt = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string) => {
      try {
        const result = await fn()
        if (success) toast(success, 'success')
        return result
      } catch (e) {
        toast(errorMessage(e), 'error')
        return undefined
      }
    },
    [toast]
  )

  const refreshInstances = useCallback(async () => {
    setInstances(await window.moon.instances.list())
  }, [])
  const refreshAccounts = useCallback(async () => {
    setAccounts(await window.moon.accounts.state())
  }, [])

  const selectInstance = useCallback((id: string) => {
    setSelected(id)
    try {
      localStorage.setItem(SELECTED_KEY, id)
    } catch {
      // Not critical.
    }
  }, [])

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings(await window.moon.settings.set(patch))
  }, [])

  const launch = useCallback(
    async (id: string) => {
      setLaunching((s) => new Set(s).add(id))
      selectInstance(id)
      try {
        await window.moon.instances.launch(id)
      } catch (e) {
        toast(errorMessage(e), 'error')
      } finally {
        setLaunching((s) => {
          const next = new Set(s)
          next.delete(id)
          return next
        })
        void refreshInstances()
      }
    },
    [refreshInstances, selectInstance, toast]
  )

  useEffect(() => {
    void refreshInstances()
    void refreshAccounts()
    void window.moon.settings.get().then(setSettings)
    void window.moon.instances.running().then((ids) => setRunning(new Set(ids)))

    const offTask = window.moon.on.task((t) => {
      setTasks((list) => {
        const rest = list.filter((x) => x.id !== t.id)
        return [...rest, t]
      })
      if (t.state === 'done') setTimeout(() => setTasks((list) => list.filter((x) => x.id !== t.id)), 2500)
    })
    // Batch log lines per animation frame: modded games can print thousands of lines.
    let pending: GameLogLine[] = []
    let frame = 0
    const offLog = window.moon.on.log((line) => {
      pending.push(line)
      if (frame) return
      frame = requestAnimationFrame(() => {
        const batch = pending
        pending = []
        frame = 0
        setLogs((all) => {
          const next = { ...all }
          for (const l of batch) next[l.instanceId] = [...(next[l.instanceId] ?? []), l]
          for (const id of new Set(batch.map((l) => l.instanceId))) {
            if (next[id].length > MAX_LOG_LINES) next[id] = next[id].slice(-MAX_LOG_LINES)
          }
          return next
        })
      })
    })
    const offGame = window.moon.on.game((s) => {
      setRunning((set) => {
        const next = new Set(set)
        if (s.running) next.add(s.instanceId)
        else next.delete(s.instanceId)
        return next
      })
      if (!s.running && s.exitCode && s.exitCode !== 0) {
        toast(`Minecraft wurde mit Fehlercode ${s.exitCode} beendet – siehe Logs.`, 'error')
      }
      if (!s.running) void refreshInstances()
    })
    return () => {
      offTask()
      offLog()
      offGame()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [refreshAccounts, refreshInstances, toast])

  const value = useMemo<Store>(
    () => ({
      route,
      navigate: setRoute,
      instances,
      refreshInstances,
      selectedInstanceId: instances.some((i) => i.id === selectedInstanceId) ? selectedInstanceId : instances[0]?.id,
      selectInstance,
      accounts,
      refreshAccounts,
      settings,
      saveSettings,
      running,
      launching,
      launch,
      tasks,
      dismissTask: (id) => setTasks((list) => list.filter((t) => t.id !== id)),
      logs,
      clearLogs: (id) => setLogs((all) => ({ ...all, [id]: [] })),
      toasts,
      toast,
      attempt
    }),
    [
      route,
      instances,
      refreshInstances,
      selectedInstanceId,
      selectInstance,
      accounts,
      refreshAccounts,
      settings,
      saveSettings,
      running,
      launching,
      launch,
      tasks,
      logs,
      toasts,
      toast,
      attempt
    ]
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): Store {
  const store = useContext(StoreContext)
  if (!store) throw new Error('useStore outside StoreProvider')
  return store
}
