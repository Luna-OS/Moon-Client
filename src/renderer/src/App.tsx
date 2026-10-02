import { Sidebar } from './components/Sidebar'
import { StarField } from './components/StarField'
import { TaskToasts } from './components/TaskToasts'
import { TitleBar } from './components/TitleBar'
import { Accounts } from './pages/Accounts'
import { Browse } from './pages/Browse'
import { Home } from './pages/Home'
import { InstanceDetail } from './pages/InstanceDetail'
import { Instances } from './pages/Instances'
import { Settings } from './pages/Settings'
import { useStore } from './store'

export default function App() {
  const { route } = useStore()
  return (
    <div className="app">
      <StarField />
      <div className="nebula" aria-hidden="true" />
      <TitleBar />
      <div className="layout">
        <Sidebar />
        <main className="main" key={route.page === 'instance' ? `instance-${route.id}` : route.page}>
          {route.page === 'home' && <Home />}
          {route.page === 'instances' && <Instances />}
          {route.page === 'instance' && <InstanceDetail id={route.id} tab={route.tab} />}
          {route.page === 'browse' && <Browse kind={route.kind} targetId={route.targetId} />}
          {route.page === 'accounts' && <Accounts />}
          {route.page === 'settings' && <Settings />}
        </main>
      </div>
      <TaskToasts />
    </div>
  )
}
