import { useEffect, useState } from 'react'
import { ExternalLink, FolderOpen } from 'lucide-react'
import type { Settings as SettingsType } from '@shared/types'
import { MoonLogo } from '../components/MoonLogo'
import { Button, Field, Spinner, Toggle } from '../components/ui'
import { useStore } from '../store'

export function Settings() {
  const { settings, saveSettings, attempt } = useStore()
  const [form, setForm] = useState<SettingsType>()
  const [dataDir, setDataDir] = useState('')
  const [version, setVersion] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (settings && !form) setForm(settings)
  }, [settings, form])

  useEffect(() => {
    void window.moon.app.dataDir().then(setDataDir)
    void window.moon.app.version().then(setVersion)
  }, [])

  if (!form) {
    return (
      <div className="page center-pad">
        <Spinner />
      </div>
    )
  }

  const set = <K extends keyof SettingsType>(key: K, value: SettingsType[K]) => setForm({ ...form, [key]: value })
  const dirty = JSON.stringify(form) !== JSON.stringify(settings)

  const save = async () => {
    setSaving(true)
    await attempt(() => saveSettings(form), 'Einstellungen gespeichert')
    setSaving(false)
  }

  const link = (url: string, label: string) => (
    <button className="link" onClick={() => window.moon.app.openExternal(url)}>
      {label} <ExternalLink size={12} />
    </button>
  )

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Einstellungen</h1>
          <p className="muted">Gilt für alle Instanzen, sofern dort nichts anderes eingestellt ist.</p>
        </div>
        <Button variant="primary" onClick={save} loading={saving} disabled={!dirty}>
          Speichern
        </Button>
      </header>

      <div className="settings-grid">
        <section className="card">
          <h2>Spiel</h2>
          <Field label={`Arbeitsspeicher: ${(form.memoryMb / 1024).toFixed(1)} GB`} hint="Für große Modpacks werden 6–8 GB empfohlen.">
            <input type="range" min={1024} max={32768} step={512} value={form.memoryMb} onChange={(e) => set('memoryMb', Number(e.target.value))} />
          </Field>
          <Field label="Java-Pfad" hint="Leer lassen: Moon Client lädt automatisch die richtige Java-Version für jede Minecraft-Version.">
            <input value={form.javaPath} placeholder="automatisch" onChange={(e) => set('javaPath', e.target.value)} />
          </Field>
          <Field label="Zusätzliche JVM-Argumente">
            <input value={form.jvmArgs} placeholder="-XX:+UseG1GC" onChange={(e) => set('jvmArgs', e.target.value)} />
          </Field>
          <div className="inline-toggle">
            <Toggle checked={form.closeOnLaunch} onChange={(v) => set('closeOnLaunch', v)} label="Launcher ausblenden" />
            <span>Launcher während des Spielens ausblenden</span>
          </div>
          <div className="inline-toggle">
            <Toggle checked={form.showSnapshots} onChange={(v) => set('showSnapshots', v)} label="Snapshots" />
            <span>Snapshots standardmäßig anzeigen</span>
          </div>
        </section>

        <section className="card">
          <h2>Downloads</h2>
          <Field label={`Gleichzeitige Downloads: ${form.downloadConcurrency}`}>
            <input type="range" min={1} max={64} value={form.downloadConcurrency} onChange={(e) => set('downloadConcurrency', Number(e.target.value))} />
          </Field>
          <Field label="CurseForge-API-Key" hint={<>Kostenlos erhältlich unter {link('https://console.curseforge.com/', 'console.curseforge.com')}</>}>
            <input type="password" value={form.curseforgeApiKey} placeholder="$2a$10$…" onChange={(e) => set('curseforgeApiKey', e.target.value)} />
          </Field>
          <Field
            label="Microsoft Client-ID (Azure)"
            hint={<>Client-ID deiner Azure-App für den Microsoft-Login. Anleitung: {link('https://github.com/Luna-OS/Moon-Client#microsoft-login-einrichten', 'README')}</>}
          >
            <input value={form.msaClientId} placeholder="00000000-0000-0000-0000-000000000000" onChange={(e) => set('msaClientId', e.target.value)} />
          </Field>
        </section>

        <section className="card about">
          <MoonLogo size={64} />
          <div>
            <h2>Moon Client {version}</h2>
            <p className="muted">Ein Minecraft-Launcher von Luna OS.</p>
            <p className="muted small">Datenordner: {dataDir}</p>
          </div>
          <Button variant="ghost" icon={<FolderOpen size={16} />} onClick={() => window.moon.app.openDataDir()}>
            Datenordner öffnen
          </Button>
        </section>
      </div>
    </div>
  )
}
