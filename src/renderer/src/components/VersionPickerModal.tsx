import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import type { ContentHit, ContentVersion, Instance } from '@shared/types'
import { errorMessage, formatNumber, formatRelative } from '../format'
import { Modal } from './Modal'
import { Button, Empty, Spinner, Toggle } from './ui'

const TYPE_LABELS = { release: 'Release', beta: 'Beta', alpha: 'Alpha' }

/** Lists the versions of a project and lets the user install a specific one. */
export function VersionPickerModal({
  hit,
  target,
  onInstall,
  onClose
}: {
  hit: ContentHit
  target?: Instance
  onInstall(version: ContentVersion): Promise<void>
  onClose(): void
}) {
  const [versions, setVersions] = useState<ContentVersion[]>()
  const [error, setError] = useState('')
  const [onlyCompatible, setOnlyCompatible] = useState(Boolean(target))
  const [busy, setBusy] = useState<string>()

  useEffect(() => {
    setVersions(undefined)
    const filter = onlyCompatible && target && hit.kind !== 'modpack'
    window.moon.content
      .versions(hit.platform, hit.id, hit.kind, filter ? target.mcVersion : undefined, filter ? target.loader : undefined)
      .then(setVersions)
      .catch((e) => setError(errorMessage(e)))
  }, [hit, target, onlyCompatible])

  const install = async (v: ContentVersion) => {
    setBusy(v.id)
    try {
      await onInstall(v)
      onClose()
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <Modal title={`${hit.title} – Versionen`} onClose={onClose} wide>
      {target && hit.kind !== 'modpack' && (
        <div className="inline-toggle">
          <Toggle checked={onlyCompatible} onChange={setOnlyCompatible} label="Nur kompatible" />
          <span>
            Nur Versionen für {target.name} ({target.mcVersion}, {target.loader})
          </span>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      {!versions && !error && (
        <div className="center-pad">
          <Spinner />
        </div>
      )}
      {versions?.length === 0 && <Empty title="Keine passenden Versionen gefunden" />}
      {versions && versions.length > 0 && (
        <div className="version-list">
          {versions.map((v) => (
            <div key={v.id} className="version-row">
              <div className="version-main">
                <strong>{v.name}</strong>
                <div className="chips">
                  <span className={`chip type-${v.type}`}>{TYPE_LABELS[v.type]}</span>
                  {v.loaders.slice(0, 3).map((l) => (
                    <span key={l} className="chip">
                      {l}
                    </span>
                  ))}
                  <span className="chip muted-chip">
                    {v.gameVersions.slice(0, 4).join(', ')}
                    {v.gameVersions.length > 4 ? ` +${v.gameVersions.length - 4}` : ''}
                  </span>
                </div>
              </div>
              <div className="version-meta muted">
                <span>{formatRelative(v.date)}</span>
                <span>{formatNumber(v.downloads)} Downloads</span>
              </div>
              <Button
                variant="primary"
                icon={<Download size={15} />}
                loading={busy === v.id}
                disabled={Boolean(busy) || (hit.kind !== 'modpack' && !target)}
                onClick={() => install(v)}
              >
                Installieren
              </Button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}
