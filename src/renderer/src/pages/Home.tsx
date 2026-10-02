import { useState } from 'react'
import { ChevronDown, Compass, Package, Play, Plus, Square } from 'lucide-react'
import { LOADER_LABELS } from '@shared/types'
import { CreateInstanceModal } from '../components/CreateInstanceModal'
import { InstanceIcon } from '../components/InstanceIcon'
import { MoonLogo } from '../components/MoonLogo'
import { Button } from '../components/ui'
import { formatPlayTime, formatRelative, greeting } from '../format'
import { useStore } from '../store'

export function Home() {
  const { instances, selectedInstanceId, selectInstance, launch, running, launching, navigate, accounts } = useStore()
  const [creating, setCreating] = useState(false)
  const [picker, setPicker] = useState(false)
  const selected = instances.find((i) => i.id === selectedInstanceId)
  const account = accounts.accounts.find((a) => a.id === accounts.selectedId)
  const isRunning = selected && running.has(selected.id)
  const isLaunching = selected && launching.has(selected.id)

  return (
    <div className="page home">
      <section className="hero">
        <div className="hero-moon" aria-hidden="true">
          <MoonLogo size={420} />
        </div>
        <div className="hero-content">
          <p className="eyebrow">{greeting()}{account ? `, ${account.name}` : ''}</p>
          <h1>
            Bereit für die <span className="gradient-text">Mondlandung?</span>
          </h1>
          <p className="muted hero-sub">
            Vanilla, Fabric, Quilt, Forge und NeoForge – Mods und Modpacks von Modrinth und CurseForge mit einem Klick.
          </p>

          {selected ? (
            <div className="play-card">
              <button className="play-instance" onClick={() => setPicker((p) => !p)}>
                <InstanceIcon instance={selected} size={44} />
                <div>
                  <strong>{selected.name}</strong>
                  <small>
                    {LOADER_LABELS[selected.loader]} · {selected.mcVersion}
                  </small>
                </div>
                <ChevronDown size={18} className="muted" />
              </button>
              {isRunning ? (
                <Button variant="danger" className="play-btn" icon={<Square size={18} />} onClick={() => window.moon.instances.kill(selected.id)}>
                  BEENDEN
                </Button>
              ) : (
                <Button
                  variant="primary"
                  className="play-btn"
                  icon={<Play size={20} fill="currentColor" />}
                  loading={Boolean(isLaunching)}
                  onClick={() => launch(selected.id)}
                >
                  {isLaunching ? 'STARTET…' : 'SPIELEN'}
                </Button>
              )}
              {picker && (
                <div className="instance-picker" onMouseLeave={() => setPicker(false)}>
                  {instances.map((i) => (
                    <button
                      key={i.id}
                      className={i.id === selected.id ? 'active' : ''}
                      onClick={() => {
                        selectInstance(i.id)
                        setPicker(false)
                      }}
                    >
                      <InstanceIcon instance={i} size={28} />
                      <span>{i.name}</span>
                      <small className="muted">
                        {LOADER_LABELS[i.loader]} {i.mcVersion}
                      </small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="hero-actions">
              <Button variant="primary" icon={<Plus size={18} />} onClick={() => setCreating(true)}>
                Erste Instanz erstellen
              </Button>
              <Button variant="ghost" icon={<Package size={18} />} onClick={() => navigate({ page: 'browse', kind: 'modpack' })}>
                Modpack installieren
              </Button>
            </div>
          )}
        </div>
      </section>

      {instances.length > 0 && (
        <section>
          <div className="section-head">
            <h2>Zuletzt gespielt</h2>
            <Button variant="ghost" onClick={() => navigate({ page: 'instances' })}>
              Alle Instanzen
            </Button>
          </div>
          <div className="card-grid">
            {instances.slice(0, 6).map((i) => (
              <button key={i.id} className="instance-card" onClick={() => navigate({ page: 'instance', id: i.id })}>
                <InstanceIcon instance={i} size={52} />
                <div className="instance-card-body">
                  <strong>{i.name}</strong>
                  <small>
                    {LOADER_LABELS[i.loader]} · {i.mcVersion}
                  </small>
                  <small className="muted">
                    {running.has(i.id) ? <span className="live-dot">Läuft</span> : `Gespielt ${formatRelative(i.lastPlayed)}`}
                    {' · '}
                    {formatPlayTime(i.playTimeMs)}
                  </small>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="quick-links">
        <button className="quick-link" onClick={() => navigate({ page: 'browse', kind: 'modpack' })}>
          <Package size={22} />
          <div>
            <strong>Modpacks entdecken</strong>
            <small className="muted">Tausende Packs von Modrinth &amp; CurseForge</small>
          </div>
        </button>
        <button className="quick-link" onClick={() => navigate({ page: 'browse', kind: 'mod' })}>
          <Compass size={22} />
          <div>
            <strong>Mods durchsuchen</strong>
            <small className="muted">Inklusive automatischer Abhängigkeiten</small>
          </div>
        </button>
        <button className="quick-link" onClick={() => setCreating(true)}>
          <Plus size={22} />
          <div>
            <strong>Neue Instanz</strong>
            <small className="muted">Vanilla, Fabric, Quilt, Forge, NeoForge</small>
          </div>
        </button>
      </section>

      {creating && <CreateInstanceModal onClose={() => setCreating(false)} />}
    </div>
  )
}
