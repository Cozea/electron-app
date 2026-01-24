import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Database,
  Table,
  Code,
  RefreshCw,
  Plus,
  Loader2,
} from 'lucide-react'

export function ProjectDatabasePage() {
  const { slug } = useParams<{ slug: string }>()
  const { currentOrganization } = useAuth()
  const [activeTab, setActiveTab] = useState('schema')

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
          <Database className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-medium">Database</h1>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            New Table
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="schema" className="gap-2">
              <Table className="h-4 w-4" />
              Schema
            </TabsTrigger>
            <TabsTrigger value="data" className="gap-2">
              <Database className="h-4 w-4" />
              Data
            </TabsTrigger>
            <TabsTrigger value="query" className="gap-2">
              <Code className="h-4 w-4" />
              Query
            </TabsTrigger>
          </TabsList>

          <TabsContent value="schema" className="mt-6">
            <Card className="p-12 text-center">
              <Database className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium mb-2">No Database Detected</h3>
              <p className="text-sm text-muted-foreground mb-4">
                This project doesn't have a database configured yet.
                Add a database to start managing your data.
              </p>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Setup Database
              </Button>
            </Card>
          </TabsContent>

          <TabsContent value="data" className="mt-6">
            <Card className="p-12 text-center">
              <Table className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium mb-2">No Tables</h3>
              <p className="text-sm text-muted-foreground">
                Create a table in the Schema tab to start viewing data.
              </p>
            </Card>
          </TabsContent>

          <TabsContent value="query" className="mt-6">
            <Card className="p-6">
              <div className="bg-muted rounded-md p-4 font-mono text-sm">
                <p className="text-muted-foreground">-- Write your SQL query here</p>
                <p className="text-muted-foreground">SELECT * FROM users;</p>
              </div>
              <div className="mt-4 flex justify-end">
                <Button className="gap-2">
                  <Code className="h-4 w-4" />
                  Run Query
                </Button>
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
