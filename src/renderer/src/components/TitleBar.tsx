import { Minus, Square, X } from 'lucide-react'
import { MoonLogo } from './MoonLogo'

export function TitleBar() {
  const isMac = window.moon.platform === 'darwin'
  return (
    <div className={`titlebar ${isMac ? 'mac' : ''}`}>
      <div className="titlebar-brand">
        <MoonLogo size={22} glow={false} />
        <span>
          MOON <b>CLIENT</b>
        </span>
      </div>
      {!isMac && (
        <div className="titlebar-controls">
          <button onClick={() => window.moon.app.windowAction('minimize')} aria-label="Minimieren">
            <Minus size={14} />
          </button>
          <button onClick={() => window.moon.app.windowAction('maximize')} aria-label="Maximieren">
            <Square size={12} />
          </button>
          <button className="close" onClick={() => window.moon.app.windowAction('close')} aria-label="Schließen">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
