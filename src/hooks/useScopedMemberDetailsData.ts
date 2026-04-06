import { useMemo } from 'react'
import { useQuery } from 'convex/react'

import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useAuth } from '@/contexts/AuthContext'
import { useScopedSettingsPage } from '@/hooks/useScopedSettingsPage'

interface UseScopedMemberDetailsDataOptions {
  memberId?: string
  route?: string
}

export function useScopedMemberDetailsData(
  options: UseScopedMemberDetailsDataOptions,
) {
  const { user, logout, convexUserId } = useAuth()
  const settingsPage = useScopedSettingsPage({
    route: options.route ?? '/teams',
    surfaceId: 'members',
  })
  const convexOrg = settingsPage.workspaceAccess.convexOrg
  const workspaceName =
    convexOrg?.name ??
    settingsPage.resolvedScope.scopedWorkspace?.organizationName ??
    'Workspace'

  const member = useQuery<any>(
    api.organizations.getMember,
    convexOrg?._id && convexUserId && options.memberId
      ? {
          orgId: convexOrg._id,
          viewerUserId: convexUserId,
          memberId: options.memberId as Id<'members'>,
        }
      : 'skip',
  )

  const usageRecords = useQuery<any>(
    undefined,
    member?.user?.id ? { userId: member.user.id, limit: 500 } : 'skip',
  )
  const memberProjects = useQuery<any>(
    api.projects.listForUser,
    member?.user?.id ? { userId: member.user.id } : 'skip',
  )
  const organizationMembers = useQuery<any>(
    api.organizations.getMembers,
    convexOrg?._id && convexUserId
      ? { orgId: convexOrg._id, viewerUserId: convexUserId }
      : 'skip',
  )

  const memberName = useMemo(() => {
    if (!member) {
      return 'Member'
    }

    return (
      `${member.user?.firstName || ''} ${member.user?.lastName || ''}`.trim() ||
      member.user?.email?.split('@')[0] ||
      'Unknown'
    )
  }, [member])

  return {
    settingsPage,
    user,
    logout,
    convexOrg,
    workspaceName,
    member,
    memberName,
    usageRecords,
    memberProjects,
    organizationMembers,
    isLoading: convexOrg === undefined || member === undefined,
  }
}
