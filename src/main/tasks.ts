import { randomUUID } from 'node:crypto'
import type { TaskProgress } from '../shared/types'

type Emit = (t: TaskProgress) => void
let emit: Emit = () => {}

export function setTaskEmitter(fn: Emit): void {
  emit = fn
}

export interface TaskHandle {
  update(detail: string, current?: number, total?: number): void
}

/** Runs `fn` as a visible background task and reports its progress to the renderer. */
export async function runTask<T>(title: string, fn: (task: TaskHandle) => Promise<T>): Promise<T> {
  const state: TaskProgress = { id: randomUUID(), title, current: 0, total: 0, state: 'running' }
  let lastEmit = 0
  const send = (force = false) => {
    const now = Date.now()
    if (!force && now - lastEmit < 100) return // throttle chatty progress updates
    lastEmit = now
    emit({ ...state })
  }
  send(true)
  try {
    const result = await fn({
      update(detail, current = 0, total = 0) {
        const changedStep = detail !== state.detail
        state.detail = detail
        state.current = current
        state.total = total
        send(changedStep || current === total)
      }
    })
    state.state = 'done'
    send(true)
    return result
  } catch (e) {
    state.state = 'error'
    state.error = e instanceof Error ? e.message : String(e)
    send(true)
    throw e
  }
}
