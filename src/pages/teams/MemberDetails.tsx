import { useMemo } from 'react'
import { useParams } from '@tanstack/react-router'
import { formatOrganizationWorkspaceRole } from '@/lib/workspaces/organizationRoles'
import { WorkspaceAccessNotice } from '@/components/workspaces/WorkspaceAccessNotice'
import { useScopedMemberDetailsData } from '@/hooks/useScopedMemberDetailsData'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { Badge } from '../../components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import {
  Mail,
  Calendar,
  Activity,
  Zap,
  FolderKanban,
  Users,
} from 'lucide-react'

// Contribution graph component (GitHub-style)
function ContributionGraph({ data }: { data: number[][] }) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const days = ['', 'Mon', '', 'Wed', '', 'Fri', '']
  const cellStep = 14

  const getColor = (count: number) => {
    if (count === 0) return 'bg-muted/70'
    if (count <= 2) return 'bg-emerald-300/80 dark:bg-emerald-900'
    if (count <= 5) return 'bg-emerald-400 dark:bg-emerald-700'
    if (count <= 8) return 'bg-emerald-500 dark:bg-emerald-500'
    return 'bg-emerald-600 dark:bg-emerald-400'
  }

  // Calculate which months to show based on weeks
  const getMonthLabels = () => {
    const labels: { month: string; col: number }[] = []
    const now = new Date()
    let currentMonth = -1

    for (let week = 0; week < 52; week++) {
      const date = new Date(now)
      date.setDate(date.getDate() - (51 - week) * 7)
      const month = date.getMonth()

      if (month !== currentMonth) {
        currentMonth = month
        labels.push({ month: months[month], col: week })
      }
    }
    return labels
  }

  const monthLabels = getMonthLabels()

  return (
    <div className="space-y-3">
      <div className="app-scrollbar overflow-x-auto pb-1">
        <div className="min-w-[760px]">
          {/* Month labels */}
          <div className="relative ml-8 h-4">
            {monthLabels.map((label, i) => (
              <span
                key={i}
                className="absolute text-[11px] text-muted-foreground"
                style={{ left: `${label.col * cellStep}px` }}
              >
                {label.month}
              </span>
            ))}
          </div>

          <div className="mt-1 flex gap-1.5">
            {/* Day labels */}
            <div className="mr-1 flex flex-col gap-[3px] pt-[1px]">
              {days.map((day, i) => (
                <span key={i} className="h-[11px] w-6 text-[10px] leading-[11px] text-muted-foreground">
                  {day}
                </span>
              ))}
            </div>

            {/* Contribution cells */}
            <div className="flex gap-[3px]">
              {data.map((week, weekIndex) => (
                <div key={weekIndex} className="flex flex-col gap-[3px]">
                  {week.map((count, dayIndex) => (
                    <div
                      key={dayIndex}
                      className={`h-[11px] w-[11px] rounded-[3px] ${getColor(count)} transition-colors`}
                      title={`${count} requests`}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
        <span>No activity</span>
        <div className="h-[11px] w-[11px] rounded-[3px] bg-muted/70" />
        <div className="h-[11px] w-[11px] rounded-[3px] bg-emerald-300/80 dark:bg-emerald-900" />
        <div className="h-[11px] w-[11px] rounded-[3px] bg-emerald-400 dark:bg-emerald-700" />
        <div className="h-[11px] w-[11px] rounded-[3px] bg-emerald-500 dark:bg-emerald-500" />
        <div className="h-[11px] w-[11px] rounded-[3px] bg-emerald-600 dark:bg-emerald-400" />
        <span>High activity</span>
      </div>
    </div>
  )
}

// Stats card component
function StatCard({ icon: Icon, label, value, subtext }: {
  icon: React.ElementType
  label: string
  value: string | number
  subtext?: string
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-secondary/80 p-4 dark:bg-secondary/40">
      <div className="p-2 rounded-md bg-muted">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-xl font-semibold">{value}</p>
        {subtext && <p className="text-xs text-muted-foreground">{subtext}</p>}
      </div>
    </div>
  )
}

function buildWeeklyActivity(timestamps: number[]): number[][] {
  const totalDays = 52 * 7
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const startDate = new Date(today)
  startDate.setDate(startDate.getDate() - (totalDays - 1))

  const countsByDay = new Map<string, number>()
  for (const timestamp of timestamps) {
    const date = new Date(timestamp)
    date.setHours(0, 0, 0, 0)
    if (date < startDate || date > today) continue
    const dayKey = date.toISOString().slice(0, 10)
    countsByDay.set(dayKey, (countsByDay.get(dayKey) ?? 0) + 1)
  }

  const data: number[][] = []
  for (let week = 0; week < 52; week++) {
    const weekData: number[] = []
    for (let day = 0; day < 7; day++) {
      const date = new Date(startDate)
      date.setDate(startDate.getDate() + week * 7 + day)
      const dayKey = date.toISOString().slice(0, 10)
      weekData.push(countsByDay.get(dayKey) ?? 0)
    }
    data.push(weekData)
  }

  return data
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined
}

export function MemberDetails() {
  const { memberId } = useParams({ strict: false }) as any
  const {
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
    isLoading,
  } = useScopedMemberDetailsData({ memberId, route: '/teams' })

  const scopedProjects = useMemo(() => {
    if (!memberProjects) return []

    return memberProjects
      .filter(isPresent)
      .filter((project: any) => !convexOrg?._id || project.organizationId === convexOrg._id)
      .sort((a: any, b: any) => b.updatedAt - a.updatedAt)
  }, [memberProjects, convexOrg])

  const usageSummary = useMemo(() => {
    const records = usageRecords ?? []
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)
    const monthStartMs = monthStart.getTime()

    let totalTokens = 0
    let thisMonthTokens = 0
    const timestamps: number[] = []

    for (const usage of records) {
      const tokens = usage.totalTokens ?? 0
      totalTokens += tokens
      if (usage.timestamp >= monthStartMs) {
        thisMonthTokens += tokens
      }
      timestamps.push(usage.timestamp)
    }

    return { totalTokens, thisMonthTokens, timestamps }
  }, [usageRecords])

  const contributionData = useMemo(
    () => buildWeeklyActivity(usageSummary.timestamps),
    [usageSummary.timestamps]
  )
  const totalContributions = useMemo(
    () => contributionData.flat().reduce((sum, count) => sum + count, 0),
    [contributionData]
  )
  const activeProjectsCount = useMemo(
    () => scopedProjects.filter((project: any) => project.status !== 'archived').length,
    [scopedProjects]
  )

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`
    return num.toString()
  }

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    })
  }

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[
        ...settingsPage.breadcrumbs,
        { label: isLoading ? 'Loading...' : member ? memberName : 'Not Found' },
      ]}
    >
      {settingsPage.isWorkspaceAccessDenied ? (
        <WorkspaceAccessNotice
          title="Member access required"
          description="You do not have permission to view workspace members."
        />
      ) : isLoading ? (
        <div className="rounded-2xl bg-secondary/60 px-4 py-10 text-center text-muted-foreground">
          Loading member details...
        </div>
      ) : !member ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <h2 className="text-xl font-semibold mb-2">Member not found</h2>
          <p className="text-muted-foreground">This member may have been removed from the organization.</p>
        </div>
      ) : (
        <div className="space-y-4">
        {/* Profile header */}
        <div className="rounded-2xl bg-secondary/80 p-5 dark:bg-secondary/40">
          <div className="flex flex-col gap-6 sm:flex-row">
            <Avatar className="h-28 w-28 border-4 border-background shadow-lg">
              <AvatarImage src={member.user?.profileImageUrl || undefined} />
              <AvatarFallback className="text-3xl">
                {memberName.split(' ').map((n: any) => n[0]).join('').toUpperCase().slice(0, 2)}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold">{memberName}</h1>
                  <p className="text-muted-foreground">{member.user?.email}</p>
                </div>
                <Badge variant="secondary" className="text-sm">
                  {formatOrganizationWorkspaceRole(member.roleBaseRole ?? member.role, member.roleName)}
                </Badge>
              </div>

              <div className="mt-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" />
                  <span>Joined {formatDate(member.joinedAt)}</span>
                </div>
                {member.user?.email && (
                  <div className="flex items-center gap-1.5">
                    <Mail className="h-4 w-4" />
                    <span>{member.user.email}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            icon={Activity}
            label="AI Requests"
            value={totalContributions}
            subtext="in the last year"
          />
          <StatCard
            icon={Zap}
            label="Tokens Used"
            value={formatNumber(usageSummary.totalTokens)}
            subtext={`${formatNumber(usageSummary.thisMonthTokens)} this month`}
          />
          <StatCard
            icon={FolderKanban}
            label="Active Projects"
            value={activeProjectsCount}
            subtext="in this workspace"
          />
        </div>

        {/* Contribution graph */}
        <div className="rounded-2xl bg-secondary/80 p-5 dark:bg-secondary/40">
          <h2 className="mb-4 text-lg font-semibold">{totalContributions} AI requests in the last year</h2>
          <ContributionGraph data={contributionData} />
        </div>

        {/* Projects and Teams sections */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Projects */}
          <div className="rounded-2xl bg-secondary/80 p-5 dark:bg-secondary/40">
            <div className="mb-4 flex items-center gap-2">
              <FolderKanban className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Projects</h2>
            </div>
            <div className="space-y-3">
              {scopedProjects.length > 0 ? (
                scopedProjects.slice(0, 5).map((project: any) => (
                  <div key={project._id} className="flex items-center justify-between rounded-xl bg-background/50 px-3 py-2">
                    <div>
                      <p className="font-medium">{project.name}</p>
                      <p className="text-xs text-muted-foreground">{formatOrganizationWorkspaceRole(project.role)}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatRelativeTime(project.updatedAt)}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground py-2">No projects found for this member.</p>
              )}
            </div>
          </div>

          {/* Teams */}
          <div className="rounded-2xl bg-secondary/80 p-5 dark:bg-secondary/40">
            <div className="mb-4 flex items-center gap-2">
              <Users className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Teams</h2>
            </div>
            <div className="space-y-3">
              {workspaceName ? (
                <div className="flex items-center justify-between rounded-xl bg-background/50 px-3 py-2">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center">
                      <Users className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium">{workspaceName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatOrganizationWorkspaceRole(member.roleBaseRole ?? member.role, member.roleName)}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {organizationMembers ? `${organizationMembers.length} members` : 'Loading...'}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-2">No workspace member information available.</p>
              )}
            </div>
          </div>
        </div>
        </div>
      )}
    </DashboardLayout>
  )
}
