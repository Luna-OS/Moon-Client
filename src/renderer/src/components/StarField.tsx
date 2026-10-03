import { useEffect, useRef } from 'react'

interface Star {
  x: number
  y: number
  r: number
  phase: number
  speed: number
  drift: number
}

/** Slowly twinkling, drifting star background drawn on a canvas behind the whole app. */
export function StarField() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let stars: Star[] = []
    let frame = 0
    let shooting: { x: number; y: number; vx: number; vy: number; life: number } | undefined

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const count = Math.round((window.innerWidth * window.innerHeight) / 5200)
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * window.innerWidth,
        y: Math.random() * window.innerHeight,
        r: Math.random() < 0.9 ? Math.random() * 0.9 + 0.2 : Math.random() * 1.4 + 0.8,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 1.2,
        drift: 0.02 + Math.random() * 0.05
      }))
    }

    const draw = (t: number) => {
      const w = window.innerWidth
      const h = window.innerHeight
      ctx.clearRect(0, 0, w, h)
      for (const s of stars) {
        if (!reduceMotion) {
          s.x -= s.drift
          if (s.x < -2) s.x = w + 2
        }
        const twinkle = reduceMotion ? 0.8 : 0.55 + 0.45 * Math.sin(t / 1000 * s.speed + s.phase)
        ctx.globalAlpha = twinkle * (s.r > 1 ? 0.95 : 0.7)
        ctx.fillStyle = s.r > 1.2 ? '#d9d3ff' : '#ffffff'
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fill()
      }

      if (!reduceMotion) {
        if (!shooting && Math.random() < 0.0015) {
          shooting = { x: Math.random() * w * 0.8 + w * 0.2, y: Math.random() * h * 0.4, vx: -7, vy: 3, life: 1 }
        }
        if (shooting) {
          const s = shooting
          const grad = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 12, s.y - s.vy * 12)
          grad.addColorStop(0, `rgba(230, 225, 255, ${s.life})`)
          grad.addColorStop(1, 'rgba(230, 225, 255, 0)')
          ctx.globalAlpha = 1
          ctx.strokeStyle = grad
          ctx.lineWidth = 1.4
          ctx.beginPath()
          ctx.moveTo(s.x, s.y)
          ctx.lineTo(s.x - s.vx * 12, s.y - s.vy * 12)
          ctx.stroke()
          s.x += s.vx
          s.y += s.vy
          s.life -= 0.018
          if (s.life <= 0) shooting = undefined
        }
      }
      ctx.globalAlpha = 1
      frame = requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={ref} className="starfield" aria-hidden="true" />
}
