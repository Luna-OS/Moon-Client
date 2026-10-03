import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { useStore } from '../store'

export function TaskToasts() {
  const { tasks, dismissTask, toasts } = useStore()
  return (
    <div className="toasts">
      {tasks.map((t) => {
        const pct = t.total ? Math.round((t.current / t.total) * 100) : undefined
        return (
          <div key={t.id} className={`toast task ${t.state}`}>
            <div className="toast-row">
              <strong>{t.title}</strong>
              {t.state !== 'running' && (
                <button className="icon-btn small" onClick={() => dismissTask(t.id)} aria-label="Ausblenden">
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="toast-detail">
              {t.state === 'error' ? t.error : t.state === 'done' ? 'Fertig' : t.detail}
              {t.state === 'running' && t.total > 1 && (
                <span className="muted">
                  {' '}
                  · {t.current}/{t.total}
                </span>
              )}
            </div>
            {t.state === 'running' && (
              <div className={`progress ${pct === undefined ? 'indeterminate' : ''}`}>
                <div style={{ width: `${pct ?? 30}%` }} />
              </div>
            )}
          </div>
        )
      })}
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'error' ? <CircleAlert size={16} /> : t.kind === 'success' ? <CircleCheck size={16} /> : <Info size={16} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}
