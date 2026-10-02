import { spawn } from 'node:child_process'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { downloadAll, exists, fetchJson, type DownloadItem, type ProgressFn } from './http'
import { paths } from './paths'

const RUNTIME_INDEX =
  'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'

interface RuntimeIndexEntry {
  manifest: { url: string; sha1: string; size: number }
  version: { name: string; released: string }
}
type RuntimeIndex = Record<string, Record<string, RuntimeIndexEntry[]>>

type RuntimeFile =
  | { type: 'file'; executable?: boolean; downloads: { raw: { url: string; sha1: string; size: number } } }
  | { type: 'directory' }
  | { type: 'link'; target: string }

function platformKey(): string | undefined {
  const { platform, arch } = process
  if (platform === 'win32') return arch === 'arm64' ? 'windows-arm64' : arch === 'ia32' ? 'windows-x86' : 'windows-x64'
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-os-arm64' : 'mac-os'
  if (platform === 'linux') return arch === 'ia32' ? 'linux-i386' : arch === 'x64' ? 'linux' : undefined
  return undefined
}

function javaExecutable(runtimeDir: string): string {
  if (process.platform === 'darwin') return path.join(runtimeDir, 'jre.bundle', 'Contents', 'Home', 'bin', 'java')
  if (process.platform === 'win32') return path.join(runtimeDir, 'bin', 'java.exe')
  return path.join(runtimeDir, 'bin', 'java')
}

/**
 * Downloads (or reuses) Mojang's Java runtime `component` (e.g. "java-runtime-delta")
 * and returns the path to its java executable.
 */
export async function ensureJavaRuntime(component: string, onProgress?: ProgressFn, concurrency = 16): Promise<string> {
  const key = platformKey()
  if (!key) {
    throw new Error(
      'Für dieses System stellt Mojang keine Java-Runtime bereit. Bitte installiere Java selbst und trage den Pfad in den Einstellungen ein.'
    )
  }
  const dir = path.join(paths.runtimes, component)
  const marker = path.join(dir, '.moon-runtime')
  const exe = javaExecutable(dir)

  const index = await fetchJson<RuntimeIndex>(RUNTIME_INDEX).catch(() => undefined)
  const entry = index?.[key]?.[component]?.[0]
  if (!entry) {
    // Offline or unknown component: use an existing installation if there is one.
    if (await exists(exe)) return exe
    throw new Error(`Java-Runtime "${component}" ist für ${key} nicht verfügbar`)
  }
  if ((await exists(marker)) && (await fsp.readFile(marker, 'utf8')) === entry.manifest.sha1 && (await exists(exe))) {
    return exe
  }

  const manifest = await fetchJson<{ files: Record<string, RuntimeFile> }>(entry.manifest.url)
  const downloads: DownloadItem[] = []
  const links: Array<[string, string]> = []
  for (const [rel, file] of Object.entries(manifest.files)) {
    const target = path.join(dir, rel)
    if (file.type === 'directory') await fsp.mkdir(target, { recursive: true })
    else if (file.type === 'file') {
      downloads.push({
        url: file.downloads.raw.url,
        dest: target,
        sha1: file.downloads.raw.sha1,
        size: file.downloads.raw.size,
        executable: file.executable
      })
    } else if (file.type === 'link') links.push([target, file.target])
  }
  await downloadAll(downloads, onProgress, concurrency)
  if (process.platform !== 'win32') {
    for (const [link, target] of links) {
      await fsp.rm(link, { force: true })
      await fsp.mkdir(path.dirname(link), { recursive: true })
      await fsp.symlink(target, link)
    }
  }
  await fsp.writeFile(marker, entry.manifest.sha1)
  return exe
}

/** Runs `java -version` and returns the first line of output, or throws if Java can't be started. */
export function probeJava(javaPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(javaPath, ['-version'], { windowsHide: true })
    let out = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(out.split(/\r?\n/).find((l) => l.includes('version')) ?? out.trim())
      else reject(new Error(`java -version beendet mit Code ${code}: ${out}`))
    })
  })
}
