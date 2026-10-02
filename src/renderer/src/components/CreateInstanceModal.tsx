import { useEffect, useMemo, useState } from 'react'
import { LOADER_LABELS, type LoaderType, type LoaderVersion, type MinecraftVersion } from '@shared/types'
import { errorMessage } from '../format'
import { useStore } from '../store'
import { LoaderIcon } from './InstanceIcon'
import { Modal } from './Modal'
import { Button, Field, Spinner, Toggle } from './ui'

const LOADERS: LoaderType[] = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']

export function CreateInstanceModal({ onClose }: { onClose(): void }) {
  const { refreshInstances, navigate, toast, settings } = useStore()
  const [name, setName] = useState('')
  const [loader, setLoader] = useState<LoaderType>('fabric')
  const [allVersions, setAllVersions] = useState<MinecraftVersion[]>([])
  const [supported, setSupported] = useState<string[] | null>(null)
  const [mcVersion, setMcVersion] = useState('')
  const [snapshots, setSnapshots] = useState(settings?.showSnapshots ?? false)
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[]>([])
  const [loaderVersion, setLoaderVersion] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingLoader, setLoadingLoader] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    window.moon.versions
      .minecraft()
      .then(setAllVersions)
      .catch((e) => setError(errorMessage(e)))
  }, [])

  useEffect(() => {
    setLoading(true)
    setSupported(null)
    window.moon.versions
      .loaderGameVersions(loader)
      .then(setSupported)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false))
  }, [loader])

  const versions = useMemo(() => {
    const allowed = supported && new Set(supported)
    return allVersions.filter(
      (v) => (snapshots || v.type === 'release') && (!allowed || allowed.has(v.id))
    )
  }, [allVersions, supported, snapshots])

  // Keep the selected Minecraft version valid when the loader or filter changes.
  useEffect(() => {
    if (versions.length && !versions.some((v) => v.id === mcVersion)) setMcVersion(versions[0].id)
  }, [versions, mcVersion])

  useEffect(() => {
    setLoaderVersions([])
    setLoaderVersion('')
    if (loader === 'vanilla' || !mcVersion) return
    setLoadingLoader(true)
    window.moon.versions
      .loaderVersions(loader, mcVersion)
      .then((list) => {
        setLoaderVersions(list)
        const pick = list.find((v) => v.recommended) ?? list.find((v) => v.stable) ?? list[0]
        setLoaderVersion(pick?.version ?? '')
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoadingLoader(false))
  }, [loader, mcVersion])

  const create = async () => {
    setCreating(true)
    try {
      const inst = await window.moon.instances.create({
        name: name.trim() || `${LOADER_LABELS[loader]} ${mcVersion}`,
        mcVersion,
        loader,
        loaderVersion: loader === 'vanilla' ? undefined : loaderVersion || undefined
      })
      await refreshInstances()
      toast(`„${inst.name}" wurde erstellt`, 'success')
      onClose()
      navigate({ page: 'instance', id: inst.id })
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setCreating(false)
    }
  }

  const canCreate = mcVersion && (loader === 'vanilla' || loaderVersion) && !creating

  return (
    <Modal
      title="Neue Instanz"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button variant="primary" onClick={create} disabled={!canCreate} loading={creating}>
            Erstellen
          </Button>
        </>
      }
    >
      <Field label="Name">
        <input
          autoFocus
          value={name}
          placeholder={mcVersion ? `${LOADER_LABELS[loader]} ${mcVersion}` : 'Meine Welt'}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
        />
      </Field>

      <Field label="Mod-Loader">
        <div className="loader-grid">
          {LOADERS.map((l) => (
            <button key={l} className={`loader-option loader-${l} ${loader === l ? 'active' : ''}`} onClick={() => setLoader(l)}>
              <LoaderIcon loader={l} size={20} />
              <span>{LOADER_LABELS[l]}</span>
            </button>
          ))}
        </div>
      </Field>

      <div className="field-row">
        <Field label="Minecraft-Version">
          {loading ? (
            <div className="select-placeholder">
              <Spinner size={16} /> Lädt…
            </div>
          ) : (
            <select value={mcVersion} onChange={(e) => setMcVersion(e.target.value)}>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.id}
                  {v.type !== 'release' ? ` (${v.type === 'snapshot' ? 'Snapshot' : 'Alt'})` : ''}
                </option>
              ))}
            </select>
          )}
        </Field>
        {loader !== 'vanilla' && (
          <Field label={`${LOADER_LABELS[loader]}-Version`}>
            {loadingLoader ? (
              <div className="select-placeholder">
                <Spinner size={16} /> Lädt…
              </div>
            ) : loaderVersions.length ? (
              <select value={loaderVersion} onChange={(e) => setLoaderVersion(e.target.value)}>
                {loaderVersions.map((v) => (
                  <option key={v.version} value={v.version}>
                    {v.version}
                    {v.recommended ? ' ★ empfohlen' : v.stable ? '' : ' (Beta)'}
                  </option>
                ))}
              </select>
            ) : (
              <div className="select-placeholder muted">Keine Versionen</div>
            )}
          </Field>
        )}
      </div>

      <div className="inline-toggle">
        <Toggle checked={snapshots} onChange={setSnapshots} label="Snapshots anzeigen" />
        <span>Snapshots &amp; alte Versionen anzeigen</span>
      </div>

      {error && <p className="error-text">{error}</p>}
    </Modal>
  )
}
