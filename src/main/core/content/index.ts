import AdmZip from 'adm-zip'
import type {
  ContentKind,
  ContentSearchQuery,
  ContentSearchResult,
  ContentVersion,
  Instance,
  LoaderType,
  ModpackResult,
  Platform,
  Settings
} from '../../../shared/types'
import type { ProgressFn } from '../http'
import { createInstance, deleteInstance } from '../instances'
import type { ModpackManifest } from './common'
import * as curseforge from './curseforge'
import * as modrinth from './modrinth'

export function searchContent(settings: Settings, q: ContentSearchQuery): Promise<ContentSearchResult> {
  return q.platform === 'modrinth' ? modrinth.search(q) : curseforge.search(settings.curseforgeApiKey, q)
}

export function contentVersions(
  settings: Settings,
  platform: Platform,
  projectId: string,
  kind: ContentKind,
  mcVersion?: string,
  loader?: LoaderType
): Promise<ContentVersion[]> {
  return platform === 'modrinth'
    ? modrinth.versions(projectId, kind, mcVersion, loader)
    : curseforge.versions(settings.curseforgeApiKey, projectId, kind, mcVersion, loader)
}

export function installContent(
  settings: Settings,
  inst: Instance,
  platform: Platform,
  kind: Exclude<ContentKind, 'modpack'>,
  projectId: string,
  versionId?: string,
  onProgress?: ProgressFn
): Promise<string[]> {
  return platform === 'modrinth'
    ? modrinth.installProject(inst, kind, projectId, versionId, onProgress)
    : curseforge.installProject(settings.curseforgeApiKey, inst, kind, projectId, versionId, onProgress)
}

async function createFromPack(
  settings: Settings,
  file: string,
  format: Platform,
  manifest: ModpackManifest,
  extra: Partial<Instance>,
  onProgress?: ProgressFn
): Promise<ModpackResult> {
  const instance = await createInstance({
    name: extra.name ?? manifest.name,
    mcVersion: manifest.mcVersion,
    loader: manifest.loader,
    loaderVersion: manifest.loaderVersion,
    iconUrl: extra.iconUrl,
    source: extra.source
  })
  try {
    const warnings =
      format === 'modrinth'
        ? (await modrinth.installMrpackFiles(file, instance, onProgress, settings.downloadConcurrency), [])
        : await curseforge.installCurseforgePackFiles(
            settings.curseforgeApiKey,
            file,
            instance,
            onProgress,
            settings.downloadConcurrency
          )
    return { instance, warnings }
  } catch (e) {
    // Don't leave half-installed instances behind.
    await deleteInstance(instance.id).catch(() => undefined)
    throw e
  }
}

export async function installModpack(
  settings: Settings,
  platform: Platform,
  projectId: string,
  versionId: string | undefined,
  onProgress?: ProgressFn
): Promise<ModpackResult> {
  if (platform === 'modrinth') {
    const [{ file, versionId: vid }, info] = await Promise.all([
      modrinth.downloadModpack(projectId, versionId),
      modrinth.projectInfo(projectId)
    ])
    return createFromPack(
      settings,
      file,
      'modrinth',
      modrinth.readMrpack(file),
      { name: info.title, iconUrl: info.iconUrl, source: { platform, projectId, versionId: vid, name: info.title } },
      onProgress
    )
  }
  const key = settings.curseforgeApiKey
  const [{ file, versionId: vid }, info] = await Promise.all([
    curseforge.downloadModpack(key, projectId, versionId),
    curseforge.projectInfo(key, projectId)
  ])
  return createFromPack(
    settings,
    file,
    'curseforge',
    curseforge.readCurseforgePack(file),
    { name: info.title, iconUrl: info.iconUrl, source: { platform, projectId, versionId: vid, name: info.title } },
    onProgress
  )
}

/** Imports a local .mrpack or CurseForge modpack .zip. */
export async function importModpackFile(settings: Settings, file: string, onProgress?: ProgressFn): Promise<ModpackResult> {
  const zip = new AdmZip(file)
  if (zip.getEntry('modrinth.index.json')) {
    return createFromPack(settings, file, 'modrinth', modrinth.readMrpack(file), {}, onProgress)
  }
  if (zip.getEntry('manifest.json')) {
    return createFromPack(settings, file, 'curseforge', curseforge.readCurseforgePack(file), {}, onProgress)
  }
  throw new Error('Unbekanntes Modpack-Format. Unterstützt werden .mrpack (Modrinth) und CurseForge-.zip.')
}
