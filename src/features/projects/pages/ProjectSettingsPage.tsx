import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Settings,
  Loader2,
  Save,
  Trash2,
  AlertTriangle,
  Shield,
  Bell,
  Globe,
  Key,
  Users,
  GitBranch,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export function ProjectSettingsPage() {
  const { slug } = useParams<{ slug: string }>()
  const { currentOrganization } = useAuth()
  const [activeSection, setActiveSection] = useState('general')

  // Get Convex organization
  const convexOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : 'skip'
  )

  // Load project by slug
  const project = useQuery(
    api.projects.getBySlug,
    convexOrg?._id && slug ? { organizationId: convexOrg._id, slug } : 'skip'
  )

  const sections = [
    { id: 'general', label: 'General', icon: Settings },
    { id: 'access', label: 'Access', icon: Users },
    { id: 'branches', label: 'Branches', icon: GitBranch },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'danger', label: 'Danger Zone', icon: AlertTriangle },
  ]

  if (project === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-9 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Settings className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-medium">Project Settings</h1>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm">
            <Save className="h-4 w-4 mr-1" />
            Save Changes
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar Navigation */}
        <div className="w-48 border-r border-border p-3 space-y-1">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-sm rounded-md transition-colors",
                activeSection === section.id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/50"
              )}
            >
              <section.icon className={cn(
                "h-4 w-4",
                section.id === 'danger' && "text-red-500"
              )} />
              {section.label}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <ScrollArea className="flex-1">
          <div className="p-6 max-w-2xl">
            {activeSection === 'general' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-medium mb-4">General Settings</h2>
                  <Card>
                    <CardContent className="pt-6 space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="name">Project Name</Label>
                        <Input
                          id="name"
                          defaultValue={project?.name || ''}
                          placeholder="My Project"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="description">Description</Label>
                        <Textarea
                          id="description"
                          defaultValue={project?.description || ''}
                          placeholder="A brief description of your project..."
                          rows={3}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="slug">Project Slug</Label>
                        <Input
                          id="slug"
                          defaultValue={project?.slug || ''}
                          placeholder="my-project"
                          disabled
                        />
                        <p className="text-xs text-muted-foreground">
                          The slug is used in URLs and cannot be changed.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <div>
                  <h3 className="text-sm font-medium mb-3">Project Visibility</h3>
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Globe className="h-5 w-5 text-muted-foreground" />
                          <div>
                            <p className="font-medium">Public Project</p>
                            <p className="text-sm text-muted-foreground">
                              Anyone can view this project
                            </p>
                          </div>
                        </div>
                        <Switch />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {activeSection === 'access' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-medium mb-4">Access Control</h2>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Team Members</CardTitle>
                      <CardDescription>
                        Manage who has access to this project
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground">
                        Access control is managed at the organization level.
                      </p>
                      <Button variant="outline" size="sm" className="mt-4">
                        <Users className="h-4 w-4 mr-2" />
                        Manage Team
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {activeSection === 'branches' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-medium mb-4">Branch Protection</h2>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Default Branch</CardTitle>
                      <CardDescription>
                        Configure the default branch for this project
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label>Default Branch</Label>
                        <Input defaultValue="main" />
                      </div>

                      <Separator />

                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">Require Pull Requests</p>
                          <p className="text-sm text-muted-foreground">
                            Prevent direct pushes to protected branches
                          </p>
                        </div>
                        <Switch defaultChecked />
                      </div>

                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">Require Reviews</p>
                          <p className="text-sm text-muted-foreground">
                            At least one approval before merging
                          </p>
                        </div>
                        <Switch defaultChecked />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {activeSection === 'notifications' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-medium mb-4">Notifications</h2>
                  <Card>
                    <CardContent className="pt-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">Build Notifications</p>
                          <p className="text-sm text-muted-foreground">
                            Get notified when builds complete or fail
                          </p>
                        </div>
                        <Switch defaultChecked />
                      </div>

                      <Separator />

                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">Deploy Notifications</p>
                          <p className="text-sm text-muted-foreground">
                            Get notified when deployments succeed or fail
                          </p>
                        </div>
                        <Switch defaultChecked />
                      </div>

                      <Separator />

                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">PR Comments</p>
                          <p className="text-sm text-muted-foreground">
                            Get notified about new comments on PRs
                          </p>
                        </div>
                        <Switch />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}

            {activeSection === 'security' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-medium mb-4">Security Settings</h2>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Environment Variables</CardTitle>
                      <CardDescription>
                        Manage secrets and environment variables
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button variant="outline" size="sm">
                        <Key className="h-4 w-4 mr-2" />
                        Manage Secrets
                      </Button>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Dependency Scanning</CardTitle>
                    <CardDescription>
                      Automatically scan for vulnerable dependencies
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">Enable Scanning</p>
                        <p className="text-sm text-muted-foreground">
                          Scan dependencies on every push
                        </p>
                      </div>
                      <Switch defaultChecked />
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeSection === 'danger' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-medium mb-4 text-red-500">Danger Zone</h2>
                  <Card className="border-red-500/30">
                    <CardHeader>
                      <CardTitle className="text-base">Archive Project</CardTitle>
                      <CardDescription>
                        Archive this project. It can be restored later.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button variant="outline" className="text-orange-500 hover:text-orange-600">
                        Archive Project
                      </Button>
                    </CardContent>
                  </Card>

                  <Card className="border-red-500/30">
                    <CardHeader>
                      <CardTitle className="text-base text-red-500">Delete Project</CardTitle>
                      <CardDescription>
                        Permanently delete this project and all its data. This action cannot be undone.
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button variant="destructive">
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Project
                      </Button>
                    </CardContent>
                  </Card>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
