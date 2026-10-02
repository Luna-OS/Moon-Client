import { Compass, House, Layers, Settings, UserRound } from 'lucide-react'
import { useStore, type Route } from '../store'

const ITEMS: Array<{ page: Route['page']; label: string; icon: typeof House; route: Route }> = [
  { page: 'home', label: 'Start', icon: House, route: { page: 'home' } },
  { page: 'instances', label: 'Instanzen', icon: Layers, route: { page: 'instances' } },
  { page: 'browse', label: 'Entdecken', icon: Compass, route: { page: 'browse' } },
  { page: 'accounts', label: 'Konten', icon: UserRound, route: { page: 'accounts' } },
  { page: 'settings', label: 'Einstellungen', icon: Settings, route: { page: 'settings' } }
]

export function Sidebar() {
  const { route, navigate, accounts } = useStore()
  const active = route.page === 'instance' ? 'instances' : route.page
  const account = accounts.accounts.find((a) => a.id === accounts.selectedId)

  return (
    <nav className="sidebar">
      <ul>
        {ITEMS.map(({ page, label, icon: Icon, route: target }) => (
          <li key={page}>
            <button className={active === page ? 'active' : ''} onClick={() => navigate(target)}>
              <Icon size={19} />
              <span>{label}</span>
            </button>
          </li>
        ))}
      </ul>
      <button className="sidebar-account" onClick={() => navigate({ page: 'accounts' })}>
        {account ? (
          <>
            <img src={`https://mc-heads.net/avatar/${account.id}/64`} alt="" width={32} height={32} />
            <div>
              <strong>{account.name}</strong>
              <small>{account.type === 'microsoft' ? 'Microsoft' : 'Offline'}</small>
            </div>
          </>
        ) : (
          <>
            <div className="avatar-empty">
              <UserRound size={16} />
            </div>
            <div>
              <strong>Nicht angemeldet</strong>
              <small>Konto hinzufügen</small>
            </div>
          </>
        )}
      </button>
    </nav>
  )
}
