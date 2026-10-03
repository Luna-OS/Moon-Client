import { randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import type { ContentKind, InstalledContent, InstalledContentMeta, Instance, NewInstance } from '../../shared/types'
import { exists, readJson, writeJson } from './http'
import { paths } from './paths'

const INSTANCE_FILE = 'moon-instance.json'
const CONTENT_FILE = 'moon-content.json'

export const CONTENT_FOLDERS: Record<Exclude<ContentKind, 'modpack'>, string> = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks'
}

export async function listInstances(): Promise<Instance[]> {
  await fsp.mkdir(paths.instances, { recursive: true })
  const dirs = await fsp.readdir(paths.instances, { withFileTypes: true })
  const result: Instance[] = []
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const file = path.join(paths.instances, d.name, INSTANCE_FILE)
    if (await exists(file)) {
      try {
        result.push(await readJson<Instance>(file))
      } catch {
        // Ignore broken instance files instead of hiding every instance.
      }
    }
  }
  return result.sort((a, b) => (b.lastPlayed ?? b.createdAt) - (a.lastPlayed ?? a.createdAt))
}

export async function getInstance(id: string): Promise<Instance> {
  const file = path.join(paths.instanceDir(id), INSTANCE_FILE)
  if (!(await exists(file))) throw new Error('Instanz nicht gefunden')
  return readJson<Instance>(file)
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return slug || 'instanz'
}

export async function createInstance(data: NewInstance): Promise<Instance> {
  let id = slugify(data.name)
  if (await exists(paths.instanceDir(id))) id = `${id}-${randomUUID().slice(0, 6)}`
  const instance: Instance = { ...data, id, createdAt: Date.now() }
  await saveInstance(instance)
  return instance
}

export async function saveInstance(instance: Instance): Promise<Instance> {
  await writeJson(path.join(paths.instanceDir(instance.id), INSTANCE_FILE), instance)
  return instance
}

export async function updateInstance(id: string, patch: Partial<Instance>): Promise<Instance> {
  const current = await getInstance(id)
  return saveInstance({ ...current, ...patch, id })
}

export async function deleteInstance(id: string): Promise<void> {
  const dir = paths.instanceDir(id)
  if (!dir.startsWith(paths.instances + path.sep)) throw new Error('Ungültige Instanz')
  await fsp.rm(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// Installed content (mods, resource packs, shaders)
// ---------------------------------------------------------------------------

type ContentIndex = Record<string, InstalledContentMeta>

async function readContentIndex(instanceId: string): Promise<ContentIndex> {
  const file = path.join(paths.instanceDir(instanceId), CONTENT_FILE)
  return (await exists(file)) ? readJson<ContentIndex>(file) : {}
}

async function writeContentIndex(instanceId: string, index: ContentIndex): Promise<void> {
  await writeJson(path.join(paths.instanceDir(instanceId), CONTENT_FILE), index)
}

const indexKey = (kind: Exclude<ContentKind, 'modpack'>, fileName: string) =>
  `${CONTENT_FOLDERS[kind]}/${fileName.replace(/\.disabled$/, '')}`

export function contentDir(instanceId: string, kind: Exclude<ContentKind, 'modpack'>): string {
  return path.join(paths.instanceDir(instanceId), CONTENT_FOLDERS[kind])
}

export async function listContent(instanceId: string, kind: Exclude<ContentKind, 'modpack'>): Promise<InstalledContent[]> {
  const dir = contentDir(instanceId, kind)
  await fsp.mkdir(dir, { recursive: true })
  const index = await readContentIndex(instanceId)
  const entries = await fsp.readdir(dir, { withFileTypes: true })
  const result: InstalledContent[] = []
  for (const e of entries) {
    const isArchive = /\.(jar|zip)(\.disabled)?$/i.test(e.name)
    if (!(e.isFile() && isArchive) && !(kind !== 'mod' && e.isDirectory())) continue
    const stat = await fsp.stat(path.join(dir, e.name))
    result.push({
      fileName: e.name,
      enabled: !e.name.endsWith('.disabled'),
      size: stat.size,
      meta: index[indexKey(kind, e.name)]
    })
  }
  return result.sort((a, b) => (a.meta?.title ?? a.fileName).localeCompare(b.meta?.title ?? b.fileName))
}

/** Records metadata for a file that was just downloaded into an instance. */
export async function recordContent(
  instanceId: string,
  kind: Exclude<ContentKind, 'modpack'>,
  fileName: string,
  meta: InstalledContentMeta
): Promise<void> {
  const index = await readContentIndex(instanceId)
  // Replacing an older version of the same project: drop the old file.
  for (const [key, existing] of Object.entries(index)) {
    if (
      key.startsWith(`${CONTENT_FOLDERS[kind]}/`) &&
      existing.platform === meta.platform &&
      existing.projectId === meta.projectId &&
      key !== indexKey(kind, fileName)
    ) {
      const old = path.join(paths.instanceDir(instanceId), key)
      await fsp.rm(old, { force: true })
      await fsp.rm(`${old}.disabled`, { force: true })
      delete index[key]
    }
  }
  index[indexKey(kind, fileName)] = meta
  await writeContentIndex(instanceId, index)
}

export async function findInstalledProject(
  instanceId: string,
  platform: string,
  projectId: string
): Promise<InstalledContentMeta | undefined> {
  const index = await readContentIndex(instanceId)
  return Object.values(index).find((m) => m.platform === platform && m.projectId === projectId)
}

export async function setContentEnabled(
  instanceId: string,
  kind: Exclude<ContentKind, 'modpack'>,
  fileName: string,
  enabled: boolean
): Promise<void> {
  const dir = contentDir(instanceId, kind)
  const base = fileName.replace(/\.disabled$/, '')
  const from = path.join(dir, fileName)
  const to = path.join(dir, enabled ? base : `${base}.disabled`)
  if (from !== to) await fsp.rename(from, to)
}

export async function deleteContent(
  instanceId: string,
  kind: Exclude<ContentKind, 'modpack'>,
  fileName: string
): Promise<void> {
  const dir = contentDir(instanceId, kind)
  const file = path.join(dir, path.basename(fileName))
  await fsp.rm(file, { recursive: true, force: true })
  const index = await readContentIndex(instanceId)
  delete index[indexKey(kind, fileName)]
  await writeContentIndex(instanceId, index)
}
