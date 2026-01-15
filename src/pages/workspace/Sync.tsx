import { useAuth } from '../../contexts/AuthContext'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Progress } from '../../components/ui/progress'
import { Switch } from '../../components/ui/switch'
import { Label } from '../../components/ui/label'
import { Checkbox } from '../../components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select'
import {
  Cloud,
  RefreshCw,
  Check,
  AlertCircle,
  Clock,
  Download,
  HardDrive,
  FileCode,
  Settings,
  MessageSquare,
  FileText,
} from 'lucide-react'

const syncHistory = [
  { id: '1', time: '2 minutes ago', status: 'success', files: 12 },
  { id: '2', time: '1 hour ago', status: 'success', files: 45 },
  { id: '3', time: '3 hours ago', status: 'success', files: 8 },
  { id: '4', time: 'Yesterday', status: 'error', files: 0, error: 'Network timeout' },
  { id: '5', time: 'Yesterday', status: 'success', files: 156 },
]

export function Sync() {
  const { user, logout } = useAuth()

  const storage = {
    used: 12.5,
    total: 50,
    breakdown: [
      { name: 'Project Files', size: '8.2 GB', percentage: 65 },
      { name: 'Build Artifacts', size: '2.8 GB', percentage: 22 },
      { name: 'Chat History', size: '1.0 GB', percentage: 8 },
      { name: 'Settings', size: '0.5 GB', percentage: 5 },
    ],
  }

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Workspace' }, { label: 'Cloud Sync' }]}
    >
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Cloud Sync</h1>
        <p className="text-muted-foreground">
          Manage cloud backup and synchronization settings
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Sync Status */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Cloud className="h-5 w-5" />
                    Sync Status
                  </CardTitle>
                  <CardDescription>
                    Last synced 2 minutes ago
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="gap-1">
                  <Check className="h-3 w-3" />
                  Synced
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center">
                    <Check className="h-5 w-5 text-green-500" />
                  </div>
                  <div>
                    <p className="font-medium">All changes synced</p>
                    <p className="text-sm text-muted-foreground">
                      Your workspace is up to date
                    </p>
                  </div>
                </div>
                <Button className="gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Sync Now
                </Button>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Switch id="auto-sync" defaultChecked />
                  <Label htmlFor="auto-sync">Enable auto-sync</Label>
                </div>
                <div className="flex-1" />
                <div className="flex items-center gap-2">
                  <Label>Frequency</Label>
                  <Select defaultValue="realtime">
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="realtime">Real-time</SelectItem>
                      <SelectItem value="5min">Every 5 minutes</SelectItem>
                      <SelectItem value="1hour">Every hour</SelectItem>
                      <SelectItem value="manual">Manual only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* What Gets Synced */}
          <Card>
            <CardHeader>
              <CardTitle>Sync Settings</CardTitle>
              <CardDescription>
                Choose what data to sync to the cloud
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <FileCode className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <Label>Project Files</Label>
                    <p className="text-sm text-muted-foreground">
                      Source code, assets, and configurations
                    </p>
                  </div>
                </div>
                <Checkbox defaultChecked />
              </div>
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <Settings className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <Label>Settings</Label>
                    <p className="text-sm text-muted-foreground">
                      Editor preferences and workspace settings
                    </p>
                  </div>
                </div>
                <Checkbox defaultChecked />
              </div>
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <MessageSquare className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <Label>Chat History</Label>
                    <p className="text-sm text-muted-foreground">
                      AI conversations and prompts
                    </p>
                  </div>
                </div>
                <Checkbox defaultChecked />
              </div>
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <Label>Build Logs</Label>
                    <p className="text-sm text-muted-foreground">
                      Build and deployment history
                    </p>
                  </div>
                </div>
                <Checkbox />
              </div>
            </CardContent>
          </Card>

          {/* Sync History */}
          <Card>
            <CardHeader>
              <CardTitle>Sync History</CardTitle>
              <CardDescription>
                Recent synchronization events
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {syncHistory.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      {event.status === 'success' ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-red-500" />
                      )}
                      <div>
                        <p className="text-sm">
                          {event.status === 'success'
                            ? `Synced ${event.files} files`
                            : event.error}
                        </p>
                        <p className="text-xs text-muted-foreground">{event.time}</p>
                      </div>
                    </div>
                    {event.status === 'error' && (
                      <Button variant="ghost" size="sm">
                        Retry
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Storage Usage */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="h-5 w-5" />
                Storage
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>{storage.used} GB used</span>
                  <span className="text-muted-foreground">{storage.total} GB total</span>
                </div>
                <Progress value={(storage.used / storage.total) * 100} />
              </div>
              <div className="space-y-2">
                {storage.breakdown.map((item) => (
                  <div key={item.name} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{item.name}</span>
                    <span>{item.size}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button variant="outline" className="w-full justify-start gap-2">
                <RefreshCw className="h-4 w-4" />
                Force Full Sync
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2">
                <Download className="h-4 w-4" />
                Download Backup
              </Button>
              <Button variant="outline" className="w-full justify-start gap-2 text-destructive">
                <Clock className="h-4 w-4" />
                Clear Sync History
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  )
}
