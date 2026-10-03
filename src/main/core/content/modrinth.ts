import path from 'node:path'
import AdmZip from 'adm-zip'
import type {
  ContentHit,
  ContentKind,
  ContentSearchQuery,
  ContentSearchResult,
  ContentVersion,
  Instance,
  InstalledContentMeta,
  LoaderType
} from '../../../shared/types'
import { downloadAll, downloadFile, fetchJson, postJson, type DownloadItem, type ProgressFn } from '../http'
import { contentDir, findInstalledProject, recordContent } from '../instances'
import { paths } from '../paths'
import { extractOverrides, safeJoin, type ModpackManifest } from './common'

const API = 'https://api.modrinth.com/v2'

interface MrSearchHit {
  project_id: string
  slug: string
  title: string
  description: string
  author: string
  icon_url?: string
  downloads: number
  categories: string[]
  project_type: string
  date_modified: string
}

interface MrFile {
  url: string
  filename: string
  primary: boolean
  size: number
  hashes: { sha1: string; sha512?: string }
}

export interface MrVersion {
  id: string
  project_id: string
  name: string
  version_number: string
  game_versions: string[]
  loaders: string[]
  version_type: 'release' | 'beta' | 'alpha'
  date_published: string
  downloads: number
  files: MrFile[]
  dependencies: Array<{ version_id?: string; project_id?: string; dependency_type: string }>
}

interface MrProject {
  id: string
  title: string
  icon_url?: string
  project_type: string
}

const PROJECT_TYPES: Record<ContentKind, string> = {
  mod: 'mod',
  modpack: 'modpack',
  resourcepack: 'resourcepack',
  shader: 'shader'
}

/** Mod loaders whose mods run on the given instance loader. */
export function compatibleLoaders(loader: LoaderType): string[] {
  if (loader === 'quilt') return ['quilt', 'fabric']
  if (loader === 'vanilla') return []
  return [loader]
}

export async function search(q: ContentSearchQuery): Promise<ContentSearchResult> {
  const facets: string[][] = [[`project_type:${PROJECT_TYPES[q.kind]}`]]
  if (q.mcVersion) facets.push([`versions:${q.mcVersion}`])
  if (q.loader && q.loader !== 'vanilla' && (q.kind === 'mod' || q.kind === 'modpack')) {
    facets.push(compatibleLoaders(q.loader).map((l) => `categories:${l}`))
  }
  const params = new URLSearchParams({
    query: q.query,
    facets: JSON.stringify(facets),
    index: q.sort,
    offset: String(q.offset),
    limit: String(q.limit)
  })
  const res = await fetchJson<{ hits: MrSearchHit[]; total_hits: number }>(`${API}/search?${params}`)
  return {
    total: res.total_hits,
    hits: res.hits.map(
      (h): ContentHit => ({
        platform: 'modrinth',
        kind: q.kind,
        id: h.project_id,
        slug: h.slug,
        title: h.title,
        description: h.description,
        author: h.author,
        iconUrl: h.icon_url || undefined,
        downloads: h.downloads,
        categories: h.categories,
        url: `https://modrinth.com/${h.project_type}/${h.slug}`,
        updatedAt: h.date_modified
      })
    )
  }
}

async function rawVersions(projectId: string, kind: ContentKind, mcVersion?: string, loader?: LoaderType) {
  const params = new URLSearchParams()
  if (mcVersion) params.set('game_versions', JSON.stringify([mcVersion]))
  if (loader && loader !== 'vanilla' && (kind === 'mod' || kind === 'modpack')) {
    params.set('loaders', JSON.stringify(compatibleLoaders(loader)))
  }
  return fetchJson<MrVersion[]>(`${API}/project/${encodeURIComponent(projectId)}/version?${params}`)
}

export async function versions(
  projectId: string,
  kind: ContentKind,
  mcVersion?: string,
  loader?: LoaderType
): Promise<ContentVersion[]> {
  return (await rawVersions(projectId, kind, mcVersion, loader)).map((v) => ({
    platform: 'modrinth',
    id: v.id,
    projectId: v.project_id,
    name: v.name,
    versionNumber: v.version_number,
    gameVersions: v.game_versions,
    loaders: v.loaders,
    type: v.version_type,
    date: v.date_published,
    downloads: v.downloads
  }))
}

const getVersion = (id: string) => fetchJson<MrVersion>(`${API}/version/${encodeURIComponent(id)}`)
const getProject = (id: string) => fetchJson<MrProject>(`${API}/project/${encodeURIComponent(id)}`)

/** Installs a project (and its required dependencies) into an instance. Returns installed titles. */
export async function installProject(
  inst: Instance,
  kind: Exclude<ContentKind, 'modpack'>,
  projectId: string,
  versionId: string | undefined,
  onProgress?: ProgressFn,
  visited = new Set<string>()
): Promise<string[]> {
  visited.add(projectId)
  const version = versionId
    ? await getVersion(versionId)
    : (await rawVersions(projectId, kind, inst.mcVersion, inst.loader))[0]
  if (!version) {
    throw new Error(`Keine passende Version für Minecraft ${inst.mcVersion} (${inst.loader}) gefunden`)
  }
  const file = version.files.find((f) => f.primary) ?? version.files[0]
  const project = await getProject(version.project_id)
  const dir = contentDir(inst.id, kind)
  await downloadFile({ url: file.url, dest: path.join(dir, path.basename(file.filename)), sha1: file.hashes.sha1, size: file.size })
  await recordContent(inst.id, kind, path.basename(file.filename), {
    platform: 'modrinth',
    projectId: version.project_id,
    versionId: version.id,
    title: project.title,
    versionNumber: version.version_number,
    iconUrl: project.icon_url
  })
  onProgress?.(1, 1, project.title)
  const installed = [project.title]

  if (kind !== 'mod') return installed
  for (const dep of version.dependencies) {
    if (dep.dependency_type !== 'required') continue
    const depProject = dep.project_id ?? (dep.version_id ? (await getVersion(dep.version_id)).project_id : undefined)
    if (!depProject || visited.has(depProject)) continue
    if (await findInstalledProject(inst.id, 'modrinth', depProject)) continue
    try {
      installed.push(...(await installProject(inst, kind, depProject, undefined, onProgress, visited)))
    } catch (e) {
      throw new Error(`Abhängigkeit konnte nicht installiert werden: ${(e as Error).message}`)
    }
  }
  return installed
}

/** Downloads the .mrpack of a modpack version (latest if none given) into the cache. */
export async function downloadModpack(projectId: string, versionId?: string): Promise<{ file: string; versionId: string }> {
  const version = versionId ? await getVersion(versionId) : (await rawVersions(projectId, 'modpack'))[0]
  if (!version) throw new Error('Dieses Modpack hat keine Versionen')
  const file = version.files.find((f) => f.primary) ?? version.files[0]
  const dest = path.join(paths.cache, 'modpacks', 'modrinth', `${version.id}.mrpack`)
  await downloadFile({ url: file.url, dest, sha1: file.hashes.sha1, size: file.size })
  return { file: dest, versionId: version.id }
}

interface MrPackIndex {
  name: string
  versionId: string
  files: Array<{
    path: string
    hashes: { sha1: string }
    env?: { client?: string }
    downloads: string[]
    fileSize?: number
  }>
  dependencies: Record<string, string>
}

export function readMrpack(file: string): ModpackManifest {
  const zip = new AdmZip(file)
  const raw = zip.readAsText('modrinth.index.json')
  if (!raw) throw new Error('Keine gültige .mrpack-Datei (modrinth.index.json fehlt)')
  const index = JSON.parse(raw) as MrPackIndex
  const deps = index.dependencies
  const [loader, loaderVersion]: [LoaderType, string | undefined] = deps['neoforge']
    ? ['neoforge', deps['neoforge']]
    : deps['forge']
      ? ['forge', deps['forge']]
      : deps['quilt-loader']
        ? ['quilt', deps['quilt-loader']]
        : deps['fabric-loader']
          ? ['fabric', deps['fabric-loader']]
          : ['vanilla', undefined]
  return {
    name: index.name,
    version: index.versionId,
    mcVersion: deps['minecraft'],
    loader,
    loaderVersion,
    overrideDirs: ['overrides', 'client-overrides']
  }
}

/** Downloads the files listed in an .mrpack into an (already created) instance. */
export async function installMrpackFiles(file: string, inst: Instance, onProgress?: ProgressFn, concurrency = 16) {
  const zip = new AdmZip(file)
  const index = JSON.parse(zip.readAsText('modrinth.index.json')) as MrPackIndex
  const dir = paths.instanceDir(inst.id)
  const items: DownloadItem[] = index.files
    .filter((f) => f.env?.client !== 'unsupported')
    .map((f) => ({ url: f.downloads[0], dest: safeJoin(dir, f.path), sha1: f.hashes.sha1, size: f.fileSize }))
  await downloadAll(items, onProgress, concurrency)
  await extractOverrides(zip, ['overrides', 'client-overrides'], dir)

  // Best effort: look up project names/icons so the mod list looks nice.
  try {
    const mods = index.files.filter((f) => f.path.startsWith('mods/'))
    const hashes = mods.map((f) => f.hashes.sha1)
    if (!hashes.length) return
    const byHash = await postJson<Record<string, MrVersion>>(`${API}/version_files`, { hashes, algorithm: 'sha1' })
    const ids = [...new Set(Object.values(byHash).map((v) => v.project_id))]
    const projects = await fetchJson<MrProject[]>(`${API}/projects?ids=${encodeURIComponent(JSON.stringify(ids))}`)
    const projectById = new Map(projects.map((p) => [p.id, p]))
    for (const f of mods) {
      const v = byHash[f.hashes.sha1]
      const p = v && projectById.get(v.project_id)
      if (!v || !p) continue
      const meta: InstalledContentMeta = {
        platform: 'modrinth',
        projectId: v.project_id,
        versionId: v.id,
        title: p.title,
        versionNumber: v.version_number,
        iconUrl: p.icon_url
      }
      await recordContent(inst.id, 'mod', path.basename(f.path), meta)
    }
  } catch {
    // Metadata is optional.
  }
}

export async function projectInfo(projectId: string): Promise<{ title: string; iconUrl?: string }> {
  const p = await getProject(projectId)
  return { title: p.title, iconUrl: p.icon_url }
}
