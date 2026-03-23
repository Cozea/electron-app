import { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import { Loader2 } from 'lucide-react'
import type { Id } from '../../../../convex/_generated/dataModel'
import type { WizardRepoSource } from '@/hooks/useWizardState'
import { getFileIcon } from '@/lib/fileExplorer/fileIcons'
import { cn } from '@/lib/utils'
import { ConnectedRepositoryPicker } from '@/components/git/ConnectedRepositoryPicker'

interface DirectoryEntry {
  name: string
  path: string
  isDirectory: boolean
  kind?: 'up'
}

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'ico',
  'tif',
  'tiff',
])

const THUMBNAIL_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
])

function getImageMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    case 'svg': return 'image/svg+xml'
    default: return 'application/octet-stream'
  }
}

function getParentDirectoryPath(fullPath: string): string {
  const normalized = fullPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash <= 0) return normalized
  return normalized.slice(0, lastSlash)
}

function LocalFolderIcon({
  className,
}: {
  className?: string
}) {
  return (
    <svg
      width="56"
      height="48"
      viewBox="0 0 56 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M2 8C2 5.79086 3.79086 4 6 4H18L24 12H50C52.2091 12 54 13.7909 54 16V42C54 44.2091 52.2091 46 50 46H6C3.79086 46 2 44.2091 2 42V8Z"
        fill="#F5C242"
      />
      <path
        d="M2 16H54V42C54 44.2091 52.2091 46 50 46H6C3.79086 46 2 44.2091 2 42V16Z"
        fill="#FCDC6C"
      />
      <path d="M18 4L24 12H18V4Z" fill="#E5A620" />
    </svg>
  )
}

function LocalDocumentIcon({
  className,
}: {
  className?: string
}) {
  return (
    <svg
      width="46"
      height="56"
      viewBox="0 0 46 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M10 2H28L44 18V50C44 52.2091 42.2091 54 40 54H10C7.79086 54 6 52.2091 6 50V6C6 3.79086 7.79086 2 10 2Z"
        fill="#F4F4F5"
      />
      <path
        d="M28 2V18H44"
        fill="#E4E4E7"
      />
      <path
        d="M28 2L44 18H28V2Z"
        fill="#D4D4D8"
      />
      <path
        d="M14 26H36"
        stroke="#A1A1AA"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path
        d="M14 34H32"
        stroke="#A1A1AA"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.4"
      />
      <path
        d="M14 42H28"
        stroke="#A1A1AA"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.3"
      />
    </svg>
  )
}

interface RepoSourceStepProps {
  repoSource: WizardRepoSource | undefined
  onUpdate: (repoSource: Partial<WizardRepoSource>) => void
  onBrowseFolder?: () => void | Promise<void>
  organizationId?: Id<'organizations'>
  entryMode: 'local' | 'remote'
  connectedProviders?: Array<'github' | 'gitlab'>
  remoteRepositorySearchValue?: string
  remoteRepositoryRefreshNonce?: number
  onRemoteRepositoriesLoadingChange?: (isLoading: boolean) => void
}

export function RepoSourceStep({
  repoSource,
  onUpdate,
  onBrowseFolder,
  organizationId,
  entryMode,
  connectedProviders = [],
  remoteRepositorySearchValue,
  remoteRepositoryRefreshNonce,
  onRemoteRepositoriesLoadingChange,
}: RepoSourceStepProps) {
  const folderPath = repoSource?.provider === 'local' ? repoSource.repoUrl ?? '' : ''
  const [navigatedDirectoryPath, setNavigatedDirectoryPath] = useState<string | null>(null)
  const [directoryEntries, setDirectoryEntries] = useState<DirectoryEntry[]>([])
  const [isLoadingGrid, setIsLoadingGrid] = useState(false)
  const hasLocalFolderSelected = Boolean(folderPath)
  const selectedFolderName = folderPath ? folderPath.split(/[/\\]/).pop() : null

  useEffect(() => {
    if (!repoSource?.branch) {
      onUpdate({ branch: 'main' })
    }
  }, [onUpdate, repoSource?.branch])

  const selectedDirectoryPath = useMemo(() => {
    if (!folderPath) {
      return null
    }

    if (!navigatedDirectoryPath) {
      return folderPath
    }

    return navigatedDirectoryPath.startsWith(folderPath) ? navigatedDirectoryPath : folderPath
  }, [folderPath, navigatedDirectoryPath])

  useEffect(() => {
    const dirPath = selectedDirectoryPath
    if (!dirPath) {
      return
    }

    let canceled = false
    setTimeout(() => setIsLoadingGrid(true), 0)

    window.electronAPI.fs.readDir(dirPath)
      .then((entries) => {
        if (canceled) return
        const next = (entries ?? [])
          .filter((entry: { name: string }) => !entry.name.startsWith('.') && entry.name !== 'node_modules')
          .sort((a: { type?: string; name: string }, b: { type?: string; name: string }) => {
            const aIsDir = a.type === 'directory'
            const bIsDir = b.type === 'directory'
            if (aIsDir && !bIsDir) return -1
            if (!aIsDir && bIsDir) return 1
            return a.name.localeCompare(b.name)
          })
          .slice(0, 200)
          .map((entry: { name: string; type?: string }) => ({
            name: entry.name,
            path: `${dirPath}/${entry.name}`,
            isDirectory: entry.type === 'directory',
          }))
        setDirectoryEntries(next)
      })
      .catch((error) => {
        if (canceled) return
        console.error('Failed to load directory entries:', error)
        setDirectoryEntries([])
      })
      .finally(() => {
        if (canceled) return
        setIsLoadingGrid(false)
      })

    return () => {
      canceled = true
    }
  }, [selectedDirectoryPath])

  const handleBrowseFolder = useCallback(async () => {
    setNavigatedDirectoryPath(null)

    if (onBrowseFolder) {
      await onBrowseFolder()
      return
    }

    try {
      const result = await window.electronAPI.dialog.selectDirectory()
      if (result && result.path) {
        onUpdate({ repoUrl: result.path, provider: 'local', branch: 'main' })
      }
    } catch (error) {
      console.error('Failed to select directory:', error)
    }
  }, [onBrowseFolder, onUpdate])

  const selectedDirectoryLabel = useMemo(() => {
    if (!selectedDirectoryPath) return 'Files'
    return selectedDirectoryPath.split(/[/\\]/).pop() ?? 'Files'
  }, [selectedDirectoryPath])

  const gridEntries = useMemo(() => {
    if (!folderPath || !selectedDirectoryPath) return directoryEntries
    if (selectedDirectoryPath === folderPath) return directoryEntries

    const normalizedDir = selectedDirectoryPath.replace(/[/\\]+$/, '')
    const lastSlash = Math.max(normalizedDir.lastIndexOf('/'), normalizedDir.lastIndexOf('\\'))
    const parent = lastSlash > 0 ? normalizedDir.slice(0, lastSlash) : folderPath
    const clampedParent =
      parent.startsWith(folderPath) && parent.length >= folderPath.length ? parent : folderPath

    return [
      { name: '..', path: clampedParent, isDirectory: true, kind: 'up' as const },
      ...directoryEntries,
    ]
  }, [directoryEntries, folderPath, selectedDirectoryPath])

  const availableRemoteProviders = useMemo(
    () =>
      (['github', 'gitlab'] as const).filter((provider) =>
        connectedProviders.includes(provider)
      ),
    [connectedProviders]
  )

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div
        className={cn(
          entryMode === 'remote' ? 'pl-3 pr-1 flex flex-1 min-h-0 flex-col' : 'px-3 pb-3 space-y-4'
        )}
      >
        {entryMode === 'remote' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {availableRemoteProviders.length > 0 && organizationId ? (
              <ConnectedRepositoryPicker
                provider={availableRemoteProviders[0]}
                providers={availableRemoteProviders}
                organizationId={organizationId}
                integrationConnected
                selectedRepoUrl={repoSource?.repoUrl}
                selectedBranch={repoSource?.branch}
                repositorySearchValue={remoteRepositorySearchValue}
                refreshNonce={remoteRepositoryRefreshNonce}
                onRemoteRepositoriesLoadingChange={onRemoteRepositoriesLoadingChange}
                onRepositorySelected={(repository) => {
                  onUpdate({
                    provider: repository.provider,
                    repoUrl: repository.url,
                    branch: repository.defaultBranch || repoSource?.branch || 'main',
                    ownerLogin: repository.ownerLogin,
                    ownerAvatarUrl: repository.ownerAvatarUrl,
                    lastActivityAt: repository.lastActivityAt,
                    sizeBytes: repository.sizeBytes,
                    starsCount: repository.starsCount,
                  })
                }}
                onRepositoryBranchSelected={(repository, branch) => {
                  onUpdate({
                    provider: repository.provider,
                    repoUrl: repository.url,
                    branch,
                    ownerLogin: repository.ownerLogin,
                    ownerAvatarUrl: repository.ownerAvatarUrl,
                    lastActivityAt: repository.lastActivityAt,
                    sizeBytes: repository.sizeBytes,
                    starsCount: repository.starsCount,
                  })
                }}
              />
            ) : null}

            {availableRemoteProviders.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Connect GitHub or GitLab in Source Control to open a remote repository from the app.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2 rounded-xl border border-border/60 bg-secondary/30 p-4">
            <p className="text-sm font-medium">Open from local folder</p>
            <p className="text-xs text-muted-foreground">
              Use the same checkout already on this machine. Cozea will attach to it instead of cloning a separate workspace.
            </p>
          </div>
        )}
      </div>

      {entryMode === 'local' ? (
        <div className="relative flex-1 min-h-0">
          {!hasLocalFolderSelected ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <button
              type="button"
              onClick={handleBrowseFolder}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Choose a folder
            </button>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col min-h-0 rounded-lg bg-transparent">
            <div className="px-3 pt-2 pb-1">
              <p className="text-sm font-medium text-muted-foreground truncate pr-3">
                {selectedDirectoryLabel || selectedFolderName || 'Selected folder'}
              </p>
            </div>
            <div className="app-scrollbar flex-1 min-h-0 overflow-y-auto px-2 pb-2">
              {isLoadingGrid ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : gridEntries.length > 0 ? (
                <div
                  className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-x-10 gap-y-7 px-3 py-4 animate-in fade-in slide-in-from-bottom-2 duration-200"
                >
                  {gridEntries.map((entry) => (
                    <FileGridItem
                      key={`${entry.kind ?? 'entry'}:${entry.path}`}
                      entry={entry}
                      onOpenDirectory={(path) => {
                        if (!entry.isDirectory) return
                        setNavigatedDirectoryPath(path)
                      }}
                    />
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No files
                </div>
              )}
            </div>
          </div>
          )}
        </div>
      ) : null}

    </div>
  )
}

function FileGridItem({
  entry,
  onOpenDirectory,
}: {
  entry: DirectoryEntry
  onOpenDirectory: (path: string) => void
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [thumbnailOk, setThumbnailOk] = useState(true)
  const [thumbnailDataUrl, setThumbnailDataUrl] = useState<string | null>(null)
  const [thumbnailRequested, setThumbnailRequested] = useState(false)
  const [isInView, setIsInView] = useState(false)
  const isImage = useMemo(() => {
    const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
    return !!ext && IMAGE_EXTENSIONS.has(ext)
  }, [entry.name])

  const wantsThumbnail = useMemo(() => {
    if (!isImage) return false
    const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
    return THUMBNAIL_EXTENSIONS.has(ext)
  }, [entry.name, isImage])

  useEffect(() => {
    const element = buttonRef.current
    if (!element) return

    const observer = new IntersectionObserver(
      (entries) => {
        setIsInView(entries.some((entry) => entry.isIntersecting))
      },
      { root: null, threshold: 0.05 }
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!wantsThumbnail || !thumbnailOk) return
    if (!isInView) return
    if (thumbnailRequested) return
    if (entry.isDirectory || entry.kind === 'up') return

    setTimeout(() => setThumbnailRequested(true), 0)

    const projectPath = getParentDirectoryPath(entry.path)
    void window.electronAPI.project.readFileBase64({
      projectPath,
      filePath: entry.name,
    })
      .then((result) => {
        if (!result?.success || !result.base64) {
          setThumbnailOk(false)
          return
        }
        const mime = getImageMimeType(entry.name)
        setThumbnailDataUrl(`data:${mime};base64,${result.base64}`)
      })
      .catch(() => setThumbnailOk(false))
  }, [entry.isDirectory, entry.kind, entry.name, entry.path, isInView, thumbnailOk, thumbnailRequested, wantsThumbnail])

  return (
    <button
      ref={buttonRef}
      type="button"
      className={cn(
        "min-w-0 rounded-2xl px-3 py-2",
        "bg-transparent hover:bg-black/5 dark:hover:bg-white/10 transition-colors",
        "flex flex-col items-center gap-2"
      )}
      onClick={() => {
        if (entry.isDirectory) onOpenDirectory(entry.path)
      }}
    >
      <div
        className={cn(
          "w-[92px] h-[92px] rounded-3xl overflow-hidden",
          "bg-transparent flex items-center justify-center"
        )}
      >
        {thumbnailDataUrl ? (
          <img
            src={thumbnailDataUrl}
            alt={entry.name}
            className="h-full w-full object-cover"
            loading="lazy"
            draggable={false}
            onError={() => setThumbnailOk(false)}
          />
        ) : entry.kind === 'up' ? (
          <div
            className={cn(
              "h-12 w-12 rounded-full",
              "bg-black/5 dark:bg-white/10",
              "flex items-center justify-center"
            )}
            aria-hidden="true"
          >
            <div className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-foreground/70" />
              <span className="h-1.5 w-1.5 rounded-full bg-foreground/70" />
              <span className="h-1.5 w-1.5 rounded-full bg-foreground/70" />
            </div>
          </div>
        ) : (
          <div className="scale-[1.35]">
            {entry.isDirectory ? (
              <LocalFolderIcon className="scale-[0.72] opacity-95" />
            ) : (
              <div className="relative">
                <LocalDocumentIcon className="scale-[0.74] opacity-95" />
                <div
                  className={cn(
                    "absolute -right-1.5 -bottom-1.5 opacity-90"
                  )}
                >
                  {getFileIcon(entry.name, { width: 14, height: 14 })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="w-full px-1">
        <p className="text-center text-xs leading-snug text-foreground/90 line-clamp-2">
          {entry.kind === 'up' ? 'Back' : entry.name}
        </p>
      </div>
    </button>
  )
}
