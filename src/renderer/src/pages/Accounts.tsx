import { useEffect, useState } from 'react'
import { Check, Copy, ExternalLink, LogIn, Trash2, UserRound, WifiOff } from 'lucide-react'
import type { DeviceCodeInfo } from '@shared/types'
import { Modal } from '../components/Modal'
import { Button, Empty, Field, Spinner } from '../components/ui'
import { errorMessage } from '../format'
import { useStore } from '../store'

export function Accounts() {
  const { accounts, refreshAccounts, attempt, toast } = useStore()
  const [code, setCode] = useState<DeviceCodeInfo>()
  const [loggingIn, setLoggingIn] = useState(false)
  const [offline, setOffline] = useState(false)
  const [offlineName, setOfflineName] = useState('')
  const [copied, setCopied] = useState(false)
  const hasMicrosoft = accounts.accounts.some((a) => a.type === 'microsoft')

  useEffect(() => window.moon.on.deviceCode(setCode), [])

  const login = async () => {
    setLoggingIn(true)
    setCode(undefined)
    try {
      const account = await window.moon.accounts.loginMicrosoft()
      await refreshAccounts()
      toast(`Willkommen, ${account.name}!`, 'success')
    } catch (e) {
      const msg = errorMessage(e)
      if (!/abgebrochen/.test(msg)) toast(msg, 'error')
    } finally {
      setLoggingIn(false)
      setCode(undefined)
    }
  }

  const cancel = () => {
    void window.moon.accounts.cancelLogin()
    setLoggingIn(false)
    setCode(undefined)
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Konten</h1>
          <p className="muted">Melde dich mit deinem Microsoft-Konto an, um Minecraft zu spielen.</p>
        </div>
        <div className="actions">
          <Button
            variant="ghost"
            icon={<WifiOff size={17} />}
            disabled={!hasMicrosoft}
            title={hasMicrosoft ? undefined : 'Erst verfügbar, wenn ein Microsoft-Konto hinzugefügt wurde'}
            onClick={() => setOffline(true)}
          >
            Offline-Konto
          </Button>
          <Button variant="primary" icon={<LogIn size={17} />} onClick={login} loading={loggingIn}>
            Mit Microsoft anmelden
          </Button>
        </div>
      </header>

      {accounts.accounts.length === 0 ? (
        <Empty icon={<UserRound size={28} />} title="Noch kein Konto">
          Du brauchst ein Microsoft-Konto, das Minecraft: Java Edition besitzt.
        </Empty>
      ) : (
        <div className="account-list">
          {accounts.accounts.map((a) => {
            const active = a.id === accounts.selectedId
            return (
              <div key={a.id} className={`account-card ${active ? 'active' : ''}`}>
                <img src={`https://mc-heads.net/body/${a.id}/120`} alt="" className="account-skin" />
                <div className="account-info">
                  <strong>{a.name}</strong>
                  <small className="muted">{a.type === 'microsoft' ? 'Microsoft-Konto' : 'Offline-Konto'}</small>
                </div>
                <div className="actions">
                  {active ? (
                    <span className="chip active-chip">
                      <Check size={13} /> Aktiv
                    </span>
                  ) : (
                    <Button variant="ghost" onClick={() => attempt(async () => { await window.moon.accounts.select(a.id); await refreshAccounts() })}>
                      Verwenden
                    </Button>
                  )}
                  <button
                    className="icon-btn danger"
                    aria-label="Entfernen"
                    onClick={() => attempt(async () => { await window.moon.accounts.remove(a.id); await refreshAccounts() })}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {loggingIn && (
        <Modal title="Mit Microsoft anmelden" onClose={cancel}>
          {!code ? (
            <div className="center-pad">
              <Spinner />
            </div>
          ) : (
            <div className="device-code">
              <p>
                Öffne <b>{code.verificationUri}</b> und gib diesen Code ein:
              </p>
              <button
                className="code-box"
                onClick={async () => {
                  await navigator.clipboard.writeText(code.userCode)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
              >
                <span>{code.userCode}</span>
                {copied ? <Check size={18} /> : <Copy size={18} />}
              </button>
              <Button
                variant="primary"
                icon={<ExternalLink size={16} />}
                onClick={async () => {
                  await navigator.clipboard.writeText(code.userCode)
                  await window.moon.app.openExternal(code.verificationUri)
                }}
              >
                Code kopieren &amp; Browser öffnen
              </Button>
              <p className="muted small">
                <Spinner size={13} /> Warte auf Bestätigung … (läuft in {Math.round(code.expiresIn / 60)} Minuten ab)
              </p>
            </div>
          )}
        </Modal>
      )}

      {offline && (
        <Modal
          title="Offline-Konto hinzufügen"
          onClose={() => setOffline(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOffline(false)}>
                Abbrechen
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  const ok = await attempt(() => window.moon.accounts.addOffline(offlineName.trim()))
                  if (ok) {
                    await refreshAccounts()
                    setOffline(false)
                    setOfflineName('')
                  }
                }}
              >
                Hinzufügen
              </Button>
            </>
          }
        >
          <Field label="Spielername" hint="Offline-Konten funktionieren nur im Einzelspieler und auf Servern im Offline-Modus.">
            <input autoFocus value={offlineName} maxLength={16} onChange={(e) => setOfflineName(e.target.value)} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
