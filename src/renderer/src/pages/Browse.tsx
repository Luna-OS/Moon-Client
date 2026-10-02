import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, ExternalLink, KeyRound, List, Package, Search } from 'lucide-react'
import type { FileKind } from '@shared/api'
import {
  LOADER_LABELS,
  type ContentHit,
  type ContentKind,
  type ContentSearchQuery,
  type ContentVersion,
  type Platform
} from '@shared/types'
import { RemoteImage } from '../components/RemoteImage'
import { VersionPickerModal } from '../components/VersionPickerModal'
import { Button, Empty, Segmented, Spinner } from '../components/ui'
import { errorMessage, formatNumber, formatRelative } from '../format'
import { KIND_TO_TAB, useStore } from '../store'

const KINDS: Array<{ value: ContentKind; label: string }> = [
  { value: 'modpack', label: 'Modpacks' },
  { value: 'mod', label: 'Mods' },
  { value: 'resourcepack', label: 'Ressourcenpakete' },
  { value: 'shader', label: 'Shader' }
]

const SORTS: Array<{ value: ContentSearchQuery['sort']; label: string }> = [
  { value: 'relevance', label: 'Relevanz' },
  { value: 'downloads', label: 'Downloads' },
  { value: 'updated', label: 'Zuletzt aktualisiert' },
  { value: 'newest', label: 'Neueste' }
]

const PAGE_SIZE = 20
const PLATFORM_KEY = 'moon:browsePlatform'

export function Browse({ kind: initialKind, targetId: initialTarget }: { kind?: ContentKind; targetId?: string }) {
  const { instances, settings, navigate, attempt, refreshInstances, toast, selectedInstanceId } = useStore()
  const [platform, setPlatform] = useState<Platform>(() => {
    try {
      return (localStorage.getItem(PLATFORM_KEY) as Platform) || 'modrinth'
    } catch {
      return 'modrinth'
    }
  })
  const [kind, setKind] = useState<ContentKind>(initialKind ?? 'modpack')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [sort, setSort] = useState<ContentSearchQuery['sort']>('relevance')
  const [targetId, setTargetId] = useState<string | undefined>(initialTarget ?? selectedInstanceId)
  const [hits, setHits] = useState<ContentHit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [installing, setInstalling] = useState<Set<string>>(new Set())
  const [picker, setPicker] = useState<ContentHit>()
  const requestId = useRef(0)

  useEffect(() => {
    if (initialKind) setKind(initialKind)
    if (initialTarget) setTargetId(initialTarget)
  }, [initialKind, initialTarget])

  useEffect(() => {
    try {
      localStorage.setItem(PLATFORM_KEY, platform)
    } catch {
      // Not critical.
    }
  }, [platform])

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 350)
    return () => clearTimeout(t)
  }, [query])

  const isModpack = kind === 'modpack'
  const target = isModpack ? undefined : instances.find((i) => i.id === targetId)
  const missingKey = platform === 'curseforge' && !settings?.curseforgeApiKey

  const search = async (offset: number) => {
    const id = ++requestId.current
    setLoading(true)
    setError('')
    try {
      const res = await window.moon.content.search({
        platform,
        kind,
        query: debounced,
        sort,
        offset,
        limit: PAGE_SIZE,
        mcVersion: target?.mcVersion,
        loader: kind === 'mod' ? target?.loader : undefined
      })
      if (id !== requestId.current) return
      setHits((prev) => (offset === 0 ? res.hits : [...prev, ...res.hits]))
      setTotal(res.total)
    } catch (e) {
      if (id === requestId.current) setError(errorMessage(e))
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }

  useEffect(() => {
    setHits([])
    if (missingKey) return
    void search(0)
  }, [platform, kind, debounced, sort, target?.id, missingKey])

  const markInstalling = (id: string, on: boolean) =>
    setInstalling((s) => {
      const next = new Set(s)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const install = async (hit: ContentHit, version?: ContentVersion) => {
    markInstalling(hit.id, true)
    try {
      if (hit.kind === 'modpack') {
        const result = await window.moon.content.installModpack(hit.platform, hit.id, hit.title, version?.id)
        await refreshInstances()
        toast(`„${result.instance.name}" ist bereit!`, 'success')
        for (const w of result.warnings) toast(w, 'error')
        navigate({ page: 'instance', id: result.instance.id })
      } else if (target) {
        const installed = await window.moon.content.install(
          target.id,
          hit.platform,
          hit.kind as FileKind,
          hit.id,
          hit.title,
          version?.id
        )
        toast(
          installed.length > 1
            ? `${installed[0]} + ${installed.length - 1} Abhängigkeit(en) installiert`
            : `${hit.title} installiert`,
          'success'
        )
      }
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      markInstalling(hit.id, false)
    }
  }

  const compatibleInstances = useMemo(
    () => (kind === 'mod' ? instances.filter((i) => i.loader !== 'vanilla') : instances),
    [instances, kind]
  )

  return (
    <div className="page browse">
      <header className="page-head">
        <div>
          <h1>Entdecken</h1>
          <p className="muted">Mods, Modpacks, Ressourcenpakete und Shader von Modrinth &amp; CurseForge.</p>
        </div>
        <Segmented<Platform>
          value={platform}
          onChange={setPlatform}
          options={[
            { value: 'modrinth', label: <span className="platform modrinth">Modrinth</span> },
            { value: 'curseforge', label: <span className="platform curseforge">CurseForge</span> }
          ]}
        />
      </header>

      <div className="browse-controls">
        <Segmented<ContentKind> value={kind} onChange={setKind} options={KINDS} />
        <div className="browse-filters">
          <div className="searchbar">
            <Search size={17} />
            <input
              placeholder={`${KINDS.find((k) => k.value === kind)?.label} suchen…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as ContentSearchQuery['sort'])}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {!isModpack && (
            <select value={target?.id ?? ''} onChange={(e) => setTargetId(e.target.value || undefined)} className="target-select">
              <option value="">Installieren in … (Instanz wählen)</option>
              {compatibleInstances.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} – {LOADER_LABELS[i.loader]} {i.mcVersion}
                </option>
              ))}
            </select>
          )}
        </div>
        {!isModpack && target && (
          <p className="muted small">
            Zeigt nur Inhalte für Minecraft {target.mcVersion}
            {kind === 'mod' ? ` mit ${LOADER_LABELS[target.loader]}` : ''}.{' '}
            <button className="link" onClick={() => navigate({ page: 'instance', id: target.id, tab: KIND_TO_TAB[kind as FileKind] })}>
              Installierte ansehen
            </button>
          </p>
        )}
      </div>

      {missingKey ? (
        <Empty icon={<KeyRound size={28} />} title="CurseForge-API-Key fehlt">
          CurseForge erlaubt den Zugriff nur mit einem (kostenlosen) API-Key von console.curseforge.com.
          <div className="center-pad">
            <Button variant="primary" onClick={() => navigate({ page: 'settings' })}>
              Zu den Einstellungen
            </Button>
          </div>
        </Empty>
      ) : (
        <>
          {error && <p className="error-text">{error}</p>}
          <div className="result-list">
            {hits.map((hit) => (
              <article key={`${hit.platform}-${hit.id}`} className="result-card">
                <RemoteImage className="result-icon" src={hit.iconUrl} fallback={<Package size={26} />} />
                <div className="result-body">
                  <div className="result-title">
                    <h3>{hit.title}</h3>
                    {hit.author && <span className="muted">von {hit.author}</span>}
                  </div>
                  <p className="result-desc">{hit.description}</p>
                  <div className="chips">
                    <span className="chip">
                      <Download size={12} /> {formatNumber(hit.downloads)}
                    </span>
                    {hit.updatedAt && <span className="chip muted-chip">aktualisiert {formatRelative(hit.updatedAt)}</span>}
                    {hit.categories.slice(0, 4).map((c) => (
                      <span key={c} className="chip muted-chip">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="result-actions">
                  <Button
                    variant="primary"
                    icon={<Download size={16} />}
                    loading={installing.has(hit.id)}
                    disabled={!isModpack && !target}
                    title={!isModpack && !target ? 'Wähle zuerst eine Instanz' : undefined}
                    onClick={() => install(hit)}
                  >
                    Installieren
                  </Button>
                  <div className="result-secondary">
                    <button className="icon-btn" title="Versionen" aria-label="Versionen" onClick={() => setPicker(hit)}>
                      <List size={16} />
                    </button>
                    <button className="icon-btn" title="Im Browser öffnen" aria-label="Im Browser öffnen" onClick={() => window.moon.app.openExternal(hit.url)}>
                      <ExternalLink size={16} />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {loading && (
            <div className="center-pad">
              <Spinner size={26} />
            </div>
          )}
          {!loading && hits.length === 0 && !error && (
            <Empty icon={<Search size={28} />} title="Nichts gefunden">
              Versuche einen anderen Suchbegriff{target ? ' oder eine andere Instanz' : ''}.
            </Empty>
          )}
          {!loading && hits.length > 0 && hits.length < total && (
            <div className="center-pad">
              <Button variant="ghost" onClick={() => attempt(() => search(hits.length))}>
                Mehr laden ({formatNumber(total - hits.length)} weitere)
              </Button>
            </div>
          )}
        </>
      )}

      {picker && (
        <VersionPickerModal hit={picker} target={target} onClose={() => setPicker(undefined)} onInstall={(v) => install(picker, v)} />
      )}
    </div>
  )
}
