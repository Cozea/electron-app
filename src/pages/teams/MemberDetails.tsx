import { useParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { Badge } from '../../components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar'
import {
  Mail,
  Calendar,
  GitCommit,
  Zap,
  FolderKanban,
  Users,
  Loader2,
} from 'lucide-react'

// Contribution graph component (GitHub-style)
function ContributionGraph({ data }: { data: number[][] }) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const days = ['', 'Mon', '', 'Wed', '', 'Fri', '']

  const getColor = (count: number) => {
    if (count === 0) return 'bg-muted'
    if (count <= 2) return 'bg-emerald-200 dark:bg-emerald-900'
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
    <div className="app-scrollbar overflow-x-auto">
      <div className="inline-block min-w-full">
        {/* Month labels */}
        <div className="flex mb-1 ml-8">
          {monthLabels.map((label, i) => (
            <span
              key={i}
              className="text-xs text-muted-foreground"
              style={{
                position: 'relative',
                left: `${label.col * 12}px`,
                marginRight: i < monthLabels.length - 1
                  ? `${(monthLabels[i + 1]?.col - label.col) * 12 - 24}px`
                  : '0'
              }}
            >
              {label.month}
            </span>
          ))}
        </div>

        <div className="flex gap-0.5">
          {/* Day labels */}
          <div className="flex flex-col gap-0.5 mr-1">
            {days.map((day, i) => (
              <span key={i} className="text-[10px] text-muted-foreground h-[10px] leading-[10px]">
                {day}
              </span>
            ))}
          </div>

          {/* Contribution cells */}
          {data.map((week, weekIndex) => (
            <div key={weekIndex} className="flex flex-col gap-0.5">
              {week.map((count, dayIndex) => (
                <div
                  key={dayIndex}
                  className={`w-[10px] h-[10px] rounded-sm ${getColor(count)} transition-colors`}
                  title={`${count} contributions`}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center justify-end gap-1 mt-2">
          <span className="text-xs text-muted-foreground mr-1">Less</span>
          <div className="w-[10px] h-[10px] rounded-sm bg-muted" />
          <div className="w-[10px] h-[10px] rounded-sm bg-emerald-200 dark:bg-emerald-900" />
          <div className="w-[10px] h-[10px] rounded-sm bg-emerald-400 dark:bg-emerald-700" />
          <div className="w-[10px] h-[10px] rounded-sm bg-emerald-500 dark:bg-emerald-500" />
          <div className="w-[10px] h-[10px] rounded-sm bg-emerald-600 dark:bg-emerald-400" />
          <span className="text-xs text-muted-foreground ml-1">More</span>
        </div>
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
    <div className="flex items-center gap-3 p-4 rounded-lg border bg-card">
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

export function MemberDetails() {
  const { memberId } = useParams<{ memberId: string }>()
  const { user, logout, currentOrganization } = useAuth()

  // Get Convex organization by WorkOS ID
  const convexOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : 'skip'
  )

  // Get member details
  const member = useQuery(
    api.organizations.getMember,
    convexOrg?._id && memberId ? { orgId: convexOrg._id, memberId: memberId as Id<'members'> } : 'skip'
  )

  const isLoading = member === undefined

  // Generate mock contribution data (52 weeks x 7 days)
  // In production, this would come from actual commit data
  const generateContributionData = (): number[][] => {
    const data: number[][] = []
    for (let week = 0; week < 52; week++) {
      const weekData: number[] = []
      for (let day = 0; day < 7; day++) {
        // Generate somewhat realistic patterns (more activity on weekdays)
        const isWeekend = day === 0 || day === 6
        const baseChance = isWeekend ? 0.2 : 0.6
        const hasActivity = Math.random() < baseChance
        weekData.push(hasActivity ? Math.floor(Math.random() * 12) : 0)
      }
      data.push(weekData)
    }
    return data
  }

  const contributionData = generateContributionData()
  const totalContributions = contributionData.flat().reduce((a, b) => a + b, 0)

  // Mock data for token usage (would come from actual usage tracking)
  const tokenUsage = {
    total: 1234567,
    thisMonth: 45678,
  }

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

  if (isLoading) {
    return (
      <DashboardLayout
        user={user}
        onLogout={logout}
        breadcrumbs={[{ label: 'Teams' }, { label: 'Members', href: '/teams' }, { label: 'Loading...' }]}
      >
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    )
  }

  if (!member) {
    return (
      <DashboardLayout
        user={user}
        onLogout={logout}
        breadcrumbs={[{ label: 'Teams' }, { label: 'Members', href: '/teams' }, { label: 'Not Found' }]}
      >
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <h2 className="text-xl font-semibold mb-2">Member not found</h2>
          <p className="text-muted-foreground">This member may have been removed from the organization.</p>
        </div>
      </DashboardLayout>
    )
  }

  const memberName = `${member.user?.firstName || ''} ${member.user?.lastName || ''}`.trim()
    || member.user?.email?.split('@')[0]
    || 'Unknown'

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[
        { label: 'Teams' },
        { label: 'Members', href: '/teams' },
        { label: memberName },
      ]}
    >
      <div className="max-w-4xl">
        {/* Profile header */}
        <div className="flex flex-col sm:flex-row gap-6 mb-8">
          <Avatar className="h-32 w-32 border-4 border-background shadow-lg">
            <AvatarImage src={member.user?.profileImageUrl || undefined} />
            <AvatarFallback className="text-3xl">
              {memberName.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold">{memberName}</h1>
                <p className="text-muted-foreground">{member.user?.email}</p>
              </div>
              <Badge variant="outline" className="text-sm">
                {member.role?.charAt(0).toUpperCase() + member.role?.slice(1)}
              </Badge>
            </div>

            <div className="flex flex-wrap gap-4 mt-4 text-sm text-muted-foreground">
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

        {/* Stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <StatCard
            icon={GitCommit}
            label="Contributions"
            value={totalContributions}
            subtext="in the last year"
          />
          <StatCard
            icon={Zap}
            label="Tokens Used"
            value={formatNumber(tokenUsage.total)}
            subtext={`${formatNumber(tokenUsage.thisMonth)} this month`}
          />
          <StatCard
            icon={FolderKanban}
            label="Active Projects"
            value={3}
            subtext="across 2 teams"
          />
        </div>

        {/* Contribution graph */}
        <div className="border rounded-lg p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">{totalContributions} contributions in the last year</h2>
          <ContributionGraph data={contributionData} />
        </div>

        {/* Projects and Teams sections */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Projects */}
          <div className="border rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <FolderKanban className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Projects</h2>
            </div>
            <div className="space-y-3">
              {/* Placeholder projects */}
              {[
                { name: 'Frontend App', role: 'Lead', activity: '2 days ago' },
                { name: 'API Gateway', role: 'Contributor', activity: '1 week ago' },
                { name: 'Mobile App', role: 'Contributor', activity: '2 weeks ago' },
              ].map((project, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div>
                    <p className="font-medium">{project.name}</p>
                    <p className="text-xs text-muted-foreground">{project.role}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{project.activity}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Teams */}
          <div className="border rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <Users className="h-5 w-5 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Teams</h2>
            </div>
            <div className="space-y-3">
              {/* Placeholder teams */}
              {[
                { name: 'Engineering', members: 12 },
                { name: 'Product', members: 8 },
              ].map((team, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center">
                      <Users className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="font-medium">{team.name}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{team.members} members</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
