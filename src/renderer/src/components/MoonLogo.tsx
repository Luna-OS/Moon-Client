import { useId } from 'react'

/** The Moon Client mark: a softly lit moon with craters and a lavender halo. */
export function MoonLogo({ size = 32, glow = true }: { size?: number; glow?: boolean }) {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-surface`} cx="38%" cy="32%" r="75%">
          <stop offset="0%" stopColor="#fbf8ee" />
          <stop offset="55%" stopColor="#d9d6ea" />
          <stop offset="100%" stopColor="#8f88c9" />
        </radialGradient>
        <radialGradient id={`${id}-halo`} cx="50%" cy="50%" r="50%">
          <stop offset="60%" stopColor="#a99cff" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#a99cff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0b0e1c" stopOpacity="0" />
          <stop offset="100%" stopColor="#0b0e1c" stopOpacity="0.45" />
        </linearGradient>
      </defs>
      {glow && <circle cx="32" cy="32" r="31" fill={`url(#${id}-halo)`} />}
      <circle cx="32" cy="32" r="21" fill={`url(#${id}-surface)`} />
      <g fill="#8f88c9" opacity="0.45">
        <circle cx="25" cy="27" r="4.2" />
        <circle cx="38" cy="38" r="5.2" />
        <circle cx="36" cy="23" r="2.2" />
        <circle cx="25" cy="40" r="2.6" />
        <circle cx="44" cy="29" r="1.6" />
      </g>
      <circle cx="32" cy="32" r="21" fill={`url(#${id}-shade)`} />
    </svg>
  )
}
