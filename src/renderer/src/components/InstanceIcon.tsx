import { useState } from 'react'
import { Box, Hammer, Layers, Scroll, Sparkles } from 'lucide-react'
import type { Instance, LoaderType } from '@shared/types'

const LOADER_ICONS: Record<LoaderType, typeof Box> = {
  vanilla: Box,
  fabric: Scroll,
  quilt: Layers,
  forge: Hammer,
  neoforge: Sparkles
}

export function LoaderIcon({ loader, size = 14 }: { loader: LoaderType; size?: number }) {
  const Icon = LOADER_ICONS[loader]
  return <Icon size={size} />
}

export function InstanceIcon({ instance, size = 48 }: { instance: Pick<Instance, 'iconUrl' | 'loader' | 'name'>; size?: number }) {
  const [failed, setFailed] = useState(false)
  if (instance.iconUrl && !failed) {
    return (
      <img className="instance-icon" src={instance.iconUrl} alt="" width={size} height={size} onError={() => setFailed(true)} />
    )
  }
  return (
    <div className={`instance-icon placeholder loader-${instance.loader}`} style={{ width: size, height: size }}>
      <LoaderIcon loader={instance.loader} size={size * 0.45} />
    </div>
  )
}
