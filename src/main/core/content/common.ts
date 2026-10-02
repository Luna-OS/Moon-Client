import fsp from 'node:fs/promises'
import path from 'node:path'
import type AdmZip from 'adm-zip'
import type { LoaderType } from '../../../shared/types'

export interface ModpackManifest {
  name: string
  version?: string
  mcVersion: string
  loader: LoaderType
  loaderVersion?: string
  overrideDirs: string[]
}

/** Joins a relative path from an archive/manifest onto `base`, refusing to escape it. */
export function safeJoin(base: string, rel: string): string {
  const target = path.resolve(base, rel)
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`Ungültiger Pfad im Modpack: ${rel}`)
  }
  return target
}

/** Copies the contents of the given top-level folders of a modpack archive into `dest`. */
export async function extractOverrides(zip: AdmZip, folders: string[], dest: string): Promise<void> {
  for (const folder of folders) {
    const prefix = `${folder.replace(/\/$/, '')}/`
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue
      const rel = entry.entryName.slice(prefix.length)
      if (!rel) continue
      const target = safeJoin(dest, rel)
      await fsp.mkdir(path.dirname(target), { recursive: true })
      await fsp.writeFile(target, entry.getData())
    }
  }
}
