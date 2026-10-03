import path from 'node:path'
import AdmZip from 'adm-zip'
import type {
  ContentHit,
  ContentKind,
  ContentSearchQuery,
  ContentSearchResult,
  ContentVersion,
  Instance,
  LoaderType
} from '../../../shared/types'
import { downloadAll, downloadFile, fetchJson, type DownloadItem, type ProgressFn } from '../http'
import { contentDir, findInstalledProject, recordContent } from '../instances'
import { paths } from '../paths'
import { extractOverrides, safeJoin, type ModpackManifest } from './common'

const API = 'https://api.curseforge.com/v1'
const MINECRAFT_GAME_ID = 432

const CLASS_IDS: Record<ContentKind, number> = {
  mod: 6,
  modpack: 4471,
  resourcepack: 12,
  shader: 6552
}

const LOADER_TYPES: Partial<Record<LoaderType, number>> = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6
}

const LOADER_NAMES: Record<string, LoaderType> = {
  forge: 'forge',
  fabric: 'fabric',
  quilt: 'quilt',
  neoforge: 'neoforge'
}

interface CfMod {
  id: number
  name: string
  slug: string
  summary: string
  classId?: number
  authors: Array<{ name: string }>
  logo?: { thumbnailUrl?: string; url?: string }
  downloadCount: number
  categories: Array<{ name: string }>
  links?: { websiteUrl?: string }
  dateModified?: string
}

interface CfFile {
  id: number
  modId: number
  displayName: string
  fileName: string
  releaseType: 1 | 2 | 3
  fileDate: string
  downloadCount: number
  downloadUrl: string | null
  fileLength: number
  gameVersions: string[]
  hashes: Array<{ value: string; algo: 1 | 2 }>
  dependencies: Array<{ modId: number; relationType: number }>
}

export class MissingApiKeyError extends Error {
  constructor() {
    super('Für CurseForge wird ein API-Key benötigt. Trage ihn unter Einstellungen → CurseForge ein (siehe README).')
  }
}

function client(apiKey: string) {
  if (!apiKey) throw new MissingApiKeyError()
  const headers = { 'x-api-key': apiKey, Accept: 'application/json' }
  return {
    get: <T>(p: string) => fetchJson<{ data: T; pagination?: { totalCount: number } }>(`${API}${p}`, { headers }),
    post: <T>(p: string, body: unknown) =>
      fetchJson<{ data: T }>(`${API}${p}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
  }
}

const sha1Of = (f: CfFile) => f.hashes.find((h) => h.algo === 1)?.value
const RELEASE_TYPES = { 1: 'release', 2: 'beta', 3: 'alpha' } as const

export async function search(apiKey: string, q: ContentSearchQuery): Promise<ContentSearchResult> {
  const cf = client(apiKey)
  const params = new URLSearchParams({
    gameId: String(MINECRAFT_GAME_ID),
    classId: String(CLASS_IDS[q.kind]),
    searchFilter: q.query,
    sortOrder: 'desc',
    index: String(q.offset),
    pageSize: String(Math.min(q.limit, 50))
  })
  const sortField = { relevance: q.query ? undefined : 2, downloads: 6, updated: 3, newest: 11 }[q.sort]
  if (sortField) params.set('sortField', String(sortField))
  if (q.mcVersion) params.set('gameVersion', q.mcVersion)
  const loaderType = q.loader && LOADER_TYPES[q.loader]
  if (loaderType && (q.kind === 'mod' || q.kind === 'modpack') && q.loader !== 'quilt') {
    params.set('modLoaderType', String(loaderType))
  }
  const res = await cf.get<CfMod[]>(`/mods/search?${params}`)
  return {
    // The API refuses index + pageSize > 10000.
    total: Math.min(res.pagination?.totalCount ?? res.data.length, 10_000),
    hits: res.data.map(
      (m): ContentHit => ({
        platform: 'curseforge',
        kind: q.kind,
        id: String(m.id),
        slug: m.slug,
        title: m.name,
        description: m.summary,
        author: m.authors[0]?.name ?? '',
        iconUrl: m.logo?.thumbnailUrl || m.logo?.url || undefined,
        downloads: m.downloadCount,
        categories: m.categories.map((c) => c.name),
        url: m.links?.websiteUrl ?? `https://www.curseforge.com/minecraft/mc-mods/${m.slug}`,
        updatedAt: m.dateModified
      })
    )
  }
}

function fileMatchesLoader(file: CfFile, kind: ContentKind, loader?: LoaderType): boolean {
  if (!loader || loader === 'vanilla' || kind !== 'mod') return true
  const names = file.gameVersions.map((v) => v.toLowerCase())
  const loaderNames = names.filter((n) => n in LOADER_NAMES)
  if (loaderNames.length === 0) return true // Files without loader tags (old uploads)
  if (loader === 'quilt') return names.includes('quilt') || names.includes('fabric')
  return names.includes(loader)
}

async function rawFiles(apiKey: string, modId: string, kind: ContentKind, mcVersion?: string, loader?: LoaderType) {
  const cf = client(apiKey)
  const params = new URLSearchParams({ pageSize: '50' })
  if (mcVersion) params.set('gameVersion', mcVersion)
  const loaderType = loader && LOADER_TYPES[loader]
  if (loaderType && kind === 'mod' && loader !== 'quilt') params.set('modLoaderType', String(loaderType))
  const res = await cf.get<CfFile[]>(`/mods/${encodeURIComponent(modId)}/files?${params}`)
  return res.data
    .filter((f) => fileMatchesLoader(f, kind, loader))
    .sort((a, b) => Date.parse(b.fileDate) - Date.parse(a.fileDate))
}

export async function versions(
  apiKey: string,
  modId: string,
  kind: ContentKind,
  mcVersion?: string,
  loader?: LoaderType
): Promise<ContentVersion[]> {
  return (await rawFiles(apiKey, modId, kind, mcVersion, loader)).map((f) => ({
    platform: 'curseforge',
    id: String(f.id),
    projectId: String(f.modId),
    name: f.displayName,
    versionNumber: f.fileName,
    gameVersions: f.gameVersions.filter((v) => /^\d/.test(v)),
    loaders: f.gameVersions.filter((v) => v.toLowerCase() in LOADER_NAMES),
    type: RELEASE_TYPES[f.releaseType] ?? 'release',
    date: f.fileDate,
    downloads: f.downloadCount
  }))
}

function blockedMessage(mod: CfMod | undefined, file: CfFile): string {
  return `${mod?.name ?? file.displayName} (${file.fileName}) – der Autor erlaubt keine Downloads über Drittanbieter-Launcher. Bitte manuell herunterladen: ${mod?.links?.websiteUrl ?? 'https://www.curseforge.com'}/files/${file.id}`
}

export async function installProject(
  apiKey: string,
  inst: Instance,
  kind: Exclude<ContentKind, 'modpack'>,
  modId: string,
  fileId: string | undefined,
  onProgress?: ProgressFn,
  visited = new Set<string>()
): Promise<string[]> {
  const cf = client(apiKey)
  visited.add(modId)
  const mod = (await cf.get<CfMod>(`/mods/${encodeURIComponent(modId)}`)).data
  const file = fileId
    ? (await cf.get<CfFile>(`/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(fileId)}`)).data
    : (await rawFiles(apiKey, modId, kind, inst.mcVersion, inst.loader))[0]
  if (!file) throw new Error(`${mod.name}: keine passende Datei für Minecraft ${inst.mcVersion} (${inst.loader})`)
  if (!file.downloadUrl) throw new Error(blockedMessage(mod, file))

  const fileName = path.basename(file.fileName)
  await downloadFile({
    url: file.downloadUrl,
    dest: path.join(contentDir(inst.id, kind), fileName),
    sha1: sha1Of(file),
    size: file.fileLength
  })
  await recordContent(inst.id, kind, fileName, {
    platform: 'curseforge',
    projectId: String(mod.id),
    versionId: String(file.id),
    title: mod.name,
    versionNumber: file.displayName,
    iconUrl: mod.logo?.thumbnailUrl
  })
  onProgress?.(1, 1, mod.name)
  const installed = [mod.name]

  if (kind !== 'mod') return installed
  for (const dep of file.dependencies) {
    if (dep.relationType !== 3) continue // 3 = required dependency
    const depId = String(dep.modId)
    if (visited.has(depId) || (await findInstalledProject(inst.id, 'curseforge', depId))) continue
    installed.push(...(await installProject(apiKey, inst, kind, depId, undefined, onProgress, visited)))
  }
  return installed
}

export async function downloadModpack(
  apiKey: string,
  modId: string,
  fileId?: string
): Promise<{ file: string; versionId: string }> {
  const cf = client(apiKey)
  const file = fileId
    ? (await cf.get<CfFile>(`/mods/${encodeURIComponent(modId)}/files/${encodeURIComponent(fileId)}`)).data
    : (await rawFiles(apiKey, modId, 'modpack'))[0]
  if (!file) throw new Error('Dieses Modpack hat keine Dateien')
  if (!file.downloadUrl) throw new Error(blockedMessage(undefined, file))
  const dest = path.join(paths.cache, 'modpacks', 'curseforge', `${file.id}.zip`)
  await downloadFile({ url: file.downloadUrl, dest, sha1: sha1Of(file), size: file.fileLength })
  return { file: dest, versionId: String(file.id) }
}

interface CfManifest {
  name: string
  version?: string
  overrides?: string
  minecraft: { version: string; modLoaders: Array<{ id: string; primary?: boolean }> }
  files: Array<{ projectID: number; fileID: number; required?: boolean }>
}

export function readCurseforgePack(file: string): ModpackManifest {
  const raw = new AdmZip(file).readAsText('manifest.json')
  if (!raw) throw new Error('Keine gültige CurseForge-Modpack-Datei (manifest.json fehlt)')
  const manifest = JSON.parse(raw) as CfManifest
  const primary = manifest.minecraft.modLoaders.find((l) => l.primary) ?? manifest.minecraft.modLoaders[0]
  let loader: LoaderType = 'vanilla'
  let loaderVersion: string | undefined
  if (primary) {
    const dash = primary.id.indexOf('-')
    const name = primary.id.slice(0, dash).toLowerCase()
    loader = LOADER_NAMES[name] ?? 'vanilla'
    loaderVersion = primary.id.slice(dash + 1)
    if (loader === 'vanilla') throw new Error(`Unbekannter Mod-Loader im Modpack: ${primary.id}`)
    if (loader === 'neoforge' && manifest.minecraft.version === '1.20.1') {
      throw new Error('NeoForge für Minecraft 1.20.1 (der alte "forge"-Fork) wird noch nicht unterstützt.')
    }
  }
  return {
    name: manifest.name,
    version: manifest.version,
    mcVersion: manifest.minecraft.version,
    loader,
    loaderVersion,
    overrideDirs: [manifest.overrides || 'overrides']
  }
}

const FOLDERS_BY_CLASS: Record<number, string> = { 6: 'mods', 12: 'resourcepacks', 6552: 'shaderpacks' }

/**
 * Downloads the files of a CurseForge modpack into an instance.
 * Returns warnings for files whose authors block third-party downloads.
 */
export async function installCurseforgePackFiles(
  apiKey: string,
  file: string,
  inst: Instance,
  onProgress?: ProgressFn,
  concurrency = 16
): Promise<string[]> {
  const cf = client(apiKey)
  const zip = new AdmZip(file)
  const manifest = JSON.parse(zip.readAsText('manifest.json')) as CfManifest
  const dir = paths.instanceDir(inst.id)
  const warnings: string[] = []

  const fileIds = manifest.files.map((f) => f.fileID)
  const modIds = [...new Set(manifest.files.map((f) => f.projectID))]
  const files: CfFile[] = []
  const mods: CfMod[] = []
  for (let i = 0; i < fileIds.length; i += 500) {
    files.push(...(await cf.post<CfFile[]>('/mods/files', { fileIds: fileIds.slice(i, i + 500) })).data)
  }
  for (let i = 0; i < modIds.length; i += 500) {
    mods.push(...(await cf.post<CfMod[]>('/mods', { modIds: modIds.slice(i, i + 500) })).data)
  }
  const modById = new Map(mods.map((m) => [m.id, m]))

  const items: DownloadItem[] = []
  const records: Array<{ fileName: string; mod: CfMod; file: CfFile }> = []
  for (const f of files) {
    const mod = modById.get(f.modId)
    if (!f.downloadUrl) {
      warnings.push(blockedMessage(mod, f))
      continue
    }
    const folder = FOLDERS_BY_CLASS[mod?.classId ?? 6] ?? 'mods'
    items.push({
      url: f.downloadUrl,
      dest: safeJoin(dir, `${folder}/${path.basename(f.fileName)}`),
      sha1: sha1Of(f),
      size: f.fileLength
    })
    if (mod && folder === 'mods') records.push({ fileName: path.basename(f.fileName), mod, file: f })
  }
  await downloadAll(items, onProgress, concurrency)
  await extractOverrides(zip, [manifest.overrides || 'overrides'], dir)
  for (const r of records) {
    await recordContent(inst.id, 'mod', r.fileName, {
      platform: 'curseforge',
      projectId: String(r.mod.id),
      versionId: String(r.file.id),
      title: r.mod.name,
      versionNumber: r.file.displayName,
      iconUrl: r.mod.logo?.thumbnailUrl
    })
  }
  return warnings
}

export async function projectInfo(apiKey: string, modId: string): Promise<{ title: string; iconUrl?: string }> {
  const mod = (await client(apiKey).get<CfMod>(`/mods/${encodeURIComponent(modId)}`)).data
  return { title: mod.name, iconUrl: mod.logo?.thumbnailUrl }
}
