import { useParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Loader2,
  Save,
  Trash2,
  Globe,
  Key,
  Users,
} from 'lucide-react'

export function ProjectSettingsPage() {
  const { slug, section } = useParams<{ slug: string; section?: string }>()
  const { currentOrganization } = useAuth()

  // Get section from URL or default to 'general'
  const activeSection = section || 'general'

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

  if (project === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="relative h-full">
      {/* Save button fixed in corner */}
      <div className="absolute top-4 right-4 z-10">
        <Button size="sm">
          <Save className="h-4 w-4 mr-1" />
          Save Changes
        </Button>
      </div>

      <ScrollArea className="h-full">
        <div className="p-6 max-w-2xl space-y-8">
          {activeSection === 'general' && (
            <>
              <div>
                <h2 className="text-lg font-medium mb-4">General Settings</h2>
                <div className="space-y-4">
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
                </div>
              </div>

              <Separator />

              <div>
                <h3 className="text-sm font-medium mb-4">Project Visibility</h3>
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
              </div>
            </>
          )}

          {activeSection === 'access' && (
            <div>
              <h2 className="text-lg font-medium mb-2">Access Control</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Manage who has access to this project
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                Access control is managed at the organization level.
              </p>
              <Button variant="outline" size="sm">
                <Users className="h-4 w-4 mr-2" />
                Manage Team
              </Button>
            </div>
          )}

          {activeSection === 'branches' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-medium mb-2">Branch Protection</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  Configure the default branch for this project
                </p>
                <div className="space-y-2 mb-6">
                  <Label>Default Branch</Label>
                  <Input defaultValue="main" />
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
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
              </div>
            </div>
          )}

          {activeSection === 'notifications' && (
            <div>
              <h2 className="text-lg font-medium mb-6">Notifications</h2>
              <div className="space-y-4">
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
              </div>
            </div>
          )}

          {activeSection === 'security' && (
            <div className="space-y-8">
              <div>
                <h2 className="text-lg font-medium mb-2">Security Settings</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  Manage secrets and environment variables
                </p>
                <Button variant="outline" size="sm">
                  <Key className="h-4 w-4 mr-2" />
                  Manage Secrets
                </Button>
              </div>

              <Separator />

              <div>
                <h3 className="text-sm font-medium mb-2">Dependency Scanning</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Automatically scan for vulnerable dependencies
                </p>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">Enable Scanning</p>
                    <p className="text-sm text-muted-foreground">
                      Scan dependencies on every push
                    </p>
                  </div>
                  <Switch defaultChecked />
                </div>
              </div>
            </div>
          )}

          {activeSection === 'danger' && (
            <div className="space-y-8">
              <h2 className="text-lg font-medium text-red-500">Danger Zone</h2>

              <div>
                <h3 className="font-medium mb-1">Archive Project</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Archive this project. It can be restored later.
                </p>
                <Button variant="outline" className="text-orange-500 hover:text-orange-600">
                  Archive Project
                </Button>
              </div>

              <Separator />

              <div>
                <h3 className="font-medium text-red-500 mb-1">Delete Project</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Permanently delete this project and all its data. This action cannot be undone.
                </p>
                <Button variant="destructive">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Project
                </Button>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
