import os from 'node:os'
import path from 'node:path'
import type { MinecraftVersion } from '../../shared/types'
import { exists, fetchJson, readJson, writeJson } from './http'
import { paths } from './paths'

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

export interface ManifestEntry extends MinecraftVersion {
  url: string
  sha1: string
}

interface VersionManifest {
  latest: { release: string; snapshot: string }
  versions: ManifestEntry[]
}

export interface Rule {
  action: 'allow' | 'disallow'
  os?: { name?: string; version?: string; arch?: string }
  features?: Record<string, boolean>
}

export type Argument = string | { rules?: Rule[]; value: string | string[] }

export interface Artifact {
  path?: string
  url: string
  sha1?: string
  size?: number
}

export interface Library {
  name: string
  url?: string
  sha1?: string
  size?: number
  rules?: Rule[]
  natives?: Record<string, string>
  extract?: { exclude?: string[] }
  downloads?: {
    artifact?: Artifact
    classifiers?: Record<string, Artifact>
  }
}

export interface VersionJson {
  id: string
  inheritsFrom?: string
  jar?: string
  type?: string
  mainClass: string
  minecraftArguments?: string
  arguments?: { game?: Argument[]; jvm?: Argument[] }
  libraries: Library[]
  assetIndex?: { id: string; url: string; sha1: string; size: number; totalSize?: number }
  assets?: string
  downloads?: { client?: Artifact }
  javaVersion?: { component: string; majorVersion: number }
  logging?: { client?: { argument: string; file: { id: string; url: string; sha1: string; size: number } } }
}

let manifestCache: { at: number; data: VersionManifest } | undefined

export async function getManifest(): Promise<VersionManifest> {
  if (manifestCache && Date.now() - manifestCache.at < 10 * 60_000) return manifestCache.data
  const cacheFile = path.join(paths.cache, 'version_manifest_v2.json')
  try {
    const data = await fetchJson<VersionManifest>(MANIFEST_URL)
    manifestCache = { at: Date.now(), data }
    await writeJson(cacheFile, data)
    return data
  } catch (e) {
    // Offline: fall back to the last manifest we saw.
    if (await exists(cacheFile)) return readJson<VersionManifest>(cacheFile)
    throw e
  }
}

export async function listMinecraftVersions(): Promise<MinecraftVersion[]> {
  const manifest = await getManifest()
  return manifest.versions.map(({ id, type, releaseTime }) => ({ id, type, releaseTime }))
}

/** Makes sure the vanilla version JSON for `id` exists locally and returns it. */
export async function ensureVanillaJson(id: string): Promise<VersionJson> {
  const file = paths.versionJson(id)
  if (await exists(file)) return readJson<VersionJson>(file)
  const manifest = await getManifest()
  const entry = manifest.versions.find((v) => v.id === id)
  if (!entry) throw new Error(`Unbekannte Minecraft-Version: ${id}`)
  const json = await fetchJson<VersionJson>(entry.url)
  await writeJson(file, json)
  return json
}

export async function readVersionJson(id: string): Promise<VersionJson> {
  const file = paths.versionJson(id)
  if (!(await exists(file))) return ensureVanillaJson(id)
  return readJson<VersionJson>(file)
}

export interface ResolvedVersion extends VersionJson {
  /** Id of the version whose client jar is used. */
  jarId: string
  /** The vanilla Minecraft version at the root of the inheritance chain. */
  baseId: string
}

/** Reads a version and merges its `inheritsFrom` chain the way the official launcher does. */
export async function resolveVersion(id: string): Promise<ResolvedVersion> {
  const json = await readVersionJson(id)
  if (!json.inheritsFrom) {
    return { ...json, jarId: json.jar ?? json.id, baseId: json.id }
  }
  const parent = await resolveVersion(json.inheritsFrom)
  return {
    ...parent,
    id: json.id,
    type: json.type ?? parent.type,
    mainClass: json.mainClass ?? parent.mainClass,
    minecraftArguments: json.minecraftArguments ?? parent.minecraftArguments,
    arguments:
      json.arguments || parent.arguments
        ? {
            game: [...(parent.arguments?.game ?? []), ...(json.arguments?.game ?? [])],
            jvm: [...(parent.arguments?.jvm ?? []), ...(json.arguments?.jvm ?? [])]
          }
        : undefined,
    // Child libraries come first so loaders can override vanilla ones.
    libraries: [...(json.libraries ?? []), ...parent.libraries],
    assetIndex: json.assetIndex ?? parent.assetIndex,
    assets: json.assets ?? parent.assets,
    downloads: json.downloads ?? parent.downloads,
    javaVersion: json.javaVersion ?? parent.javaVersion,
    logging: json.logging ?? parent.logging,
    jarId: json.jar ?? parent.jarId,
    baseId: parent.baseId
  }
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export function osName(): 'windows' | 'osx' | 'linux' {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'osx'
  return 'linux'
}

function archMatches(arch: string): boolean {
  if (arch === 'x86') return process.arch === 'ia32'
  if (arch === 'x86_64' || arch === 'amd64') return process.arch === 'x64'
  if (arch === 'arm64' || arch === 'aarch64') return process.arch === 'arm64'
  return arch === process.arch
}

function ruleMatches(rule: Rule, features: Record<string, boolean>): boolean {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== osName()) return false
    if (rule.os.arch && !archMatches(rule.os.arch)) return false
    if (rule.os.version) {
      try {
        if (!new RegExp(rule.os.version).test(os.release())) return false
      } catch {
        return false
      }
    }
  }
  if (rule.features) {
    for (const [key, value] of Object.entries(rule.features)) {
      if ((features[key] ?? false) !== value) return false
    }
  }
  return true
}

export function rulesAllow(rules: Rule[] | undefined, features: Record<string, boolean> = {}): boolean {
  if (!rules || rules.length === 0) return true
  let allowed = false
  for (const rule of rules) {
    if (ruleMatches(rule, features)) allowed = rule.action === 'allow'
  }
  return allowed
}

// ---------------------------------------------------------------------------
// Libraries
// ---------------------------------------------------------------------------

/** Converts `group:artifact:version[:classifier][@ext]` into a maven repository path. */
export function mavenPath(name: string): string {
  let ext = 'jar'
  let coords = name
  const at = coords.indexOf('@')
  if (at !== -1) {
    ext = coords.slice(at + 1)
    coords = coords.slice(0, at)
  }
  const [group, artifact, version, classifier] = coords.split(':')
  const file = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${ext}`
  return [...group.split('.'), artifact, version, file].join('/')
}

/** Key used to de-duplicate libraries: group:artifact[:classifier], ignoring the version. */
export function libraryKey(name: string): string {
  const [group, artifact, , classifier] = name.split('@')[0].split(':')
  return [group, artifact, classifier].filter(Boolean).join(':')
}

function nativeClassifier(lib: Library): string | undefined {
  const raw = lib.natives?.[osName()]
  if (!raw) return undefined
  return raw.replace('${arch}', process.arch === 'ia32' ? '32' : '64')
}

export interface LibraryFile {
  name: string
  path: string
  url?: string
  sha1?: string
  size?: number
  /** Legacy native archives that have to be extracted before launch. */
  isNative: boolean
  exclude?: string[]
}

/** Lists the files the given libraries need on this platform (rules applied, de-duplicated). */
export function libraryFiles(libraries: Library[], features: Record<string, boolean> = {}): LibraryFile[] {
  const result: LibraryFile[] = []
  const seen = new Set<string>()
  for (const lib of libraries) {
    if (!rulesAllow(lib.rules, features)) continue
    const key = libraryKey(lib.name)
    const classifier = nativeClassifier(lib)

    if (!seen.has(key)) {
      seen.add(key)
      const artifact = lib.downloads?.artifact
      if (artifact) {
        const rel = artifact.path ?? mavenPath(lib.name)
        result.push({
          name: lib.name,
          path: path.join(paths.libraries, rel),
          // An empty url means the file is generated locally (e.g. by the Forge installer).
          url: artifact.url || undefined,
          sha1: artifact.sha1,
          size: artifact.size,
          isNative: false
        })
      } else if (!lib.downloads) {
        const rel = mavenPath(lib.name)
        const base = (lib.url ?? 'https://libraries.minecraft.net/').replace(/\/?$/, '/')
        result.push({
          name: lib.name,
          path: path.join(paths.libraries, rel),
          url: base + rel,
          sha1: lib.sha1,
          size: lib.size,
          isNative: false
        })
      }
    }

    if (classifier) {
      const nativeKey = `${key}:${classifier}`
      if (seen.has(nativeKey)) continue
      seen.add(nativeKey)
      const artifact = lib.downloads?.classifiers?.[classifier]
      const rel = artifact?.path ?? mavenPath(`${lib.name}:${classifier}`)
      const base = (lib.url ?? 'https://libraries.minecraft.net/').replace(/\/?$/, '/')
      result.push({
        name: `${lib.name}:${classifier}`,
        path: path.join(paths.libraries, rel),
        url: artifact?.url ?? base + rel,
        sha1: artifact?.sha1,
        size: artifact?.size,
        isNative: true,
        exclude: lib.extract?.exclude
      })
    }
  }
  return result
}
