import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import AdmZip from 'adm-zip'
import type { LoaderType, LoaderVersion } from '../../shared/types'
import { downloadFile, exists, fetchJson, writeJson } from './http'
import { paths } from './paths'
import type { VersionJson } from './versions'

const FABRIC_META = 'https://meta.fabricmc.net/v2'
const QUILT_META = 'https://meta.quiltmc.org/v3'
const FORGE_MAVEN = 'https://maven.minecraftforge.net/net/minecraftforge/forge'
const FORGE_FILES = 'https://files.minecraftforge.net/net/minecraftforge/forge'
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/net/neoforged/neoforge'
const NEOFORGE_API = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'

// Small in-memory cache so the UI can ask repeatedly without hammering the APIs.
const cache = new Map<string, { at: number; value: unknown }>()
async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.value as T
  const value = await load()
  cache.set(key, { at: Date.now(), value })
  return value
}

const forgeMetadata = () =>
  cached('forge-meta', () => fetchJson<Record<string, string[]>>(`${FORGE_FILES}/maven-metadata.json`))
const forgePromotions = () =>
  cached('forge-promos', () =>
    fetchJson<{ promos: Record<string, string> }>(`${FORGE_FILES}/promotions_slim.json`).then((r) => r.promos)
  )
const neoforgeVersions = () =>
  cached('neoforge-versions', () => fetchJson<{ versions: string[] }>(NEOFORGE_API).then((r) => r.versions))

/**
 * Maps a NeoForge version to the Minecraft version it targets.
 * 21.1.77 -> 1.21.1, 21.0.5 -> 1.21, 26.1.0.12-beta -> 26.1, 26.1.2.3 -> 26.1.2
 */
export function neoforgeToMinecraft(version: string): string | undefined {
  const parts = version.split('-')[0].split('.')
  if (parts[0] === '0') return undefined // April fools / experimental builds
  if (parts.length >= 4) return parts[2] === '0' ? `${parts[0]}.${parts[1]}` : `${parts[0]}.${parts[1]}.${parts[2]}`
  return parts[1] === '0' ? `1.${parts[0]}` : `1.${parts[0]}.${parts[1]}`
}

/** Minecraft versions a loader supports, or undefined for "all" (vanilla). */
export async function loaderGameVersions(loader: LoaderType): Promise<string[] | undefined> {
  switch (loader) {
    case 'vanilla':
      return undefined
    case 'fabric':
      return cached('fabric-game', async () =>
        (await fetchJson<Array<{ version: string }>>(`${FABRIC_META}/versions/game`)).map((v) => v.version)
      )
    case 'quilt':
      return cached('quilt-game', async () =>
        (await fetchJson<Array<{ version: string }>>(`${QUILT_META}/versions/game`)).map((v) => v.version)
      )
    case 'forge':
      return Object.keys(await forgeMetadata())
    case 'neoforge': {
      const set = new Set<string>()
      for (const v of await neoforgeVersions()) {
        const mc = neoforgeToMinecraft(v)
        if (mc) set.add(mc)
      }
      return [...set]
    }
  }
}

/** Loader versions available for a Minecraft version, newest first. */
export async function listLoaderVersions(loader: LoaderType, mcVersion: string): Promise<LoaderVersion[]> {
  switch (loader) {
    case 'vanilla':
      return []
    case 'fabric':
    case 'quilt': {
      const base = loader === 'fabric' ? FABRIC_META : QUILT_META
      const list = await fetchJson<Array<{ loader: { version: string; stable?: boolean } }>>(
        `${base}/versions/loader/${encodeURIComponent(mcVersion)}`
      )
      return list.map(({ loader: l }) => ({
        version: l.version,
        stable: l.stable ?? !/beta|alpha|pre|rc/i.test(l.version)
      }))
    }
    case 'forge': {
      const [meta, promos] = await Promise.all([forgeMetadata(), forgePromotions()])
      const recommended = promos[`${mcVersion}-recommended`]
      const latest = promos[`${mcVersion}-latest`]
      return (meta[mcVersion] ?? [])
        .map((full) => full.slice(mcVersion.length + 1))
        .reverse()
        .map((version) => ({
          version,
          stable: version === recommended || version === latest || !recommended,
          recommended: version === recommended
        }))
    }
    case 'neoforge': {
      return (await neoforgeVersions())
        .filter((v) => neoforgeToMinecraft(v) === mcVersion)
        .reverse()
        .map((version) => ({ version, stable: !/beta|alpha/i.test(version) }))
    }
  }
}

/** The version id the loader's profile will be stored as. */
export function loaderVersionId(loader: LoaderType, mcVersion: string, loaderVersion?: string): string {
  switch (loader) {
    case 'vanilla':
      return mcVersion
    case 'fabric':
      return `fabric-loader-${loaderVersion}-${mcVersion}`
    case 'quilt':
      return `quilt-loader-${loaderVersion}-${mcVersion}`
    case 'forge':
      return `${mcVersion}-forge-${loaderVersion}`
    case 'neoforge':
      return `neoforge-${loaderVersion}`
  }
}

async function installProfileLoader(loader: 'fabric' | 'quilt', mcVersion: string, loaderVersion: string) {
  const base = loader === 'fabric' ? FABRIC_META : QUILT_META
  const profile = await fetchJson<VersionJson>(
    `${base}/versions/loader/${encodeURIComponent(mcVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`
  )
  await writeJson(paths.versionJson(profile.id), profile)
  return profile.id
}

export type LogFn = (line: string) => void

function runJava(java: string, args: string[], cwd: string, log: LogFn): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(java, args, { cwd, windowsHide: true })
    const tail: string[] = []
    const onData = (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.trim()) continue
        log(line)
        tail.push(line)
        if (tail.length > 30) tail.shift()
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Installer beendet mit Code ${code}\n${tail.join('\n')}`))
    })
  })
}

/**
 * Runs the official Forge/NeoForge installer headless against our meta directory.
 * The installer downloads its libraries and runs the jar processors itself.
 */
async function installWithInstaller(
  loader: 'forge' | 'neoforge',
  mcVersion: string,
  loaderVersion: string,
  java: string,
  log: LogFn
): Promise<string> {
  const full = loader === 'forge' ? `${mcVersion}-${loaderVersion}` : loaderVersion
  const url =
    loader === 'forge'
      ? `${FORGE_MAVEN}/${full}/forge-${full}-installer.jar`
      : `${NEOFORGE_MAVEN}/${full}/neoforge-${full}-installer.jar`
  const installer = path.join(paths.cache, 'installers', path.basename(url))
  log(`Lade Installer ${path.basename(url)} …`)
  await downloadFile({ url, dest: installer })

  const profile = JSON.parse(new AdmZip(installer).readAsText('install_profile.json') || '{}') as {
    version?: string
    install?: { target?: string }
  }
  const versionId = profile.version ?? profile.install?.target
  if (!versionId) throw new Error('install_profile.json im Installer enthält keine Versions-ID')
  if (await exists(paths.versionJson(versionId))) return versionId

  // The installers refuse to run without a launcher profile file in the target directory.
  const profiles = path.join(paths.meta, 'launcher_profiles.json')
  if (!(await exists(profiles))) await writeJson(profiles, { profiles: {} })

  const flag = loader === 'forge' ? '--installClient' : '--install-client'
  log(`Starte ${loader === 'forge' ? 'Forge' : 'NeoForge'}-Installer …`)
  await runJava(java, ['-jar', installer, flag, paths.meta], paths.cache, log)

  if (!(await exists(paths.versionJson(versionId)))) {
    throw new Error(`Installer lief durch, aber ${versionId}.json wurde nicht erstellt`)
  }
  await fsp.rm(path.join(paths.meta, 'installer.log'), { force: true })
  await fsp.rm(`${installer}.log`, { force: true })
  return versionId
}

/**
 * Installs the loader profile for an instance (if needed) and returns the version id to launch.
 * The vanilla version must already be installed, since Forge/NeoForge installers patch its jar.
 */
export async function installLoader(
  loader: LoaderType,
  mcVersion: string,
  loaderVersion: string | undefined,
  java: string,
  log: LogFn
): Promise<string> {
  if (loader === 'vanilla') return mcVersion
  if (!loaderVersion) {
    const versions = await listLoaderVersions(loader, mcVersion)
    const pick = versions.find((v) => v.recommended) ?? versions.find((v) => v.stable) ?? versions[0]
    if (!pick) throw new Error(`Keine ${loader}-Version für Minecraft ${mcVersion} gefunden`)
    loaderVersion = pick.version
  }
  const expected = loaderVersionId(loader, mcVersion, loaderVersion)
  if (await exists(paths.versionJson(expected))) return expected
  if (loader === 'fabric' || loader === 'quilt') return installProfileLoader(loader, mcVersion, loaderVersion)
  return installWithInstaller(loader, mcVersion, loaderVersion, java, log)
}
