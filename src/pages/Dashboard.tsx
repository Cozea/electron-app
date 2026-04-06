import { useAuth } from '../contexts/AuthContext'
import { AppShellLayout } from '../components/layouts/AppShellLayout'
import { Construction } from 'lucide-react'

export function Dashboard() {
  const { user, logout } = useAuth()

  return (
    <AppShellLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Dashboard' }]}
    >
      <div className="flex flex-col items-center justify-center flex-1 min-h-[calc(100vh-8.5rem)] border-2 border-dashed border-border rounded-lg">
        <Construction className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Coming Soon</h2>
        <p className="text-muted-foreground text-center max-w-md">
          The dashboard is under construction. Check back later for analytics, activity feeds, and quick actions.
        </p>
      </div>
    </AppShellLayout>
  )
}
