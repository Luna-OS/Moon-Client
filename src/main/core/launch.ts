import { spawn, type ChildProcess } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import AdmZip from 'adm-zip'
import type { Instance, Settings } from '../../shared/types'
import { downloadAll, exists, LAUNCHER_NAME, LAUNCHER_VERSION, readJson, type DownloadItem } from './http'
import { ensureJavaRuntime } from './java'
import { installLoader, type LogFn } from './loaders'
import { paths } from './paths'
import {
  ensureVanillaJson,
  libraryFiles,
  resolveVersion,
  rulesAllow,
  type Argument,
  type ResolvedVersion
} from './versions'

export interface LaunchAuth {
  name: string
  uuid: string
  accessToken: string
  xuid?: string
  userType: 'msa' | 'legacy'
}

export interface StepProgress {
  (step: string, current: number, total: number): void
}

interface AssetIndex {
  virtual?: boolean
  map_to_resources?: boolean
  objects: Record<string, { hash: string; size: number }>
}

export interface PreparedLaunch {
  version: ResolvedVersion
  java: string
  jarPath: string
  nativesDir: string
}

const DEFAULT_JAVA_COMPONENT = 'jre-legacy'

/** Downloads everything an instance needs (Java, loader, libraries, assets) and returns launch data. */
export async function prepareInstance(
  inst: Instance,
  settings: Settings,
  progress: StepProgress,
  log: LogFn
): Promise<PreparedLaunch> {
  const concurrency = settings.downloadConcurrency || 16
  const gameDir = paths.instanceDir(inst.id)

  progress('Minecraft-Version wird geladen', 0, 1)
  const vanilla = await ensureVanillaJson(inst.mcVersion)

  const customJava = inst.javaPath || settings.javaPath
  const java =
    customJava ||
    (await ensureJavaRuntime(
      vanilla.javaVersion?.component ?? DEFAULT_JAVA_COMPONENT,
      (c, t) => progress('Java wird heruntergeladen', c, t),
      concurrency
    ))

  // Vanilla files first: the Forge/NeoForge installers expect the client jar and libraries.
  await downloadVersionFiles(await resolveVersion(inst.mcVersion), gameDir, progress, concurrency)

  progress(`${inst.loader === 'vanilla' ? 'Version' : 'Mod-Loader'} wird installiert`, 0, 1)
  const versionId = await installLoader(inst.loader, inst.mcVersion, inst.loaderVersion, java, log)
  const version = await resolveVersion(versionId)
  const jarPath = await downloadVersionFiles(version, gameDir, progress, concurrency)

  const nativesDir = path.join(paths.natives, version.id)
  await extractNatives(version, nativesDir)
  return { version, java, jarPath, nativesDir }
}

async function downloadVersionFiles(
  version: ResolvedVersion,
  gameDir: string,
  progress: StepProgress,
  concurrency: number
): Promise<string> {
  const items: DownloadItem[] = []

  // Client jar. Loader versions get their own copy named after the version id,
  // which is what Forge's module-path ignore list expects.
  const baseJar = paths.versionJar(version.jarId)
  const client = version.downloads?.client
  if (client) items.push({ url: client.url, dest: baseJar, sha1: client.sha1, size: client.size })

  for (const lib of libraryFiles(version.libraries)) {
    if (lib.url) items.push({ url: lib.url, dest: lib.path, sha1: lib.sha1, size: lib.size })
  }

  const logging = version.logging?.client
  if (logging) {
    items.push({
      url: logging.file.url,
      dest: path.join(paths.assets, 'log_configs', logging.file.id),
      sha1: logging.file.sha1,
      size: logging.file.size
    })
  }

  await downloadAll(items, (c, t) => progress('Bibliotheken werden geladen', c, t), concurrency)
  await downloadAssets(version, gameDir, progress, concurrency)

  let jarPath = baseJar
  if (version.id !== version.jarId) {
    jarPath = paths.versionJar(version.id)
    if (!(await exists(jarPath))) await fsp.copyFile(baseJar, jarPath)
  }

  const missing: string[] = []
  for (const lib of libraryFiles(version.libraries)) {
    if (!(await exists(lib.path))) missing.push(lib.name)
  }
  if (missing.length) throw new Error(`Fehlende Bibliotheken: ${missing.join(', ')}`)
  return jarPath
}

async function downloadAssets(version: ResolvedVersion, gameDir: string, progress: StepProgress, concurrency: number) {
  const indexInfo = version.assetIndex
  if (!indexInfo) return
  const indexFile = path.join(paths.assets, 'indexes', `${indexInfo.id}.json`)
  await downloadAll([{ url: indexInfo.url, dest: indexFile, sha1: indexInfo.sha1, size: indexInfo.size }])
  const index = await readJson<AssetIndex>(indexFile)

  const objectPath = (hash: string) => path.join(paths.assets, 'objects', hash.slice(0, 2), hash)
  const items = Object.values(index.objects).map(({ hash, size }) => ({
    url: `https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`,
    dest: objectPath(hash),
    sha1: hash,
    size
  }))
  await downloadAll(items, (c, t) => progress('Assets werden geladen', c, t), concurrency)

  // Very old versions read assets from a flat directory instead of the object store.
  if (index.virtual || index.map_to_resources) {
    const target = index.map_to_resources
      ? path.join(gameDir, 'resources')
      : path.join(paths.assets, 'virtual', indexInfo.id)
    for (const [name, { hash, size }] of Object.entries(index.objects)) {
      const dest = path.join(target, name)
      const stat = await fsp.stat(dest).catch(() => undefined)
      if (stat?.size === size) continue
      await fsp.mkdir(path.dirname(dest), { recursive: true })
      await fsp.copyFile(objectPath(hash), dest)
    }
  }
}

async function extractNatives(version: ResolvedVersion, nativesDir: string) {
  const natives = libraryFiles(version.libraries).filter((l) => l.isNative)
  await fsp.mkdir(nativesDir, { recursive: true })
  for (const lib of natives) {
    const zip = new AdmZip(lib.path)
    const exclude = lib.exclude ?? ['META-INF/']
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || exclude.some((e) => entry.entryName.startsWith(e))) continue
      const dest = path.join(nativesDir, entry.entryName)
      if (!dest.startsWith(nativesDir + path.sep)) continue // zip-slip guard
      // Files may be in use by another running instance (locked on Windows), so only add missing ones.
      const stat = await fsp.stat(dest).catch(() => undefined)
      if (stat?.size === entry.header.size) continue
      await fsp.mkdir(path.dirname(dest), { recursive: true })
      await fsp.writeFile(dest, entry.getData())
    }
  }
}

function expand(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{([^}]+)\}/g, (match, key: string) => vars[key] ?? match)
}

function processArguments(args: Argument[], vars: Record<string, string>, features: Record<string, boolean>): string[] {
  const out: string[] = []
  for (const arg of args) {
    if (typeof arg === 'string') {
      out.push(expand(arg, vars))
    } else if (rulesAllow(arg.rules, features)) {
      const values = Array.isArray(arg.value) ? arg.value : [arg.value]
      out.push(...values.map((v) => expand(v, vars)))
    }
  }
  return out
}

function splitArgs(input: string | undefined): string[] {
  if (!input) return []
  return (input.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []).map((a) => a.replace(/"/g, ''))
}

/** Builds the full java command line for a prepared instance. */
export function buildLaunchArgs(
  inst: Instance,
  settings: Settings,
  prepared: PreparedLaunch,
  auth: LaunchAuth
): string[] {
  const { version, jarPath, nativesDir } = prepared
  const gameDir = paths.instanceDir(inst.id)
  const features: Record<string, boolean> = {
    is_demo_user: false,
    has_custom_resolution: Boolean(inst.width && inst.height)
  }

  const classpath = [
    ...libraryFiles(version.libraries, features)
      .filter((l) => !l.isNative)
      .map((l) => l.path),
    jarPath
  ]

  const assetsId = version.assetIndex?.id ?? version.assets ?? 'legacy'
  const vars: Record<string, string> = {
    auth_player_name: auth.name,
    auth_uuid: auth.uuid,
    auth_access_token: auth.accessToken,
    auth_session: `token:${auth.accessToken}:${auth.uuid}`,
    auth_xuid: auth.xuid ?? '0',
    clientid: '',
    user_type: auth.userType,
    user_properties: '{}',
    version_name: version.id,
    version_type: 'Moon Client',
    game_directory: gameDir,
    assets_root: paths.assets,
    game_assets: assetsId === 'legacy' || assetsId === 'pre-1.6' ? path.join(paths.assets, 'virtual', assetsId) : paths.assets,
    assets_index_name: assetsId,
    natives_directory: nativesDir,
    launcher_name: LAUNCHER_NAME,
    launcher_version: LAUNCHER_VERSION,
    classpath: classpath.join(path.delimiter),
    classpath_separator: path.delimiter,
    library_directory: paths.libraries,
    primary_jar_name: path.basename(jarPath),
    resolution_width: String(inst.width ?? 854),
    resolution_height: String(inst.height ?? 480)
  }

  const memory = inst.memoryMb || settings.memoryMb || 4096
  const jvm: string[] = [`-Xmx${memory}M`, `-Xms${Math.min(memory, 512)}M`]
  if (version.logging?.client) {
    const file = path.join(paths.assets, 'log_configs', version.logging.client.file.id)
    jvm.push(expand(version.logging.client.argument, { path: file }))
  }
  jvm.push(...splitArgs(settings.jvmArgs), ...splitArgs(inst.jvmArgs))

  if (version.arguments?.jvm?.length) {
    jvm.push(...processArguments(version.arguments.jvm, vars, features))
  } else {
    if (process.platform === 'darwin') jvm.push('-XstartOnFirstThread')
    jvm.push(`-Djava.library.path=${nativesDir}`, '-cp', vars.classpath)
  }

  const game = version.arguments?.game?.length
    ? processArguments(version.arguments.game, vars, features)
    : splitArgs(version.minecraftArguments).map((a) => expand(a, vars))
  if (!version.arguments?.game?.length && inst.width && inst.height) {
    game.push('--width', String(inst.width), '--height', String(inst.height))
  }

  return [...jvm, version.mainClass, ...game]
}

export function spawnGame(java: string, args: string[], cwd: string): ChildProcess {
  return spawn(java, args, { cwd, windowsHide: true, env: { ...process.env } })
}

/** Creates the folders the game expects inside an instance. */
export async function ensureGameDirs(instanceId: string): Promise<void> {
  const dir = paths.instanceDir(instanceId)
  for (const sub of ['mods', 'resourcepacks', 'shaderpacks', 'saves', 'config']) {
    await fsp.mkdir(path.join(dir, sub), { recursive: true })
  }
}
