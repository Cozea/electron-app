import { useAuth } from '../../contexts/AuthContext'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { Plug } from 'lucide-react'

export function Integrations() {
  const { user, logout } = useAuth()

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Workspace' }, { label: 'Integrations' }]}
    >
      <div className="flex flex-col items-center justify-center flex-1 min-h-[calc(100vh-8.5rem)] border-2 border-dashed border-border rounded-lg">
        <Plug className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Coming Soon</h2>
        <p className="text-muted-foreground text-center max-w-md">
          Connect external services like GitHub, Vercel, Supabase, and more.
        </p>
      </div>
    </DashboardLayout>
  )
}
