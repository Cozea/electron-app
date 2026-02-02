import { useState, useEffect } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { GitBranch, Loader2, AlertCircle, CheckCircle2, ChevronRight } from 'lucide-react'
import { IconBrandGithub, IconBrandGitlab, IconFolder } from '@tabler/icons-react'
import type { WizardRepoSource } from '@/hooks/useWizardState'
import { getFileIcon, getFolderIcon } from '@/lib/fileExplorer/fileIcons'
import { cn } from '@/lib/utils'

interface FileTreeNode {
  name: string
  path: string
  isDirectory: boolean
  children?: FileTreeNode[]
}

interface RepoSourceStepProps {
  repoSource: WizardRepoSource | undefined
  onUpdate: (repoSource: Partial<WizardRepoSource>) => void
  hasGitHubIntegration?: boolean
  onConnectGitHub?: () => void
}

const REPO_PROVIDERS = [
  { id: 'github', name: 'GitHub', icon: IconBrandGithub },
  { id: 'gitlab', name: 'GitLab', icon: IconBrandGitlab },
  { id: 'local', name: 'Local Folder', icon: IconFolder },
]

const COMMON_BRANCHES = ['main', 'master', 'develop', 'dev']

export function RepoSourceStep({
  repoSource,
  onUpdate,
  hasGitHubIntegration = false,
  onConnectGitHub,
}: RepoSourceStepProps) {
  const [isValidating, setIsValidating] = useState(false)
  const [validationResult, setValidationResult] = useState<'valid' | 'invalid' | null>(null)
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([])
  const [isLoadingTree, setIsLoadingTree] = useState(false)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())

  const currentProvider = repoSource?.provider || 'github'

  // Load file tree when local folder is selected
  useEffect(() => {
    if (currentProvider === 'local' && repoSource?.repoUrl) {
      loadFileTree(repoSource.repoUrl)
    } else {
      setFileTree([])
    }
  }, [currentProvider, repoSource?.repoUrl])

  const loadFileTree = async (folderPath: string) => {
    setIsLoadingTree(true)
    try {
      const entries = await window.electronAPI.fs.readDir(folderPath)
      if (entries && Array.isArray(entries)) {
        const tree = entries
          .filter((entry: { name: string }) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
          .sort((a: { isDirectory: boolean; name: string }, b: { isDirectory: boolean; name: string }) => {
            if (a.isDirectory && !b.isDirectory) return -1
            if (!a.isDirectory && b.isDirectory) return 1
            return a.name.localeCompare(b.name)
          })
          .slice(0, 50) // Limit to first 50 entries
          .map((entry: { name: string; isDirectory: boolean }) => ({
            name: entry.name,
            path: `${folderPath}/${entry.name}`,
            isDirectory: entry.isDirectory,
          }))
        setFileTree(tree)
        // Auto-expand root level
        setExpandedDirs(new Set())
      }
    } catch (error) {
      console.error('Failed to load file tree:', error)
    } finally {
      setIsLoadingTree(false)
    }
  }

  const toggleDir = async (path: string) => {
    const isCurrentlyExpanded = expandedDirs.has(path)

    if (!isCurrentlyExpanded) {
      // Check if we need to load children
      const findNode = (nodes: FileTreeNode[]): FileTreeNode | undefined => {
        for (const node of nodes) {
          if (node.path === path) return node
          if (node.children) {
            const found = findNode(node.children)
            if (found) return found
          }
        }
        return undefined
      }

      const targetNode = findNode(fileTree)
      if (targetNode?.isDirectory && !targetNode.children) {
        // Start loading
        setLoadingDirs(prev => new Set(prev).add(path))

        try {
          const entries = await window.electronAPI.fs.readDir(path)
          if (entries && Array.isArray(entries)) {
            const children = entries
              .filter((entry: { name: string }) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
              .sort((a: { isDirectory: boolean; name: string }, b: { isDirectory: boolean; name: string }) => {
                if (a.isDirectory && !b.isDirectory) return -1
                if (!a.isDirectory && b.isDirectory) return 1
                return a.name.localeCompare(b.name)
              })
              .slice(0, 50)
              .map((entry: { name: string; isDirectory: boolean }) => ({
                name: entry.name,
                path: `${path}/${entry.name}`,
                isDirectory: entry.isDirectory,
              }))

            // Update tree with children
            const updateTree = (nodes: FileTreeNode[]): FileTreeNode[] => {
              return nodes.map(node => {
                if (node.path === path) {
                  return { ...node, children }
                }
                if (node.children) {
                  return { ...node, children: updateTree(node.children) }
                }
                return node
              })
            }

            setFileTree(prev => updateTree(prev))
          }
        } catch (error) {
          console.error('Failed to load children:', error)
        } finally {
          setLoadingDirs(prev => {
            const next = new Set(prev)
            next.delete(path)
            return next
          })
        }
      }
    }

    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  const handleProviderChange = (providerId: string) => {
    onUpdate({ provider: providerId, repoUrl: '', branch: 'main' })
    setValidationResult(null)
    setFileTree([])
  }

  const handleUrlChange = (url: string) => {
    onUpdate({ repoUrl: url })
    setValidationResult(null)
  }

  const handleBranchChange = (branch: string) => {
    onUpdate({ branch })
  }

  const handleBrowseFolder = async () => {
    try {
      const result = await window.electronAPI.dialog.selectDirectory()
      if (result && result.path) {
        // For local folders, set branch to 'main' as default (required by mutation)
        onUpdate({ repoUrl: result.path, provider: 'local', branch: 'main' })
        setValidationResult('valid')
      }
    } catch (error) {
      console.error('Failed to select directory:', error)
    }
  }

  const validateGitHubUrl = (url: string): boolean => {
    if (!url) return false
    try {
      const parsed = new URL(url)
      return parsed.hostname === 'github.com' && parsed.pathname.split('/').filter(Boolean).length >= 2
    } catch {
      // Try matching owner/repo pattern
      return /^[\w.-]+\/[\w.-]+$/.test(url)
    }
  }

  const validateGitLabUrl = (url: string): boolean => {
    if (!url) return false
    try {
      const parsed = new URL(url)
      return parsed.hostname.includes('gitlab') && parsed.pathname.split('/').filter(Boolean).length >= 2
    } catch {
      return false
    }
  }

  const handleValidate = async () => {
    const url = repoSource?.repoUrl || ''
    if (!url) return

    setIsValidating(true)

    // Simple validation for now - just check URL format
    await new Promise(resolve => setTimeout(resolve, 500))

    let isValid = false
    if (currentProvider === 'github') {
      isValid = validateGitHubUrl(url)
    } else if (currentProvider === 'gitlab') {
      isValid = validateGitLabUrl(url)
    } else if (currentProvider === 'local') {
      isValid = !!url
    }

    setValidationResult(isValid ? 'valid' : 'invalid')
    setIsValidating(false)
  }

  const getPlaceholder = () => {
    switch (currentProvider) {
      case 'github':
        return 'https://github.com/owner/repo or owner/repo'
      case 'gitlab':
        return 'https://gitlab.com/owner/repo'
      case 'local':
        return '/path/to/project'
      default:
        return ''
    }
  }

  return (
    <div className="flex flex-col gap-6 h-full">
      {/* Provider Selection */}
      <div className="shrink-0">
        <div className="flex flex-wrap gap-2">
          {REPO_PROVIDERS.map((provider) => {
            const Icon = provider.icon
            return (
              <Badge
                key={provider.id}
                variant={currentProvider === provider.id ? 'default' : 'outline'}
                className="cursor-pointer px-4 py-2 text-sm gap-2"
                onClick={() => handleProviderChange(provider.id)}
              >
                <Icon className="h-4 w-4" />
                {provider.name}
              </Badge>
            )
          })}
        </div>
      </div>

      {/* Repository URL / Path */}
      {currentProvider === 'local' ? (
        <div className="flex flex-col gap-4 flex-1">
          {/* Drop zone */}
          <button
            type="button"
            onClick={handleBrowseFolder}
            className="w-full flex-1 min-h-[320px] rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 hover:bg-muted/30 hover:border-muted-foreground/50 transition-colors p-8 cursor-pointer flex items-center justify-center"
          >
            <div className="flex flex-col items-center gap-4">
              {/* Windows-style folder icon */}
              <svg width="56" height="48" viewBox="0 0 56 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                {/* Folder tab */}
                <path d="M2 8C2 5.79086 3.79086 4 6 4H18L24 12H50C52.2091 12 54 13.7909 54 16V42C54 44.2091 52.2091 46 50 46H6C3.79086 46 2 44.2091 2 42V8Z" fill="#F5C242"/>
                {/* Folder body */}
                <path d="M2 16H54V42C54 44.2091 52.2091 46 50 46H6C3.79086 46 2 44.2091 2 42V16Z" fill="#FCDC6C"/>
                {/* Tab fold */}
                <path d="M18 4L24 12H18V4Z" fill="#E5A620"/>
              </svg>
              <div className="text-center">
                <p className="text-sm text-foreground">
                  Click to select a folder, or{' '}
                  <span className="underline underline-offset-2">browse</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Select a folder containing your existing project
                </p>
              </div>
            </div>
          </button>

          {/* File tree */}
          {repoSource?.repoUrl && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-muted-foreground">
                  {repoSource.repoUrl.split('/').pop()}
                </p>
                <button
                  type="button"
                  onClick={handleBrowseFolder}
                  className="text-xs text-primary hover:underline"
                >
                  Change folder
                </button>
              </div>
              <div className="rounded-lg border border-border bg-muted/20 max-h-64 overflow-y-auto">
                {isLoadingTree ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : fileTree.length > 0 ? (
                  <div className="p-2 space-y-0.5">
                    {fileTree.map((node) => (
                      <FileTreeItem
                        key={node.path}
                        node={node}
                        level={0}
                        expandedDirs={expandedDirs}
                        loadingDirs={loadingDirs}
                        onToggle={toggleDir}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No files found
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <Label className="text-base font-medium">
            Repository URL <span className="text-destructive">*</span>
          </Label>
          <div className="space-y-2">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Input
                  value={repoSource?.repoUrl || ''}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  onBlur={handleValidate}
                  placeholder={getPlaceholder()}
                  className={`h-11 bg-muted/30 border-muted/60 focus:bg-background transition-colors pr-10 ${
                    validationResult === 'valid' ? 'border-green-500' : ''
                  } ${validationResult === 'invalid' ? 'border-destructive' : ''}`}
                />
                {isValidating && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {validationResult === 'valid' && !isValidating && (
                  <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />
                )}
                {validationResult === 'invalid' && !isValidating && (
                  <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-destructive" />
                )}
              </div>
            </div>
            {validationResult === 'invalid' && (
              <p className="text-xs text-destructive">
                Please enter a valid {currentProvider === 'github' ? 'GitHub' : 'GitLab'} repository URL
              </p>
            )}
            {currentProvider === 'github' && !hasGitHubIntegration && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>For private repos,</span>
                <button
                  onClick={onConnectGitHub}
                  className="text-primary hover:underline"
                >
                  connect your GitHub account
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Branch Selection - only for remote repos */}
      {currentProvider !== 'local' && (
        <div className="space-y-3">
          <Label className="text-base font-medium flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            Branch
          </Label>
          <Select
            value={repoSource?.branch || 'main'}
            onValueChange={handleBranchChange}
          >
            <SelectTrigger className="h-11 bg-muted/30 border-muted/60 focus:bg-background">
              <SelectValue placeholder="Select branch" />
            </SelectTrigger>
            <SelectContent>
              {COMMON_BRANCHES.map((branch) => (
                <SelectItem key={branch} value={branch}>
                  {branch}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Select the branch to import. You can change this later.
          </p>
        </div>
      )}

      {/* Provider-specific info */}
      {currentProvider === 'github' && (
        <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
          <p className="text-sm font-medium">GitHub Import</p>
          <p className="text-xs text-muted-foreground">
            We'll clone your repository, analyze the codebase structure, and detect your tech stack automatically.
            {hasGitHubIntegration
              ? ' Your GitHub account is connected for private repo access.'
              : ' Public repositories can be imported directly.'}
          </p>
        </div>
      )}

      {currentProvider === 'gitlab' && (
        <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
          <p className="text-sm font-medium">GitLab Import</p>
          <p className="text-xs text-muted-foreground">
            Works with GitLab.com and self-hosted GitLab instances.
            Make sure your repository is accessible.
          </p>
        </div>
      )}

    </div>
  )
}

function FileTreeItem({
  node,
  level,
  expandedDirs,
  loadingDirs,
  onToggle,
}: {
  node: FileTreeNode
  level: number
  expandedDirs: Set<string>
  loadingDirs: Set<string>
  onToggle: (path: string) => void
}) {
  const isExpanded = expandedDirs.has(node.path)
  const isLoading = loadingDirs.has(node.path)

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 py-1 px-2 rounded-md text-sm select-none",
          node.isDirectory ? "cursor-pointer hover:bg-accent/50" : "cursor-default"
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={() => node.isDirectory && onToggle(node.path)}
      >
        {node.isDirectory ? (
          <>
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 text-muted-foreground shrink-0 animate-spin" />
            ) : (
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform duration-200",
                  isExpanded && "rotate-90"
                )}
              />
            )}
            {getFolderIcon(node.name, isExpanded)}
          </>
        ) : (
          <>
            <span className="w-3.5" />
            {getFileIcon(node.name)}
          </>
        )}
        <span className="truncate text-foreground/90">{node.name}</span>
      </div>
      {node.isDirectory && isExpanded && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeItem
              key={child.path}
              node={child}
              level={level + 1}
              expandedDirs={expandedDirs}
              loadingDirs={loadingDirs}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  )
}
