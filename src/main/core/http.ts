import { createHash } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'

export const LAUNCHER_NAME = 'moon-client'
export const LAUNCHER_VERSION = '1.0.0'
export const USER_AGENT = `Luna-OS/Moon-Client/${LAUNCHER_VERSION} (github.com/Luna-OS/Moon-Client)`

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string
  ) {
    super(`HTTP ${status} für ${url}${body ? `: ${body.slice(0, 300)}` : ''}`)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function request(url: string, init: RequestInit = {}, retries = 3): Promise<Response> {
  const headers = new Headers(init.headers)
  if (!headers.has('User-Agent')) headers.set('User-Agent', USER_AGENT)
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(60_000) })
      if (res.ok) return res
      const body = await res.text().catch(() => '')
      const err = new HttpError(res.status, url, body)
      // Client errors (except rate limiting) won't get better by retrying.
      if (res.status < 500 && res.status !== 429) throw err
      lastError = err
    } catch (e) {
      if (e instanceof HttpError && e.status < 500 && e.status !== 429) throw e
      lastError = e
    }
    if (attempt < retries) await sleep(500 * 2 ** attempt)
  }
  throw lastError
}

export async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await request(url, init)
  return (await res.json()) as T
}

export async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  return fetchJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body)
  })
}

export async function sha1File(file: string): Promise<string> {
  const hash = createHash('sha1')
  await pipeline(fs.createReadStream(file), hash)
  return hash.digest('hex')
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p)
    return true
  } catch {
    return false
  }
}

export interface DownloadItem {
  url: string
  dest: string
  sha1?: string
  size?: number
  executable?: boolean
}

/** Returns true when the file at `item.dest` already looks complete. */
async function isComplete(item: DownloadItem): Promise<boolean> {
  let stat: fs.Stats
  try {
    stat = await fsp.stat(item.dest)
  } catch {
    return false
  }
  if (!stat.isFile()) return false
  // Size checks are cheap; only hash when no size is known.
  if (item.size !== undefined) return stat.size === item.size
  if (item.sha1) return (await sha1File(item.dest)) === item.sha1.toLowerCase()
  return stat.size > 0
}

export async function downloadFile(item: DownloadItem, retries = 3): Promise<void> {
  if (await isComplete(item)) return
  await fsp.mkdir(path.dirname(item.dest), { recursive: true })
  const tmp = `${item.dest}.${process.pid}.part`
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await request(item.url, { signal: AbortSignal.timeout(5 * 60_000) }, 2)
      if (!res.body) throw new Error(`Leere Antwort für ${item.url}`)
      await pipeline(Readable.fromWeb(res.body as WebReadableStream), fs.createWriteStream(tmp))
      if (item.sha1) {
        const actual = await sha1File(tmp)
        if (actual !== item.sha1.toLowerCase()) {
          throw new Error(`Prüfsumme falsch für ${path.basename(item.dest)} (erwartet ${item.sha1}, erhalten ${actual})`)
        }
      }
      await fsp.rename(tmp, item.dest)
      if (item.executable && process.platform !== 'win32') await fsp.chmod(item.dest, 0o755)
      return
    } catch (e) {
      lastError = e
      await fsp.rm(tmp, { force: true })
      if (e instanceof HttpError && e.status === 404) break
      if (attempt < retries) await sleep(500 * 2 ** attempt)
    }
  }
  throw lastError
}

export type ProgressFn = (current: number, total: number, detail?: string) => void

/** Downloads all items with bounded concurrency, de-duplicating by destination. */
export async function downloadAll(
  items: DownloadItem[],
  onProgress?: ProgressFn,
  concurrency = 16
): Promise<void> {
  const unique = [...new Map(items.map((i) => [path.resolve(i.dest), i])).values()]
  let done = 0
  let next = 0
  const total = unique.length
  onProgress?.(0, total)
  const worker = async () => {
    while (next < unique.length) {
      const item = unique[next++]
      await downloadFile(item)
      done++
      onProgress?.(done, total, path.basename(item.dest))
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker))
}

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fsp.readFile(file, 'utf8')) as T
}

export async function writeJson(file: string, data: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2))
  await fsp.rename(tmp, file)
}
