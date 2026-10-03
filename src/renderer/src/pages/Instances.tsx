import { useMemo, useState } from 'react'
import { FileUp, Layers, Play, Plus, Search, Square } from 'lucide-react'
import { LOADER_LABELS } from '@shared/types'
import { CreateInstanceModal } from '../components/CreateInstanceModal'
import { InstanceIcon } from '../components/InstanceIcon'
import { Button, Empty } from '../components/ui'
import { formatPlayTime, formatRelative } from '../format'
import { useStore } from '../store'

export function Instances() {
  const { instances, navigate, launch, running, launching, refreshInstances, attempt } = useStore()
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [filter, setFilter] = useState('')

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? instances.filter((i) => `${i.name} ${i.mcVersion} ${i.loader}`.toLowerCase().includes(q)) : instances
  }, [instances, filter])

  const importPack = async () => {
    setImporting(true)
    const result = await attempt(() => window.moon.instances.importModpack())
    setImporting(false)
    if (!result) return
    await refreshInstances()
    navigate({ page: 'instance', id: result.instance.id })
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Instanzen</h1>
          <p className="muted">Jede Instanz hat eigene Mods, Welten und Einstellungen.</p>
        </div>
        <div className="actions">
          <Button variant="ghost" icon={<FileUp size={17} />} onClick={importPack} loading={importing}>
            Modpack importieren
          </Button>
          <Button variant="primary" icon={<Plus size={17} />} onClick={() => setCreating(true)}>
            Neue Instanz
          </Button>
        </div>
      </header>

      {instances.length > 0 && (
        <div className="searchbar">
          <Search size={17} />
          <input placeholder="Instanzen filtern…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      )}

      {instances.length === 0 ? (
        <Empty icon={<Layers size={30} />} title="Noch keine Instanzen">
          Erstelle eine neue Instanz oder installiere ein Modpack unter „Entdecken".
        </Empty>
      ) : (
        <div className="card-grid large">
          {shown.map((i) => {
            const isRunning = running.has(i.id)
            return (
              <div key={i.id} className="instance-card tall" onClick={() => navigate({ page: 'instance', id: i.id })}>
                <div className="instance-card-top">
                  <InstanceIcon instance={i} size={60} />
                  <button
                    className={`round-play ${isRunning ? 'stop' : ''}`}
                    aria-label={isRunning ? 'Beenden' : 'Spielen'}
                    disabled={launching.has(i.id)}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (isRunning) void window.moon.instances.kill(i.id)
                      else void launch(i.id)
                    }}
                  >
                    {isRunning ? <Square size={16} /> : <Play size={18} fill="currentColor" />}
                  </button>
                </div>
                <strong>{i.name}</strong>
                <div className="chips">
                  <span className={`chip loader-chip loader-${i.loader}`}>{LOADER_LABELS[i.loader]}</span>
                  <span className="chip">{i.mcVersion}</span>
                  {i.source && <span className="chip muted-chip">{i.source.platform === 'modrinth' ? 'Modrinth' : 'CurseForge'}</span>}
                </div>
                <small className="muted">
                  {isRunning ? <span className="live-dot">Läuft</span> : `Gespielt ${formatRelative(i.lastPlayed)}`} ·{' '}
                  {formatPlayTime(i.playTimeMs)}
                </small>
              </div>
            )
          })}
        </div>
      )}
      {creating && <CreateInstanceModal onClose={() => setCreating(false)} />}
    </div>
  )
}
