import { useParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Server,
  Plus,
  Loader2,
  Database,
  Globe,
  Lock,
  Workflow,
} from 'lucide-react'

export function ProjectBackendStudioPage() {
  const { slug } = useParams<{ slug: string }>()
  const { currentOrganization } = useAuth()

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
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-9 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Server className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-medium">Backend Studio</h1>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            New Endpoint
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-blue-500/10">
                <Globe className="h-5 w-5 text-blue-500" />
              </div>
              <div>
                <h3 className="font-medium">API Endpoints</h3>
                <p className="text-sm text-muted-foreground">0 endpoints</p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="w-full gap-2">
              <Plus className="h-4 w-4" />
              Create Endpoint
            </Button>
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-purple-500/10">
                <Database className="h-5 w-5 text-purple-500" />
              </div>
              <div>
                <h3 className="font-medium">Database Models</h3>
                <p className="text-sm text-muted-foreground">0 models</p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="w-full gap-2">
              <Plus className="h-4 w-4" />
              Create Model
            </Button>
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-lg bg-green-500/10">
                <Lock className="h-5 w-5 text-green-500" />
              </div>
              <div>
                <h3 className="font-medium">Auth Rules</h3>
                <p className="text-sm text-muted-foreground">0 rules</p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="w-full gap-2">
              <Plus className="h-4 w-4" />
              Add Rule
            </Button>
          </Card>
        </div>

        {/* Visual Canvas Placeholder */}
        <Card className="p-12 text-center border-dashed">
          <Workflow className="h-16 w-16 mx-auto mb-4 text-muted-foreground opacity-30" />
          <h3 className="text-lg font-medium mb-2">Backend Visual Studio</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Design your backend visually. Create API endpoints, database models,
            and authentication rules with a drag-and-drop interface.
          </p>
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Start Building
          </Button>
        </Card>
      </div>
    </div>
  )
}
