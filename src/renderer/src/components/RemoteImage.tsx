import { useState, type ReactNode } from 'react'

/** An external image that falls back to a placeholder when it is missing or fails to load. */
export function RemoteImage({ src, className, fallback }: { src?: string; className: string; fallback: ReactNode }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return <div className={`${className} placeholder`}>{fallback}</div>
  return <img className={className} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
}
