import { safeStorage } from 'electron'
import type { Account, AccountsState, DeviceCodeInfo } from '../shared/types'
import { loginWithDeviceCode, offlineUuid, refreshSession, type MicrosoftSession } from './core/auth'
import { exists, readJson, writeJson } from './core/http'
import type { LaunchAuth } from './core/launch'
import { paths } from './core/paths'
import { getSettings } from './settings'

interface StoredAccount extends Account {
  xuid?: string
  expiresAt?: number
  /** Encrypted (when the OS supports it) JSON of { accessToken, refreshToken }. */
  secret?: string
  encrypted?: boolean
}

interface StoredState {
  selectedId?: string
  accounts: StoredAccount[]
}

interface Secret {
  accessToken: string
  refreshToken: string
}

async function load(): Promise<StoredState> {
  return (await exists(paths.accountsFile)) ? readJson<StoredState>(paths.accountsFile) : { accounts: [] }
}

const save = (state: StoredState) => writeJson(paths.accountsFile, state)

function sealSecret(secret: Secret): Pick<StoredAccount, 'secret' | 'encrypted'> {
  const json = JSON.stringify(secret)
  if (safeStorage.isEncryptionAvailable()) {
    return { secret: safeStorage.encryptString(json).toString('base64'), encrypted: true }
  }
  return { secret: Buffer.from(json).toString('base64'), encrypted: false }
}

function openSecret(acc: StoredAccount): Secret | undefined {
  if (!acc.secret) return undefined
  const buf = Buffer.from(acc.secret, 'base64')
  try {
    return JSON.parse(acc.encrypted ? safeStorage.decryptString(buf) : buf.toString()) as Secret
  } catch {
    return undefined
  }
}

const publicAccount = ({ id, name, type }: StoredAccount): Account => ({ id, name, type })

export async function accountsState(): Promise<AccountsState> {
  const state = await load()
  return { accounts: state.accounts.map(publicAccount), selectedId: state.selectedId }
}

function fromSession(session: MicrosoftSession): StoredAccount {
  return {
    id: session.uuid,
    name: session.name,
    type: 'microsoft',
    xuid: session.xuid,
    expiresAt: session.expiresAt,
    ...sealSecret({ accessToken: session.accessToken, refreshToken: session.refreshToken })
  }
}

let loginAbort: AbortController | undefined

export async function loginMicrosoft(onCode: (info: DeviceCodeInfo) => void): Promise<Account> {
  loginAbort?.abort()
  loginAbort = new AbortController()
  const { msaClientId } = await getSettings()
  const session = await loginWithDeviceCode(msaClientId, onCode, loginAbort.signal)
  const state = await load()
  const stored = fromSession(session)
  state.accounts = [...state.accounts.filter((a) => a.id !== stored.id), stored]
  state.selectedId = stored.id
  await save(state)
  return publicAccount(stored)
}

export function cancelLogin(): void {
  loginAbort?.abort()
}

export async function addOfflineAccount(name: string): Promise<Account> {
  const state = await load()
  // Same rule as other launchers: offline profiles only for people who own the game.
  if (!state.accounts.some((a) => a.type === 'microsoft')) {
    throw new Error('Offline-Konten sind erst verfügbar, nachdem ein Microsoft-Konto mit Minecraft hinzugefügt wurde.')
  }
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) {
    throw new Error('Spielernamen bestehen aus 3–16 Zeichen (Buchstaben, Ziffern, _).')
  }
  const account: StoredAccount = { id: offlineUuid(name), name, type: 'offline' }
  state.accounts = [...state.accounts.filter((a) => a.id !== account.id), account]
  state.selectedId = account.id
  await save(state)
  return publicAccount(account)
}

export async function removeAccount(id: string): Promise<void> {
  const state = await load()
  state.accounts = state.accounts.filter((a) => a.id !== id)
  if (state.selectedId === id) state.selectedId = state.accounts[0]?.id
  await save(state)
}

export async function selectAccount(id: string): Promise<void> {
  const state = await load()
  if (!state.accounts.some((a) => a.id === id)) throw new Error('Konto nicht gefunden')
  state.selectedId = id
  await save(state)
}

/** Returns launch credentials for the selected account, refreshing Microsoft tokens if needed. */
export async function launchAuth(): Promise<LaunchAuth> {
  const state = await load()
  const acc = state.accounts.find((a) => a.id === state.selectedId) ?? state.accounts[0]
  if (!acc) throw new Error('Bitte füge zuerst unter „Konten" ein Microsoft-Konto hinzu.')
  if (acc.type === 'offline') {
    return { name: acc.name, uuid: acc.id, accessToken: '0', userType: 'legacy' }
  }
  let secret = openSecret(acc)
  if (!secret) throw new Error(`Die Anmeldung für ${acc.name} ist ungültig. Bitte melde dich erneut an.`)
  let current = acc
  if (!acc.expiresAt || acc.expiresAt < Date.now() + 5 * 60_000) {
    const { msaClientId } = await getSettings()
    try {
      const session = await refreshSession(msaClientId, secret.refreshToken)
      current = fromSession(session)
      state.accounts = state.accounts.map((a) => (a.id === acc.id ? current : a))
      await save(state)
      secret = { accessToken: session.accessToken, refreshToken: session.refreshToken }
    } catch (e) {
      throw new Error(`Sitzung von ${acc.name} ist abgelaufen – bitte erneut anmelden. (${(e as Error).message})`)
    }
  }
  return { name: current.name, uuid: current.id, accessToken: secret.accessToken, xuid: current.xuid, userType: 'msa' }
}
