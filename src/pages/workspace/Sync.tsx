import { useState, useMemo } from 'react'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { Button } from '../../components/ui/button'
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
  Trash2,
  Users,
  Sparkles,
  Archive,
  Image,
  Lock,
  Loader2,
} from 'lucide-react'
import { WorkspaceAccessNotice } from '@/components/workspaces/WorkspaceAccessNotice'
import { useScopedCloudStorageData } from '@/hooks/useScopedCloudStorageData'

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
    description: 'Canonical Cozea Git repositories and source configuration stored in cloud sync',
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
    name: 'Build History',
    description: 'Builder run logs, task state, and execution metadata',
    icon: Archive,
    color: 'bg-orange-500',
    canClear: true,
    clearWarning: 'This will permanently delete stored builder run history across your workspace.',
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

const getLegendLabel = (category: StorageCategory): string => {
  switch (category.categoryKey) {
    case 'sourceAndConfig':
      return 'Source'
    case 'collaborationData':
      return 'Collab'
    case 'aiHistory':
      return 'AI'
    case 'buildCache':
      return 'Build'
    case 'snapshots':
      return 'Snapshots'
    case 'assets':
      return 'Assets'
    default:
      return category.name
  }
}

export function Sync() {
  const {
    settingsPage,
    user,
    logout,
    convexOrgId,
    usageLimits,
    totalUsed,
    totalLimit,
    isUnlimited,
    clearStorageCategory,
  } = useScopedCloudStorageData()
  const [clearingCategory, setClearingCategory] = useState<StorageCategory | null>(null)
  const [isClearing, setIsClearing] = useState(false)

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

  const clearableSize = storageCategories
    .filter(cat => cat.canClear)
    .reduce((sum, cat) => sum + cat.size, 0)

  const handleClear = async () => {
    if (!clearingCategory || !convexOrgId) return

    const categoryKey = clearingCategory.categoryKey as
      | 'collaborationData'
      | 'aiHistory'
      | 'buildCache'
      | 'snapshots'

    setIsClearing(true)
    try {
      await clearStorageCategory(categoryKey)
    } catch (error) {
      console.error('Failed to clear storage:', error)
    } finally {
      setIsClearing(false)
      setClearingCategory(null)
    }
  }

  return (
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={settingsPage.breadcrumbs}
    >
      {settingsPage.isWorkspaceAccessDenied ? (
        <WorkspaceAccessNotice
          title="Cloud storage access required"
          description="You do not have permission to view workspace cloud storage and usage."
        />
      ) : (
        <>
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
                          <span className="text-muted-foreground">{getLegendLabel(cat)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="md:border-l md:border-border md:pl-4">
                  <h2 className="text-base font-semibold">Free Up Space</h2>
                  <div className="mt-0.5 space-y-2">
                    <div className="text-sm">
                      {clearableSize > 0 ? (
                        <>
                          <span className="font-medium">{formatSize(clearableSize)}</span>
                          <span className="text-muted-foreground"> can be cleared</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Nothing to clear</span>
                      )}
                    </div>
                    <div className="h-4 rounded-full overflow-hidden bg-muted">
                      {clearableSize > 0 ? (
                        <div
                          className="h-full bg-primary transition-all"
                          style={{
                            width: `${totalUsed > 0 ? Math.min((clearableSize / totalUsed) * 100, 100) : 0}%`,
                          }}
                          aria-label="Clearable storage"
                        />
                      ) : null}
                    </div>
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
              <div className="overflow-hidden rounded-2xl bg-secondary/80 dark:bg-secondary/40">
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
                                <Badge
                                  className="h-5 w-5 bg-secondary/60 text-muted-foreground border-0 p-0"
                                  aria-label="Protected"
                                  title="Protected"
                                >
                                  <Lock className="h-3 w-3" />
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
                          <div className="flex justify-end">
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
                              <span className="inline-flex h-9 w-9 items-center justify-center text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="px-4">
              <div className="rounded-2xl bg-primary/5 p-5">
                <p className="text-sm text-muted-foreground">
                  More storage options per workspace will be supported soon.
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  This page will expand with additional workspace-level storage controls as they roll out.
                </p>
              </div>
            </div>
          </div>

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
                  className="bg-destructive text-white hover:bg-destructive/90 disabled:bg-destructive/70 disabled:text-white disabled:opacity-100"
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
        </>
      )}
    </DashboardLayout>
  )
}
