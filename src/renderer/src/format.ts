export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Mio.`
  if (n >= 1_000) return `${(n / 1_000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Tsd.`
  return n.toLocaleString('de-DE')
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

export function formatPlayTime(ms = 0): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'noch nicht gespielt'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h} Std. ${m} Min.` : `${m} Min.`
}

export function formatRelative(ts?: number | string): string {
  if (!ts) return 'nie'
  const t = typeof ts === 'string' ? Date.parse(ts) : ts
  const diff = Date.now() - t
  const day = 86_400_000
  if (diff < 60_000) return 'gerade eben'
  if (diff < 3_600_000) return `vor ${Math.floor(diff / 60_000)} Min.`
  if (diff < day) return `vor ${Math.floor(diff / 3_600_000)} Std.`
  if (diff < 30 * day) return `vor ${Math.floor(diff / day)} Tagen`
  return new Date(t).toLocaleDateString('de-DE')
}

export function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  // Strip Electron's "Error invoking remote method 'x': Error: " prefix.
  return msg.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

export function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Gute Nacht'
  if (h < 11) return 'Guten Morgen'
  if (h < 18) return 'Guten Tag'
  return 'Guten Abend'
}
