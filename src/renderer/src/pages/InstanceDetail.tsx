import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Copy,
  Download,
  FilePlus,
  FolderOpen,
  Package,
  Play,
  Search,
  Square,
  Trash2
} from 'lucide-react'
import type { FileKind } from '@shared/api'
import { LOADER_LABELS, type InstalledContent, type Instance } from '@shared/types'
import { InstanceIcon } from '../components/InstanceIcon'
import { Modal } from '../components/Modal'
import { RemoteImage } from '../components/RemoteImage'
import { Button, Empty, Field, Spinner, Toggle } from '../components/ui'
import { errorMessage, formatBytes, formatPlayTime, formatRelative } from '../format'
import { useStore, type Route } from '../store'

type Tab = NonNullable<Extract<Route, { page: 'instance' }>['tab']>

const TABS: Array<{ id: Tab; label: string; kind?: FileKind }> = [
  { id: 'mods', label: 'Mods', kind: 'mod' },
  { id: 'resourcepacks', label: 'Ressourcenpakete', kind: 'resourcepack' },
  { id: 'shaders', label: 'Shader', kind: 'shader' },
  { id: 'logs', label: 'Logs' },
  { id: 'settings', label: 'Einstellungen' }
]

const FOLDERS: Record<FileKind, string> = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' }

export function InstanceDetail({ id, tab: initialTab }: { id: string; tab?: Tab }) {
  const { instances, navigate, launch, running, launching } = useStore()
  const [tab, setTab] = useState<Tab>(initialTab ?? 'mods')
  const instance = instances.find((i) => i.id === id)

  useEffect(() => setTab(initialTab ?? 'mods'), [id, initialTab])

  if (!instance) {
    return (
      <div className="page">
        <Empty title="Instanz nicht gefunden">
          <Button variant="ghost" onClick={() => navigate({ page: 'instances' })}>
            Zurück
          </Button>
        </Empty>
      </div>
    )
  }

  const isRunning = running.has(id)
  const current = TABS.find((t) => t.id === tab)!
  const modsAllowed = instance.loader !== 'vanilla'

  return (
    <div className="page">
      <button className="back-link" onClick={() => navigate({ page: 'instances' })}>
        <ArrowLeft size={16} /> Instanzen
      </button>
      <header className="instance-head">
        <InstanceIcon instance={instance} size={76} />
        <div className="instance-head-info">
          <h1>{instance.name}</h1>
          <div className="chips">
            <span className={`chip loader-chip loader-${instance.loader}`}>
              {LOADER_LABELS[instance.loader]}
              {instance.loaderVersion ? ` ${instance.loaderVersion}` : ''}
            </span>
            <span className="chip">Minecraft {instance.mcVersion}</span>
            {instance.source && <span className="chip muted-chip">aus {instance.source.name}</span>}
          </div>
          <small className="muted">
            Gespielt {formatRelative(instance.lastPlayed)} · Spielzeit {formatPlayTime(instance.playTimeMs)}
          </small>
        </div>
        <div className="actions">
          <Button variant="ghost" icon={<FolderOpen size={17} />} onClick={() => window.moon.instances.openFolder(id)}>
            Ordner
          </Button>
          {isRunning ? (
            <Button variant="danger" icon={<Square size={17} />} onClick={() => window.moon.instances.kill(id)}>
              Beenden
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={<Play size={18} fill="currentColor" />}
              loading={launching.has(id)}
              onClick={() => {
                setTab('logs')
                void launch(id)
              }}
            >
              Spielen
            </Button>
          )}
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={t.id === tab ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {current.kind &&
        (current.kind === 'mod' && !modsAllowed ? (
          <Empty icon={<Package size={28} />} title="Vanilla unterstützt keine Mods">
            Erstelle eine Instanz mit Fabric, Quilt, Forge oder NeoForge, um Mods zu nutzen.
          </Empty>
        ) : (
          <ContentTab instance={instance} kind={current.kind} />
        ))}
      {tab === 'logs' && <LogsTab instance={instance} />}
      {tab === 'settings' && <SettingsTab instance={instance} />}
    </div>
  )
}

function ContentTab({ instance, kind }: { instance: Instance; kind: FileKind }) {
  const { navigate, attempt, tasks } = useStore()
  const [items, setItems] = useState<InstalledContent[]>()
  const [filter, setFilter] = useState('')

  const load = useCallback(async () => {
    setItems(await window.moon.instances.content(instance.id, kind).catch(() => []))
  }, [instance.id, kind])

  useEffect(() => {
    setItems(undefined)
    void load()
  }, [load])

  // Reload when an install task finishes.
  const doneCount = tasks.filter((t) => t.state === 'done').length
  useEffect(() => {
    if (doneCount) void load()
  }, [doneCount, load])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return (items ?? []).filter((i) => !q || `${i.meta?.title ?? ''} ${i.fileName}`.toLowerCase().includes(q))
  }, [items, filter])

  const label = kind === 'mod' ? 'Mods' : kind === 'resourcepack' ? 'Ressourcenpakete' : 'Shader'

  return (
    <div className="content-tab">
      <div className="toolbar">
        <div className="searchbar compact">
          <Search size={16} />
          <input placeholder={`${label} filtern…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="actions">
          <Button variant="ghost" icon={<FolderOpen size={16} />} onClick={() => window.moon.instances.openFolder(instance.id, FOLDERS[kind])}>
            Ordner
          </Button>
          <Button
            variant="ghost"
            icon={<FilePlus size={16} />}
            onClick={async () => {
              const n = await attempt(() => window.moon.instances.addLocalContent(instance.id, kind))
              if (n) void load()
            }}
          >
            Datei hinzufügen
          </Button>
          <Button variant="primary" icon={<Download size={16} />} onClick={() => navigate({ page: 'browse', kind, targetId: instance.id })}>
            {label} herunterladen
          </Button>
        </div>
      </div>

      {!items ? (
        <div className="center-pad">
          <Spinner />
        </div>
      ) : items.length === 0 ? (
        <Empty icon={<Package size={28} />} title={`Noch keine ${label} installiert`}>
          Durchsuche Modrinth und CurseForge oder ziehe Dateien in den Ordner.
        </Empty>
      ) : (
        <div className="content-list">
          {shown.map((item) => (
            <div key={item.fileName} className={`content-row ${item.enabled ? '' : 'disabled'}`}>
              <RemoteImage className="content-icon" src={item.meta?.iconUrl} fallback={<Package size={18} />} />
              <div className="content-main">
                <strong>{item.meta?.title ?? item.fileName.replace(/\.(jar|zip)(\.disabled)?$/i, '')}</strong>
                <small className="muted">
                  {item.meta?.versionNumber ? `${item.meta.versionNumber} · ` : ''}
                  {item.fileName} · {formatBytes(item.size)}
                  {item.meta && ` · ${item.meta.platform === 'modrinth' ? 'Modrinth' : 'CurseForge'}`}
                </small>
              </div>
              <Toggle
                checked={item.enabled}
                label="Aktiviert"
                onChange={async (enabled) => {
                  await attempt(() => window.moon.instances.setContentEnabled(instance.id, kind, item.fileName, enabled))
                  void load()
                }}
              />
              <button
                className="icon-btn danger"
                aria-label="Löschen"
                onClick={async () => {
                  await attempt(() => window.moon.instances.deleteContent(instance.id, kind, item.fileName))
                  void load()
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LogsTab({ instance }: { instance: Instance }) {
  const { logs, clearLogs, toast } = useStore()
  const lines = logs[instance.id] ?? []
  const ref = useRef<HTMLDivElement>(null)
  const [follow, setFollow] = useState(true)

  useEffect(() => {
    if (follow && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [lines, follow])

  return (
    <div className="logs-tab">
      <div className="toolbar">
        <div className="inline-toggle">
          <Toggle checked={follow} onChange={setFollow} label="Automatisch scrollen" />
          <span>Automatisch scrollen</span>
        </div>
        <div className="actions">
          <Button
            variant="ghost"
            icon={<Copy size={16} />}
            onClick={async () => {
              await navigator.clipboard.writeText(lines.map((l) => l.line).join('\n'))
              toast('Log kopiert', 'success')
            }}
          >
            Kopieren
          </Button>
          <Button variant="ghost" icon={<FolderOpen size={16} />} onClick={() => window.moon.instances.openFolder(instance.id, 'logs')}>
            Log-Ordner
          </Button>
          <Button variant="ghost" icon={<Trash2 size={16} />} onClick={() => clearLogs(instance.id)}>
            Leeren
          </Button>
        </div>
      </div>
      <div className="console" ref={ref}>
        {lines.length === 0 ? (
          <span className="muted">Starte die Instanz, um hier die Ausgabe des Spiels zu sehen.</span>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={`log-line ${l.stream} ${/\/(ERROR|FATAL)\]|Exception|^\s+at /.test(l.line) ? 'err' : /\/WARN\]/.test(l.line) ? 'warn' : ''}`}>
              {l.line}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function SettingsTab({ instance }: { instance: Instance }) {
  const { refreshInstances, navigate, toast, settings, running } = useStore()
  const [form, setForm] = useState({
    name: instance.name,
    memoryMb: instance.memoryMb ?? 0,
    javaPath: instance.javaPath ?? '',
    jvmArgs: instance.jvmArgs ?? '',
    width: instance.width ?? 0,
    height: instance.height ?? 0
  })
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await window.moon.instances.update(instance.id, {
        name: form.name.trim() || instance.name,
        memoryMb: form.memoryMb || undefined,
        javaPath: form.javaPath.trim() || undefined,
        jvmArgs: form.jvmArgs.trim() || undefined,
        width: form.width || undefined,
        height: form.height || undefined
      })
      await refreshInstances()
      toast('Gespeichert', 'success')
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    try {
      await window.moon.instances.remove(instance.id)
      await refreshInstances()
      navigate({ page: 'instances' })
      toast(`„${instance.name}" wurde gelöscht`, 'success')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <div className="settings-panel">
      <div className="card">
        <Field label="Name">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} />
        </Field>
        <Field
          label={`Arbeitsspeicher: ${form.memoryMb ? `${(form.memoryMb / 1024).toFixed(1)} GB` : `Standard (${((settings?.memoryMb ?? 4096) / 1024).toFixed(1)} GB)`}`}
        >
          <input
            type="range"
            min={0}
            max={32768}
            step={512}
            value={form.memoryMb}
            onChange={(e) => setForm({ ...form, memoryMb: Number(e.target.value) })}
          />
        </Field>
        <div className="field-row">
          <Field label="Fensterbreite" hint="0 = Standard">
            <input type="number" min={0} value={form.width} onChange={(e) => setForm({ ...form, width: Number(e.target.value) })} />
          </Field>
          <Field label="Fensterhöhe" hint="0 = Standard">
            <input type="number" min={0} value={form.height} onChange={(e) => setForm({ ...form, height: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label="Java-Pfad" hint="Leer lassen, um die passende Java-Version automatisch zu laden.">
          <input value={form.javaPath} placeholder="automatisch" onChange={(e) => setForm({ ...form, javaPath: e.target.value })} />
        </Field>
        <Field label="Zusätzliche JVM-Argumente">
          <input value={form.jvmArgs} placeholder="-XX:+UseG1GC" onChange={(e) => setForm({ ...form, jvmArgs: e.target.value })} />
        </Field>
        <div className="actions end">
          <Button variant="primary" onClick={save} loading={saving}>
            Speichern
          </Button>
        </div>
      </div>

      <div className="card danger-zone">
        <div>
          <strong>Instanz löschen</strong>
          <p className="muted">Löscht alle Welten, Mods und Einstellungen dieser Instanz unwiderruflich.</p>
        </div>
        <Button variant="danger" icon={<Trash2 size={16} />} disabled={running.has(instance.id)} onClick={() => setConfirmDelete(true)}>
          Löschen
        </Button>
      </div>

      {confirmDelete && (
        <Modal
          title="Instanz löschen?"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Abbrechen
              </Button>
              <Button variant="danger" onClick={remove}>
                Endgültig löschen
              </Button>
            </>
          }
        >
          <p>
            „{instance.name}" mit allen Welten und Mods wird gelöscht. Das kann nicht rückgängig gemacht werden.
          </p>
        </Modal>
      )}
    </div>
  )
}
