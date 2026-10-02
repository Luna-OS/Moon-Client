import type { ChildProcess } from 'node:child_process'
import type { GameLogLine, GameState } from '../shared/types'
import { launchAuth } from './accounts'
import { getInstance, updateInstance } from './core/instances'
import { buildLaunchArgs, ensureGameDirs, prepareInstance, spawnGame } from './core/launch'
import { paths } from './core/paths'
import { GameLogParser } from './logparser'
import { getSettings } from './settings'
import { runTask } from './tasks'

interface GameEvents {
  log(line: GameLogLine): void
  state(state: GameState): void
  /** Called when the game starts/stops so the window can hide/show itself. */
  visibility(hide: boolean): void
}

const running = new Map<string, ChildProcess>()
const launching = new Set<string>()

export const runningInstances = () => [...running.keys()]

export async function launchInstance(id: string, events: GameEvents): Promise<void> {
  if (running.has(id) || launching.has(id)) throw new Error('Diese Instanz läuft bereits')
  launching.add(id)
  const log = (line: string, stream: GameLogLine['stream'] = 'launcher') => events.log({ instanceId: id, line, stream })
  try {
    const inst = await getInstance(id)
    const settings = await getSettings()
    const auth = await launchAuth()
    await ensureGameDirs(id)

    const prepared = await runTask(`${inst.name} wird vorbereitet`, (task) =>
      prepareInstance(inst, settings, (step, c, t) => task.update(step, c, t), (l) => log(l))
    )
    const args = buildLaunchArgs(inst, settings, prepared, auth)
    log(`Starte ${prepared.version.id} mit ${prepared.java}`)

    const child = spawnGame(prepared.java, args, paths.instanceDir(id))
    running.set(id, child)
    const startedAt = Date.now()
    events.state({ instanceId: id, running: true })
    if (settings.closeOnLaunch) events.visibility(true)

    const stdout = new GameLogParser((l) => log(l, 'stdout'))
    const stderr = new GameLogParser((l) => log(l, 'stderr'))
    child.stdout?.setEncoding('utf8').on('data', (d: string) => stdout.push(d))
    child.stderr?.setEncoding('utf8').on('data', (d: string) => stderr.push(d))
    child.on('error', (e) => log(`Fehler beim Starten: ${e.message}`))
    child.on('close', async (code) => {
      stdout.flush()
      stderr.flush()
      running.delete(id)
      log(`Spiel beendet (Code ${code})`)
      events.state({ instanceId: id, running: false, exitCode: code })
      if (settings.closeOnLaunch) events.visibility(false)
      const latest = await getInstance(id).catch(() => undefined)
      if (latest) {
        await updateInstance(id, {
          lastPlayed: Date.now(),
          playTimeMs: (latest.playTimeMs ?? 0) + (Date.now() - startedAt)
        }).catch(() => undefined)
      }
    })
    await updateInstance(id, { lastPlayed: Date.now() })
  } catch (e) {
    log(`Start fehlgeschlagen: ${(e as Error).message}`)
    throw e
  } finally {
    launching.delete(id)
  }
}

export function killInstance(id: string): void {
  running.get(id)?.kill()
}
