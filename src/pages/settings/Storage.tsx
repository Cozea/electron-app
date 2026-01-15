import { useAuth } from '../../contexts/AuthContext'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Progress } from '../../components/ui/progress'
import { Badge } from '../../components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../components/ui/dialog'
import {
  Folder,
  FolderOpen,
  HardDrive,
  Trash2,
  FileText,
  Package,
  RefreshCw,
  AlertTriangle,
  Cloud,
  CloudOff,
} from 'lucide-react'

const localProjects = [
  {
    id: '1',
    name: 'E-commerce Platform',
    path: '~/Developer/Cozea/ecommerce',
    size: '2.4 GB',
    synced: true,
    lastOpened: '2 hours ago',
  },
  {
    id: '2',
    name: 'Dashboard Analytics',
    path: '~/Developer/Cozea/dashboard',
    size: '1.8 GB',
    synced: true,
    lastOpened: '1 day ago',
  },
  {
    id: '3',
    name: 'Mobile Backend',
    path: '~/Developer/Cozea/mobile-api',
    size: '0.9 GB',
    synced: false,
    lastOpened: '3 days ago',
  },
  {
    id: '4',
    name: 'Personal Blog',
    path: '~/Developer/Cozea/blog',
    size: '0.3 GB',
    synced: false,
    lastOpened: '1 week ago',
  },
]

export function Storage() {
  const { user, logout } = useAuth()

  const storage = {
    total: 15.2,
    breakdown: [
      { name: 'Projects', size: 5.4, icon: Folder },
      { name: 'Dependencies', size: 6.2, icon: Package },
      { name: 'Build Cache', size: 2.8, icon: HardDrive },
      { name: 'Logs', size: 0.8, icon: FileText },
    ],
  }

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Settings' }, { label: 'Storage' }]}
    >
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Storage</h1>
        <p className="text-muted-foreground">
          Manage local files and storage
        </p>
      </div>

      <div className="space-y-6">
        {/* Projects Directory */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" />
              Projects Directory
            </CardTitle>
            <CardDescription>
              Where new projects are created on your computer
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
              <Folder className="h-8 w-8 text-muted-foreground" />
              <div className="flex-1">
                <p className="font-mono text-sm">~/Developer/Cozea</p>
                <p className="text-xs text-muted-foreground">
                  New projects will be created in this directory
                </p>
              </div>
              <Button variant="outline">Change</Button>
            </div>
          </CardContent>
        </Card>

        {/* Storage Usage */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="h-5 w-5" />
              Local Storage
            </CardTitle>
            <CardDescription>
              {storage.total} GB used on this device
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4">
              {storage.breakdown.map((item) => {
                const Icon = item.icon
                const percentage = (item.size / storage.total) * 100
                return (
                  <div key={item.name} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">{item.name}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">{item.size} GB</span>
                    </div>
                    <Progress value={percentage} className="h-2" />
                  </div>
                )
              })}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full gap-2">
                    <Package className="h-4 w-4" />
                    Clear Cache
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Clear Build Cache</DialogTitle>
                    <DialogDescription>
                      This will remove 2.8 GB of cached build artifacts. Projects may take longer to build next time.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline">Cancel</Button>
                    <Button variant="destructive">Clear Cache</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" className="w-full gap-2">
                    <FileText className="h-4 w-4" />
                    Clear Logs
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Clear Logs</DialogTitle>
                    <DialogDescription>
                      This will remove 0.8 GB of log files. This action cannot be undone.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline">Cancel</Button>
                    <Button variant="destructive">Clear Logs</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Button variant="outline" className="w-full gap-2">
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>

              <Button variant="outline" className="w-full gap-2">
                <FolderOpen className="h-4 w-4" />
                View Folder
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Local Projects */}
        <Card>
          <CardHeader>
            <CardTitle>Local Projects</CardTitle>
            <CardDescription>
              Projects stored on this device
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Sync Status</TableHead>
                  <TableHead>Last Opened</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {localProjects.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell className="font-medium">{project.name}</TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {project.path}
                      </code>
                    </TableCell>
                    <TableCell>{project.size}</TableCell>
                    <TableCell>
                      {project.synced ? (
                        <Badge variant="secondary" className="gap-1">
                          <Cloud className="h-3 w-3" />
                          Synced
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                          <CloudOff className="h-3 w-3" />
                          Local only
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {project.lastOpened}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Danger Zone */}
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Danger Zone
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between p-4 border border-destructive/30 rounded-lg bg-destructive/5">
              <div>
                <h4 className="font-medium">Clear All Local Data</h4>
                <p className="text-sm text-muted-foreground">
                  Remove all local projects, cache, and settings from this device
                </p>
              </div>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="destructive" className="gap-2">
                    <Trash2 className="h-4 w-4" />
                    Clear All
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Clear All Local Data</DialogTitle>
                    <DialogDescription>
                      This will remove all local projects, build cache, logs, and settings.
                      Cloud-synced data will not be affected. This action cannot be undone.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline">Cancel</Button>
                    <Button variant="destructive">Clear Everything</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  )
}
