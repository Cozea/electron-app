import { useEffect, useMemo } from 'react'
import { Navigate } from 'react-router-dom'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { Check, Plus } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useResolvedScope } from '@/hooks/useResolvedScope'
import { getWorkspaceSelectionId, workspaceMatchesSelectionId } from '@shared/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { WorkspaceAvatar } from '@/components/workspaces/WorkspaceAvatar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useCreateWorkspaceDialogStore } from '@/stores/useCreateWorkspaceDialogStore'

export function WorkspaceSelect() {
  const navigate = useViewTransitionNavigate()
  const { organizationWorkspaces, personalWorkspace, setCurrentWorkspace } = useAuth()
  const { activeWorkspace: currentWorkspace } = useResolvedScope({ ignoreLocation: true })
  const openCreateWorkspaceDialog = useCreateWorkspaceDialogStore(
    (state) => state.open
  )

  const activeOrganizations = useMemo(() => {
    const workspaces = personalWorkspace
      ? [personalWorkspace, ...organizationWorkspaces]
      : organizationWorkspaces
    const deduped = new Map<string, (typeof workspaces)[number]>()
    for (const org of workspaces) {
      if (org.status !== 'active') continue
      const selectionId = getWorkspaceSelectionId(org)
      if (selectionId && !deduped.has(selectionId)) {
        deduped.set(selectionId, org)
      }
    }
    return Array.from(deduped.values())
  }, [organizationWorkspaces, personalWorkspace])

  useEffect(() => {
    if (activeOrganizations.length === 1) {
      setCurrentWorkspace(activeOrganizations[0])
    }
  }, [activeOrganizations, setCurrentWorkspace])

  if (activeOrganizations.length === 0) {
    return <Navigate to="/" replace />
  }

  if (activeOrganizations.length <= 1) {
    return <Navigate to="/projects" replace />
  }

  const handleSelectWorkspace = (workspaceId: string) => {
    const selected = activeOrganizations.find((org) => workspaceMatchesSelectionId(org, workspaceId))
    if (!selected) return
    setCurrentWorkspace(selected)
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
          <Button
            variant="secondary"
            onClick={() => {
              openCreateWorkspaceDialog()
            }}
            className="gap-2"
          >
            <Plus className="size-4" />
            Create workspace
          </Button>
        </div>

        <div className="overflow-hidden rounded-2xl bg-secondary/80 dark:bg-secondary/40">
          <Table className="[&_th]:px-4 [&_td]:px-4">
            <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
              <TableRow className="hover:bg-transparent">
                <TableHead>Workspace</TableHead>
                <TableHead>Role</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
              {activeOrganizations.map((org) => {
                const selectionId = getWorkspaceSelectionId(org) ?? org.organizationId
                const isCurrent = workspaceMatchesSelectionId(currentWorkspace, selectionId)
                const isPersonal = org.workspaceType === 'personal'
                const isSharedWorkspace = !isPersonal
                return (
                  <TableRow
                    key={selectionId}
                    data-interactive="true"
                    data-state={isCurrent ? 'selected' : undefined}
                    tabIndex={0}
                    onClick={() => handleSelectWorkspace(selectionId)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        handleSelectWorkspace(selectionId)
                      }
                    }}
                    className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <WorkspaceAvatar
                          workspaceType={org.workspaceType}
                          iconKey={org.iconKey}
                          iconColor={org.iconColor}
                          logoUrl={org.logoUrl}
                          size="sm"
                          className="border-0"
                        />
                        <span className="truncate font-medium">{org.organizationName}</span>
                        {isPersonal ? (
                          <Badge className="border-0 bg-muted-foreground/10 text-muted-foreground pointer-events-none">
                            Personal
                          </Badge>
                        ) : isSharedWorkspace ? (
                          <Badge className="border-0 bg-primary/10 text-primary pointer-events-none">
                            Workspace
                          </Badge>
                        ) : null}
                        {isCurrent ? (
                          <span
                            className="flex size-5 items-center justify-center rounded-full bg-emerald-500 text-white pointer-events-none"
                            aria-label="Current workspace"
                            title="Current workspace"
                          >
                            <Check className="size-2.5" />
                          </span>
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
