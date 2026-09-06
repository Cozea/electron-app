import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import type { Id } from '../../../../../../convex/_generated/dataModel'
import { api } from '../../../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useProjectHeader } from '@/lib/useProjectHeader'
import { useAccessibleProject } from '@/contexts/project/useAccessibleProject'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { HugeiconsIcon } from '@hugeicons/react'
import { Delete02Icon as __TrashHugeIcon } from '@hugeicons/core-free-icons'

type ProjectRole = 'project_manager' | 'developer' | 'designer' | 'viewer'

const ROLE_OPTIONS: Array<{ value: ProjectRole; label: string }> = [
  { value: 'project_manager', label: 'Project manager' },
  { value: 'developer', label: 'Developer' },
  { value: 'designer', label: 'Designer' },
  { value: 'viewer', label: 'Viewer' },
]

function cleanError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback
  return raw.replace(/^\[CONVEX.*?\]\s*/, '').replace(/\s*Called by client$/, '') || fallback
}

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || 'D'
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString()
}

export function ProjectTeamPage() {
  const { principalId } = useAuth()
  const { project } = useAccessibleProject()
  useProjectHeader(null)

  const memberRole = useQuery(
    api.projectMembers.getMemberRole,
    project?._id && principalId ? { projectId: project._id, userId: principalId } : 'skip',
  )
  const members = useQuery(
    api.projectMembers.listMembers,
    project?._id && principalId ? { projectId: project._id, viewerUserId: principalId } : 'skip',
  )
  const pending = useQuery(
    api.projectDeviceEnrollments.listForProject,
    project?._id && principalId && memberRole === 'project_manager'
      ? { projectId: project._id }
      : 'skip',
  )

  const createEnrollment = useMutation(api.projectDeviceEnrollments.create)
  const cancelEnrollment = useMutation(api.projectDeviceEnrollments.cancel)
  const updateRole = useMutation(api.projectMembers.updateRole)
  const removeMember = useMutation(api.projectMembers.removeMember)

  const [identityKey, setIdentityKey] = useState('')
  const [inviteRole, setInviteRole] = useState<ProjectRole>('developer')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const canManage = memberRole === 'project_manager'

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      await work()
    } catch (caught) {
      setError(cleanError(caught, 'Could not update project access.'))
    } finally {
      setBusy(null)
    }
  }

  const invite = () => {
    if (!project?._id || !canManage || !identityKey.trim()) return
    void run('invite', async () => {
      await createEnrollment({
        projectId: project._id,
        identityKey: identityKey.trim(),
        role: inviteRole,
      })
      setIdentityKey('')
      setNotice('Device invitation created.')
    })
  }

  const changeRole = (memberUserId: Id<'devicePrincipals'>, role: ProjectRole) => {
    if (!project?._id || !principalId || !canManage) return
    void run(`role:${memberUserId}`, async () => {
      await updateRole({
        projectId: project._id,
        actorUserId: principalId,
        memberUserId,
        newRole: role,
      })
    })
  }

  const remove = (memberUserId: Id<'devicePrincipals'>) => {
    if (!project?._id || !principalId || !canManage) return
    void run(`remove:${memberUserId}`, async () => {
      await removeMember({
        projectId: project._id,
        actorUserId: principalId,
        memberUserId,
      })
    })
  }

  if (project === undefined) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground"><div className="loader mr-2" />Loading team…</div>
  }
  if (project === null) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Project not found.</div>
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-lg font-semibold">Project devices</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every member is one physical Cozea device with its own cryptographic identity.
          </p>
        </div>

        {error ? <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null}
        {notice ? <div className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">{notice}</div> : null}

        {canManage ? (
          <section className="space-y-2 rounded-xl border border-border/60 p-4">
            <div>
              <p className="text-sm font-medium">Invite a device</p>
              <p className="text-xs text-muted-foreground">Use the public czd_… identity shown in Device Identity settings on the other machine.</p>
            </div>
            <div className="flex gap-2">
              <Input
                value={identityKey}
                onChange={(event) => setIdentityKey(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') invite() }}
                placeholder="czd_…"
                className="h-8 flex-1 font-mono text-xs"
              />
              <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as ProjectRole)}>
                <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" className="h-8" disabled={!identityKey.trim() || busy !== null} onClick={invite}>Invite</Button>
            </div>
          </section>
        ) : null}

        <section className="overflow-hidden rounded-xl border border-border/60">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Device</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members === undefined ? (
                <TableRow><TableCell colSpan={4} className="h-20 text-center text-muted-foreground">Loading…</TableCell></TableRow>
              ) : members.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="h-20 text-center text-muted-foreground">No devices have access.</TableCell></TableRow>
              ) : members.map((member) => {
                const self = member.userId === principalId
                const memberBusy = busy === `role:${member.userId}` || busy === `remove:${member.userId}`
                return (
                  <TableRow key={member._id}>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar className="size-9 rounded-lg">
                          {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt={member.displayName} /> : null}
                          <AvatarFallback className="rounded-lg text-xs">{initials(member.displayName)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{member.displayName}</span>
                            {self ? <Badge variant="secondary">This device</Badge> : null}
                          </div>
                          <div className="truncate font-mono text-[11px] text-muted-foreground">{member.identityKey}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {canManage && !self ? (
                        <Select
                          value={member.role}
                          disabled={memberBusy}
                          onValueChange={(value) => changeRole(member.userId, value as ProjectRole)}
                        >
                          <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline">{member.role.replace(/_/g, ' ')}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(member.addedAt)}</TableCell>
                    <TableCell>
                      {canManage && !self ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          disabled={memberBusy}
                          onClick={() => remove(member.userId)}
                          aria-label={`Remove ${member.displayName}`}
                        >
                          <HugeiconsIcon icon={__TrashHugeIcon} className="size-4" />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </section>

        {canManage && (pending ?? []).length > 0 ? (
          <section className="space-y-2">
            <h2 className="text-sm font-medium">Pending invitations</h2>
            <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/60">
              {(pending ?? []).map((enrollment) => (
                <div key={enrollment._id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs">{enrollment.targetIdentityKey}</div>
                    <div className="text-[11px] text-muted-foreground">{enrollment.role.replace(/_/g, ' ')} · expires {formatDate(enrollment.expiresAt)}</div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    disabled={busy !== null}
                    onClick={() => void run(`cancel:${enrollment._id}`, async () => {
                      await cancelEnrollment({ enrollmentId: enrollment._id })
                    })}
                  >
                    Cancel
                  </Button>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
