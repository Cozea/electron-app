import { useEffect, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { Building2, Check, Plus, User } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export function WorkspaceSelect() {
  const navigate = useViewTransitionNavigate()
  const { organizations, currentOrganization, setCurrentOrganization } = useAuth()

  const activeOrganizations = useMemo(() => {
    const deduped = new Map<string, (typeof organizations)[number]>()
    for (const org of organizations) {
      if (org.status !== 'active') continue
      if (!deduped.has(org.organizationId)) {
        deduped.set(org.organizationId, org)
      }
    }
    return Array.from(deduped.values())
  }, [organizations])

  useEffect(() => {
    if (activeOrganizations.length === 1) {
      setCurrentOrganization(activeOrganizations[0])
    }
  }, [activeOrganizations, setCurrentOrganization])

  if (organizations.length === 0) {
    return <Navigate to="/" replace />
  }

  if (activeOrganizations.length <= 1) {
    return <Navigate to="/projects" replace />
  }

  const handleSelectWorkspace = (organizationId: string) => {
    const selected = activeOrganizations.find((org) => org.organizationId === organizationId)
    if (!selected) return
    setCurrentOrganization(selected)
    navigate('/projects')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-2xl space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Choose a workspace</h1>
          <p className="text-sm text-muted-foreground">
            You are in multiple workspaces. Select where you want to continue.
          </p>
        </div>

        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => navigate('/workspaces/new')} className="gap-2">
            <Plus className="size-4" />
            Create workspace
          </Button>
        </div>

        <div className="overflow-hidden rounded-2xl bg-secondary/80 px-2 py-1 dark:bg-secondary/40">
          <Table className="[&_th]:px-4 [&_td]:px-4">
            <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
              <TableRow className="hover:bg-transparent">
                <TableHead>Workspace</TableHead>
                <TableHead>Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
              {activeOrganizations.map((org) => {
                const isCurrent = currentOrganization?.organizationId === org.organizationId
                const isPersonal = org.workspaceType === 'personal'
                return (
                  <TableRow
                    key={org.organizationId}
                    data-interactive="true"
                    data-state={isCurrent ? 'selected' : undefined}
                    tabIndex={0}
                    onClick={() => handleSelectWorkspace(org.organizationId)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        handleSelectWorkspace(org.organizationId)
                      }
                    }}
                    className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {isPersonal ? (
                          <User className="size-4 text-muted-foreground" />
                        ) : (
                          <Building2 className="size-4 text-muted-foreground" />
                        )}
                        <span className="truncate font-medium">{org.organizationName}</span>
                        {isPersonal ? (
                          <Badge className="border-0 bg-muted text-muted-foreground pointer-events-none">
                            Personal
                          </Badge>
                        ) : null}
                        {isCurrent ? (
                          <Badge className="ml-1 gap-1 border-0 bg-primary/10 text-primary pointer-events-none">
                            <Check className="size-3" />
                            Current
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className="border-0 bg-primary/10 text-primary capitalize pointer-events-none">
                        {org.role}
                      </Badge>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
