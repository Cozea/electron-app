import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Progress } from '../../components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog'
import {
  FileCode,
  History,
  Database,
  Trash2,
  Users,
  GitBranch,
  Sparkles,
  Archive,
  Image,
  Loader2,
} from 'lucide-react'
import type { Id } from '../../../convex/_generated/dataModel'

interface StorageCategory {
  id: string
  categoryKey: string // Key for the mutation (e.g., 'collaborationData')
  name: string
  description: string
  size: number // in GB
  icon: typeof FileCode
  color: string
  canClear: boolean
  clearWarning?: string
}

// Default categories with static descriptions and settings
const categoryConfig: Record<string, Omit<StorageCategory, 'size'>> = {
  sourceAndConfig: {
    id: 'source',
    categoryKey: 'sourceAndConfig',
    name: 'Source & Config',
    description: 'Project source code, configurations, and dependencies',
    icon: FileCode,
    color: 'bg-blue-500',
    canClear: false,
  },
  collaborationData: {
    id: 'collab',
    categoryKey: 'collaborationData',
    name: 'Collaboration Data',
    description: 'Real-time sync state, document history (Yjs)',
    icon: Users,
    color: 'bg-purple-500',
    canClear: true,
    clearWarning: 'This will reset collaboration history. Active sessions will resync from source files.',
  },
  aiHistory: {
    id: 'ai',
    categoryKey: 'aiHistory',
    name: 'AI History',
    description: 'Chat conversations, prompts, and AI context',
    icon: Sparkles,
    color: 'bg-amber-500',
    canClear: true,
    clearWarning: 'This will permanently delete all AI chat history across your workspace.',
  },
  buildCache: {
    id: 'builds',
    categoryKey: 'buildCache',
    name: 'Build Cache',
    description: 'Compiled assets, bundled output, and build artifacts',
    icon: Archive,
    color: 'bg-orange-500',
    canClear: true,
    clearWarning: 'Build caches will be regenerated on next build. This is safe to clear.',
  },
  snapshots: {
    id: 'snapshots',
    categoryKey: 'snapshots',
    name: 'Snapshots',
    description: 'Auto-saved project states and point-in-time backups',
    icon: History,
    color: 'bg-green-500',
    canClear: true,
    clearWarning: 'This will delete all restore points. You won\'t be able to revert to previous states.',
  },
  gitHistory: {
    id: 'git',
    categoryKey: 'gitHistory',
    name: 'Git History',
    description: 'Version control data and file history',
    icon: GitBranch,
    color: 'bg-rose-500',
    canClear: false,
  },
  databaseBackups: {
    id: 'database',
    categoryKey: 'databaseBackups',
    name: 'Database Backups',
    description: 'Local database snapshots and migration history',
    icon: Database,
    color: 'bg-cyan-500',
    canClear: true,
    clearWarning: 'This will delete database backups. Current databases are not affected.',
  },
  assets: {
    id: 'assets',
    categoryKey: 'assets',
    name: 'Assets',
    description: 'Images, fonts, and other media files',
    icon: Image,
    color: 'bg-teal-500',
    canClear: false,
  },
}

const formatSize = (gb: number): string => {
  if (gb >= 1) {
    return `${gb.toFixed(1)} GB`
  }
  if (gb >= 0.001) {
    return `${Math.round(gb * 1024)} MB`
  }
  return `${Math.round(gb * 1024 * 1024)} KB`
}

const bytesToGB = (bytes: number): number => bytes / (1024 * 1024 * 1024)

export function Sync() {
  const { user, logout, currentOrganization, convexUserId } = useAuth()
  const navigate = useNavigate()
  const [clearingCategory, setClearingCategory] = useState<StorageCategory | null>(null)
  const [isClearing, setIsClearing] = useState(false)

  // Get the Convex organization ID
  const convexOrgId = currentOrganization?.convexOrgId as Id<"organizations"> | undefined

  // Mutation for clearing storage categories
  const clearStorageMutation = useMutation(api.organizations.clearStorageCategory)

  // Query usage limits from Convex (reactive - updates automatically)
  const usageLimits = useQuery(
    api.organizations.getUsageLimits,
    convexOrgId ? { orgId: convexOrgId } : "skip"
  )

  // Build storage categories from the breakdown data
  const storageCategories = useMemo<StorageCategory[]>(() => {
    if (!usageLimits?.storage.breakdown) {
      // Return empty categories while loading
      return Object.values(categoryConfig).map((config) => ({
        ...config,
        size: 0,
      }))
    }

    const breakdown = usageLimits.storage.breakdown
    return Object.entries(categoryConfig).map(([key, config]) => ({
      ...config,
      size: bytesToGB(breakdown[key as keyof typeof breakdown] ?? 0),
    }))
  }, [usageLimits])

  // Calculate totals
  const totalUsed = usageLimits?.storage.currentBytes
    ? bytesToGB(usageLimits.storage.currentBytes)
    : storageCategories.reduce((sum, cat) => sum + cat.size, 0)

  const totalLimit = usageLimits?.storage.limitGB ?? 1
  const isUnlimited = usageLimits?.storage.isUnlimited ?? false

  const clearableSize = storageCategories
    .filter(cat => cat.canClear)
    .reduce((sum, cat) => sum + cat.size, 0)

  const handleClear = async () => {
    if (!clearingCategory || !convexOrgId || !convexUserId) return

    const categoryKey = clearingCategory.categoryKey as
      | 'collaborationData'
      | 'aiHistory'
      | 'buildCache'
      | 'snapshots'
      | 'databaseBackups'

    setIsClearing(true)
    try {
      await clearStorageMutation({
        orgId: convexOrgId,
        userId: convexUserId,
        category: categoryKey,
      })
    } catch (error) {
      console.error('Failed to clear storage:', error)
    } finally {
      setIsClearing(false)
      setClearingCategory(null)
    }
  }

  // Plan upgrade messages
  const getUpgradeMessage = (plan: string) => {
    switch (plan) {
      case 'free':
        return 'Upgrade to Pro for 10 GB storage.'
      case 'pro':
        return 'Upgrade to Max for 20 GB storage.'
      case 'max':
        return 'Upgrade to Team for 30 GB storage.'
      case 'team':
        return 'Contact sales for Enterprise with unlimited storage.'
      default:
        return ''
    }
  }

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Workspace' }, { label: 'Cloud Storage' }]}
    >
      <div className="space-y-6">
        {/* Header Stats */}
        <div className="px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Total Storage */}
            <div className="md:col-span-2">
              <div className="space-y-4">
                <div className="flex items-end justify-between">
                  <div className="flex items-end gap-2">
                    <span className="text-4xl font-bold">{totalUsed.toFixed(1)}</span>
                    <span className="text-lg text-muted-foreground mb-1">
                      / {isUnlimited ? '∞' : totalLimit} GB
                    </span>
                    <Badge variant="secondary" className="mb-1.5">
                      {usageLimits?.planDisplayName ?? 'Free'}
                    </Badge>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {isUnlimited
                      ? 'Unlimited storage'
                      : `${(totalLimit - totalUsed).toFixed(1)} GB available`}
                  </span>
                </div>

                {/* Stacked Bar */}
                <div className="h-4 rounded-full overflow-hidden flex bg-muted">
                  {storageCategories.map((cat) => (
                    <div
                      key={cat.id}
                      className={`${cat.color} transition-all relative group`}
                      style={{
                        width: isUnlimited || totalUsed === 0
                          ? `${(cat.size / Math.max(totalUsed, 0.001)) * 100}%`
                          : `${(cat.size / totalLimit) * 100}%`
                      }}
                      title={`${cat.name}: ${formatSize(cat.size)}`}
                    />
                  ))}
                </div>

                {/* Legend */}
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {storageCategories.map((cat) => (
                    <div key={cat.id} className="flex items-center gap-1.5 text-xs">
                      <div className={`w-2 h-2 rounded-full ${cat.color}`} />
                      <span className="text-muted-foreground">{cat.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="md:border-l md:border-border md:pl-4">
              <div className="pb-2">
                <h2 className="text-base font-semibold">Free Up Space</h2>
                <p className="text-sm text-muted-foreground">Clear cached and temporary data</p>
              </div>
              <div className="space-y-3">
                <div className="text-sm">
                  <span className="font-medium">{formatSize(clearableSize)}</span>
                  <span className="text-muted-foreground"> can be cleared</span>
                </div>
                <Progress
                  value={totalUsed > 0 ? (clearableSize / totalUsed) * 100 : 0}
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground">
                  Source code and git history cannot be cleared from here.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Storage Categories */}
        <div className="px-4">
          <div className="mb-4">
            <h2 className="text-lg font-semibold">Storage by Category</h2>
            <p className="text-sm text-muted-foreground">
              Manage cloud storage across your workspace. Clear categories to free up space.
            </p>
          </div>
          <div className="overflow-hidden rounded-2xl bg-secondary/80 dark:bg-secondary/40 px-2 py-1">
            <Table className="w-full [&_th]:px-4 [&_td]:px-4">
              <TableHeader className="[&_tr]:border-b [&_tr]:border-border/60">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-[280px]">Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[100px] text-right">Size</TableHead>
                  <TableHead className="w-[80px] text-right">% Total</TableHead>
                  <TableHead className="w-[100px] text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="[&_tr]:border-b [&_tr]:border-border/60 [&_tr:last-child]:border-0">
                {storageCategories.map((category) => (
                  <TableRow key={category.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-muted/50 flex items-center justify-center">
                        <category.icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{category.name}</span>
                          {!category.canClear && (
                          <Badge className="text-xs bg-secondary/60 text-muted-foreground border-0">
                            Protected
                          </Badge>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[300px] truncate">
                      {category.description}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatSize(category.size)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {totalUsed > 0 ? ((category.size / totalUsed) * 100).toFixed(0) : 0}%
                    </TableCell>
                    <TableCell className="text-right">
                    {category.canClear ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => setClearingCategory(category)}
                        aria-label={`Clear ${category.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Storage Plan */}
        {usageLimits?.plan !== 'enterprise' && (
          <div className="px-4">
          <div className="rounded-2xl bg-primary/5 p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {getUpgradeMessage(usageLimits?.plan ?? 'free')}
                </p>
                <Button size="sm" onClick={() => navigate('/workspace/billing')}>Upgrade Plan</Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Clear Confirmation Dialog */}
      <AlertDialog open={!!clearingCategory} onOpenChange={() => setClearingCategory(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear {clearingCategory?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {clearingCategory?.clearWarning}
              <br /><br />
              This will free up <strong>{clearingCategory && formatSize(clearingCategory.size)}</strong> of storage.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isClearing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClear}
              disabled={isClearing}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isClearing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Clearing...
                </>
              ) : (
                'Clear Data'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  )
}
