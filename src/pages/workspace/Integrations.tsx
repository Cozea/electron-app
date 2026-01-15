import { useAuth } from '../../contexts/AuthContext'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import {
  Github,
  GitBranch,
  MessageSquare,
  Trello,
  Layers,
  Cloud,
  ExternalLink,
  Check,
  Settings,
} from 'lucide-react'

const connectedIntegrations = [
  {
    id: 'github',
    name: 'GitHub',
    icon: Github,
    description: 'Connected to acme-org',
    connectedBy: 'John Doe',
    connectedAt: 'Jan 5, 2025',
    permissions: ['repo', 'read:user', 'workflow'],
  },
  {
    id: 'slack',
    name: 'Slack',
    icon: MessageSquare,
    description: 'Connected to Acme Workspace',
    connectedBy: 'John Doe',
    connectedAt: 'Dec 20, 2024',
    permissions: ['chat:write', 'channels:read'],
  },
]

const availableIntegrations = [
  {
    id: 'gitlab',
    name: 'GitLab',
    icon: GitBranch,
    description: 'Connect your GitLab repositories',
    category: 'Source Control',
  },
  {
    id: 'bitbucket',
    name: 'Bitbucket',
    icon: GitBranch,
    description: 'Connect your Bitbucket repositories',
    category: 'Source Control',
  },
  {
    id: 'discord',
    name: 'Discord',
    icon: MessageSquare,
    description: 'Send notifications to Discord channels',
    category: 'Communication',
  },
  {
    id: 'linear',
    name: 'Linear',
    icon: Trello,
    description: 'Sync issues and projects with Linear',
    category: 'Project Management',
  },
  {
    id: 'jira',
    name: 'Jira',
    icon: Trello,
    description: 'Connect Jira for issue tracking',
    category: 'Project Management',
  },
  {
    id: 'notion',
    name: 'Notion',
    icon: Layers,
    description: 'Sync documentation with Notion',
    category: 'Documentation',
  },
  {
    id: 'vercel',
    name: 'Vercel',
    icon: Cloud,
    description: 'Deploy projects to Vercel',
    category: 'Deployment',
  },
  {
    id: 'railway',
    name: 'Railway',
    icon: Cloud,
    description: 'Deploy backends to Railway',
    category: 'Deployment',
  },
  {
    id: 'netlify',
    name: 'Netlify',
    icon: Cloud,
    description: 'Deploy static sites to Netlify',
    category: 'Deployment',
  },
  {
    id: 'fly',
    name: 'Fly.io',
    icon: Cloud,
    description: 'Deploy apps globally with Fly.io',
    category: 'Deployment',
  },
]

export function Integrations() {
  const { user, logout } = useAuth()

  const categories = [...new Set(availableIntegrations.map((i) => i.category))]

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Workspace' }, { label: 'Integrations' }]}
    >
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Integrations</h1>
        <p className="text-muted-foreground">
          Connect external services to enhance your workflow
        </p>
      </div>

      <div className="space-y-6">
        {/* Connected Integrations */}
        <Card>
          <CardHeader>
            <CardTitle>Connected</CardTitle>
            <CardDescription>
              Integrations currently active in your workspace
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {connectedIntegrations.map((integration) => {
              const Icon = integration.icon
              return (
                <div
                  key={integration.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center">
                      <Icon className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium">{integration.name}</h4>
                        <Badge variant="secondary" className="gap-1">
                          <Check className="h-3 w-3" />
                          Connected
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {integration.description}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Connected by {integration.connectedBy} on {integration.connectedAt}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" className="gap-2">
                      <Settings className="h-4 w-4" />
                      Configure
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive">
                      Disconnect
                    </Button>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        {/* Available Integrations by Category */}
        {categories.map((category) => (
          <Card key={category}>
            <CardHeader>
              <CardTitle>{category}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {availableIntegrations
                  .filter((i) => i.category === category)
                  .map((integration) => {
                    const Icon = integration.icon
                    return (
                      <Card key={integration.id} className="hover:bg-accent/50 transition-colors">
                        <CardContent className="flex items-center justify-between p-4">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                              <Icon className="h-5 w-5" />
                            </div>
                            <div>
                              <h4 className="font-medium">{integration.name}</h4>
                              <p className="text-xs text-muted-foreground">
                                {integration.description}
                              </p>
                            </div>
                          </div>
                          <Button variant="outline" size="sm" className="gap-1">
                            Connect
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        </CardContent>
                      </Card>
                    )
                  })}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </DashboardLayout>
  )
}
