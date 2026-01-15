import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { DashboardLayout } from '../components/layouts/DashboardLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import {
  Plus,
  FolderKanban,
  Clock,
  ArrowRight,
  Sparkles,
  Users,
  GitBranch,
  Zap,
  TrendingUp,
} from 'lucide-react'

// Mock data
const recentProjects = [
  {
    id: '1',
    name: 'E-commerce Platform',
    lastOpened: '2 hours ago',
    stack: ['Next.js', 'Tailwind'],
  },
  {
    id: '2',
    name: 'Dashboard Analytics',
    lastOpened: '1 day ago',
    stack: ['React', 'D3.js'],
  },
  {
    id: '3',
    name: 'Mobile Backend',
    lastOpened: '3 days ago',
    stack: ['Node.js', 'MongoDB'],
  },
  {
    id: '4',
    name: 'Marketing Site',
    lastOpened: '5 days ago',
    stack: ['Astro', 'Tailwind'],
  },
]

const recentActivity = [
  {
    id: '1',
    type: 'commit',
    message: 'Updated checkout flow',
    project: 'E-commerce Platform',
    time: '30 min ago',
    user: 'You',
  },
  {
    id: '2',
    type: 'deploy',
    message: 'Deployed to production',
    project: 'Dashboard Analytics',
    time: '2 hours ago',
    user: 'Sarah',
  },
  {
    id: '3',
    type: 'ai',
    message: 'Generated API endpoints',
    project: 'Mobile Backend',
    time: '4 hours ago',
    user: 'AI Assistant',
  },
  {
    id: '4',
    type: 'commit',
    message: 'Fixed responsive layout',
    project: 'Marketing Site',
    time: '1 day ago',
    user: 'Mike',
  },
]

const activityIcons = {
  commit: GitBranch,
  deploy: Zap,
  ai: Sparkles,
}

export function Dashboard() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const firstName = user?.firstName || user?.email?.split('@')[0] || 'there'

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Dashboard' }]}
    >
      {/* Welcome Section */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Welcome back, {firstName}</h1>
        <p className="text-muted-foreground">
          Here's what's happening in your workspace
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Projects</p>
                <p className="text-2xl font-bold">8</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <FolderKanban className="h-5 w-5 text-primary" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              <span className="text-green-600">+2</span> this month
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Team Members</p>
                <p className="text-2xl font-bold">5</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Users className="h-5 w-5 text-blue-500" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              3 online now
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">AI Credits</p>
                <p className="text-2xl font-bold">3,200</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-purple-500" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              of 5,000 this month
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Deployments</p>
                <p className="text-2xl font-bold">24</p>
              </div>
              <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-green-500" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              <span className="text-green-600">+12%</span> from last week
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Quick Actions & Recent Projects */}
        <div className="lg:col-span-2 space-y-6">
          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <Button
                  variant="outline"
                  className="h-auto flex-col gap-2 py-4"
                  onClick={() => navigate('/projects/new')}
                >
                  <Plus className="h-5 w-5" />
                  <span>New Project</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-auto flex-col gap-2 py-4"
                  onClick={() => navigate('/projects')}
                >
                  <Clock className="h-5 w-5" />
                  <span>Recent</span>
                </Button>
                <Button
                  variant="outline"
                  className="h-auto flex-col gap-2 py-4"
                  onClick={() => navigate('/teams/invites')}
                >
                  <Users className="h-5 w-5" />
                  <span>Invite Team</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Recent Projects */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Recent Projects</CardTitle>
                <CardDescription>Your recently opened projects</CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => navigate('/projects')}>
                View all
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {recentProjects.map((project) => (
                  <div
                    key={project.id}
                    className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                        <FolderKanban className="h-5 w-5 text-muted-foreground" />
                      </div>
                      <div>
                        <p className="font-medium">{project.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Opened {project.lastOpened}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {project.stack.map((tech) => (
                        <Badge key={tech} variant="secondary" className="text-xs">
                          {tech}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Activity Feed */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Activity</CardTitle>
            <CardDescription>Recent workspace activity</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentActivity.map((activity) => {
                const Icon = activityIcons[activity.type as keyof typeof activityIcons] || GitBranch
                return (
                  <div key={activity.id} className="flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">{activity.user}</span>{' '}
                        <span className="text-muted-foreground">{activity.message}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {activity.project} · {activity.time}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
