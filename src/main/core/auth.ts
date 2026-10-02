import { createHash } from 'node:crypto'
import type { DeviceCodeInfo } from '../../shared/types'
import { HttpError, postJson, request } from './http'

/**
 * Microsoft → Xbox Live → Minecraft authentication using the OAuth device code flow.
 * Needs an Azure app registration (public client, "Allow public client flows" enabled)
 * that Mojang has approved for the Minecraft services API.
 */

const MS_BASE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0'
const SCOPE = 'XboxLive.signin offline_access'

export interface MicrosoftSession {
  uuid: string
  name: string
  accessToken: string
  /** Epoch ms when the Minecraft access token expires. */
  expiresAt: number
  refreshToken: string
  xuid?: string
}

interface MsTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

async function postForm<T>(url: string, form: Record<string, string>): Promise<T> {
  const res = await request(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(form).toString()
    },
    0
  )
  return (await res.json()) as T
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function loginWithDeviceCode(
  clientId: string,
  onCode: (info: DeviceCodeInfo) => void,
  signal?: AbortSignal
): Promise<MicrosoftSession> {
  if (!clientId) {
    throw new Error('Keine Microsoft Client-ID gesetzt. Trage sie unter Einstellungen → Konto ein (siehe README).')
  }
  const code = await postForm<{
    device_code: string
    user_code: string
    verification_uri: string
    expires_in: number
    interval: number
    message: string
  }>(`${MS_BASE}/devicecode`, { client_id: clientId, scope: SCOPE })

  onCode({
    userCode: code.user_code,
    verificationUri: code.verification_uri,
    expiresIn: code.expires_in,
    message: code.message
  })

  const deadline = Date.now() + code.expires_in * 1000
  let interval = (code.interval || 5) * 1000
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Anmeldung abgebrochen')
    await sleep(interval)
    try {
      const token = await postForm<MsTokenResponse>(`${MS_BASE}/token`, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: clientId,
        device_code: code.device_code
      })
      return minecraftLogin(token.access_token, token.refresh_token)
    } catch (e) {
      if (!(e instanceof HttpError)) throw e
      const error = (() => {
        try {
          return (JSON.parse(e.body) as { error?: string }).error
        } catch {
          return undefined
        }
      })()
      if (error === 'authorization_pending') continue
      if (error === 'slow_down') {
        interval += 5000
        continue
      }
      if (error === 'authorization_declined') throw new Error('Anmeldung wurde abgelehnt')
      if (error === 'expired_token') break
      throw e
    }
  }
  throw new Error('Der Anmeldecode ist abgelaufen. Bitte versuche es erneut.')
}

export async function refreshSession(clientId: string, refreshToken: string): Promise<MicrosoftSession> {
  const token = await postForm<MsTokenResponse>(`${MS_BASE}/token`, {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
    scope: SCOPE
  })
  return minecraftLogin(token.access_token, token.refresh_token)
}

const XSTS_ERRORS: Record<number, string> = {
  2148916227: 'Dieses Xbox-Konto ist gesperrt.',
  2148916233: 'Dieses Microsoft-Konto hat kein Xbox-Profil. Melde dich einmal auf xbox.com an und versuche es erneut.',
  2148916235: 'Xbox Live ist in deinem Land nicht verfügbar.',
  2148916236: 'Das Konto benötigt eine Altersverifizierung (Südkorea).',
  2148916237: 'Das Konto benötigt eine Altersverifizierung (Südkorea).',
  2148916238: 'Dies ist ein Kinderkonto. Es muss von einem Erwachsenen einer Familiengruppe hinzugefügt werden.'
}

async function minecraftLogin(msAccessToken: string, refreshToken: string): Promise<MicrosoftSession> {
  const xbl = await postJson<{ Token: string; DisplayClaims: { xui: Array<{ uhs: string }> } }>(
    'https://user.auth.xboxlive.com/user/authenticate',
    {
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT'
    }
  )

  const xstsFor = async (relyingParty: string) => {
    try {
      return await postJson<{ Token: string; DisplayClaims: { xui: Array<{ uhs: string; xid?: string }> } }>(
        'https://xsts.auth.xboxlive.com/xsts/authorize',
        { Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] }, RelyingParty: relyingParty, TokenType: 'JWT' }
      )
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) {
        const xerr = (() => {
          try {
            return (JSON.parse(e.body) as { XErr?: number }).XErr
          } catch {
            return undefined
          }
        })()
        if (xerr && XSTS_ERRORS[xerr]) throw new Error(XSTS_ERRORS[xerr])
      }
      throw e
    }
  }

  const xsts = await xstsFor('rp://api.minecraftservices.com/')
  const uhs = xsts.DisplayClaims.xui[0].uhs

  let mc: { access_token: string; expires_in: number }
  try {
    mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
      identityToken: `XBL3.0 x=${uhs};${xsts.Token}`
    })
  } catch (e) {
    if (e instanceof HttpError && e.status === 403) {
      throw new Error(
        'Minecraft hat die Anmeldung abgelehnt (403). Die verwendete Azure-App ist vermutlich nicht für die Minecraft-API freigeschaltet – siehe README.'
      )
    }
    throw e
  }

  // The Xbox user id is only exposed by an XSTS token for the Xbox Live relying party.
  const xuid = await xstsFor('http://xboxlive.com')
    .then((t) => t.DisplayClaims.xui[0].xid)
    .catch(() => undefined)

  let profile: { id: string; name: string }
  try {
    const res = await request(
      'https://api.minecraftservices.com/minecraft/profile',
      { headers: { Authorization: `Bearer ${mc.access_token}` } },
      1
    )
    profile = (await res.json()) as { id: string; name: string }
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) {
      throw new Error('Dieses Microsoft-Konto besitzt Minecraft: Java Edition nicht (oder hat noch keinen Spielernamen).')
    }
    throw e
  }

  return {
    uuid: profile.id,
    name: profile.name,
    accessToken: mc.access_token,
    expiresAt: Date.now() + mc.expires_in * 1000,
    refreshToken,
    xuid
  }
}

/** Same UUID the vanilla server uses for offline players: UUID v3 of "OfflinePlayer:<name>". */
export function offlineUuid(name: string): string {
  const hash = createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  hash[6] = (hash[6] & 0x0f) | 0x30
  hash[8] = (hash[8] & 0x3f) | 0x80
  return hash.toString('hex')
}
