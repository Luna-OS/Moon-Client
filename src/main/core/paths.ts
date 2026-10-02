import path from 'node:path'

/**
 * Directory layout of the launcher. `meta/` mirrors the official launcher's
 * `.minecraft` layout (versions/, libraries/, assets/) so Forge and NeoForge
 * installers can write into it directly.
 */
class LauncherPaths {
  private rootDir = ''

  setRoot(root: string): void {
    this.rootDir = root
  }

  get root(): string {
    if (!this.rootDir) throw new Error('Launcher-Verzeichnis wurde nicht initialisiert')
    return this.rootDir
  }

  get meta(): string {
    return path.join(this.root, 'meta')
  }
  get versions(): string {
    return path.join(this.meta, 'versions')
  }
  get libraries(): string {
    return path.join(this.meta, 'libraries')
  }
  get assets(): string {
    return path.join(this.meta, 'assets')
  }
  get natives(): string {
    return path.join(this.meta, 'natives')
  }
  get runtimes(): string {
    return path.join(this.root, 'runtimes')
  }
  get instances(): string {
    return path.join(this.root, 'instances')
  }
  get cache(): string {
    return path.join(this.root, 'cache')
  }
  get settingsFile(): string {
    return path.join(this.root, 'settings.json')
  }
  get accountsFile(): string {
    return path.join(this.root, 'accounts.json')
  }

  versionJson(id: string): string {
    return path.join(this.versions, id, `${id}.json`)
  }
  versionJar(id: string): string {
    return path.join(this.versions, id, `${id}.jar`)
  }
  instanceDir(id: string): string {
    return path.join(this.instances, id)
  }
}

export const paths = new LauncherPaths()
