import { useEffect, useMemo, useState } from 'react'
import { ArrowDownToLine, Download, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Progress } from '@/components/ui/progress'
import { useAutoUpdater } from '@/hooks/useAutoUpdater'
import { useAutoUpdateStore } from '@/stores/useAutoUpdateStore'
import { cn } from '@/lib/utils'

interface UpdateMenuProps {
  dropdownAlign?: 'start' | 'center' | 'end'
  dropdownSide?: 'top' | 'right' | 'bottom' | 'left'
  buttonClassName?: string
  disableAutoUpdaterHook?: boolean
}

export function UpdateMenu({
  dropdownAlign = 'end',
  dropdownSide = 'bottom',
  buttonClassName,
  disableAutoUpdaterHook = false,
}: UpdateMenuProps) {
  if (!disableAutoUpdaterHook) {
    useAutoUpdater()
  }

  const status = useAutoUpdateStore((s) => s.status)
  const version = useAutoUpdateStore((s) => s.version)
  const progress = useAutoUpdateStore((s) => s.progress)
  const installMode = useAutoUpdateStore((s) => s.installMode)
  const setInstallMode = useAutoUpdateStore((s) => s.setInstallMode)

  const [promptOpen, setPromptOpen] = useState(false)

  const showButton = status === 'available' || status === 'downloading' || status === 'downloaded'
  const percent = progress?.percent ? Math.round(progress.percent) : 0

  const title = useMemo(() => {
    if (version) return `Update ${version} available`
    return 'Update available'
  }, [version])

  useEffect(() => {
    if (status === 'downloaded' && installMode === 'later') {
      setPromptOpen(true)
    }
  }, [installMode, status])

  if (!showButton) return null

  const handleDownload = async (mode: 'now' | 'later') => {
    if (!window.electronAPI?.updates) return
    setInstallMode(mode)

    if (status === 'downloaded') {
      if (mode === 'now') {
        void window.electronAPI.updates.install()
      } else {
        setPromptOpen(true)
      }
      return
    }

    await window.electronAPI.updates.download()
  }

  const handleRestart = () => {
    if (!window.electronAPI?.updates) return
    void window.electronAPI.updates.install()
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'relative h-7 w-7 text-muted-foreground hover:text-foreground',
              buttonClassName
            )}
          >
            <ArrowDownToLine className="h-4 w-4" />
            {status === 'available' && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-500" />
            )}
            <span className="sr-only">Update available</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={dropdownAlign} side={dropdownSide} sideOffset={8} className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            {title}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />

          {status === 'available' && (
            <>
              <DropdownMenuItem onClick={() => handleDownload('now')}>
                <Download className="mr-2 h-4 w-4" />
                Download & install now
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDownload('later')}>
                <ArrowDownToLine className="mr-2 h-4 w-4" />
                Download, install later
              </DropdownMenuItem>
            </>
          )}

          {status === 'downloading' && (
            <div className="px-3 py-2 space-y-2">
              <div className="text-xs text-muted-foreground">Downloading update… {percent}%</div>
              <Progress value={percent} />
            </div>
          )}

          {status === 'downloaded' && (
            <DropdownMenuItem onClick={handleRestart}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Restart to update
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={promptOpen} onOpenChange={setPromptOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update ready to install</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Later</AlertDialogCancel>
            <AlertDialogAction onClick={handleRestart}>
              Restart now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
