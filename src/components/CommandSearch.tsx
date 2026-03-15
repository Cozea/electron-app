/**
 * Command Search Component
 *
 * Global search accessible via Cmd+K that allows quick navigation
 * and searching across the app.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useViewTransitionNavigate } from '@/lib/navigation'
import {
  CornerDownLeft,
  Search,
  FolderOpen,
  Terminal,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import {
  canAccessWorkspaceSurface,
  getSettingsSurfaceDisplayLabel,
  getSettingsSurfaceRoute,
  listSettingsSurfaces,
} from '@/lib/settings/settingsRegistry'
import { useSettingsDrawerStore } from '@/stores/useSettingsDrawerStore'
import { useScopedAppContext } from '@/hooks/useScopedAppContext'

interface CommandSearchProps {
  className?: string
}

interface NavigationItem {
  href: string
  label: string
  icon: LucideIcon
  keywords: string[]
  openInDrawer?: boolean
}

const baseNavigationItems: NavigationItem[] = [
  {
    href: '/projects',
    label: 'Projects',
    icon: FolderOpen,
    keywords: ['projects', 'apps', 'code', 'home', 'main'],
    openInDrawer: false,
  },
]

const actionItems = [
  { id: 'new-project', label: 'Create New Project', icon: FolderOpen, keywords: ['new', 'create', 'project'] },
  { id: 'connect-integration', label: 'Add CLI Tool', icon: Terminal, keywords: ['connect', 'cli', 'tool', 'add'] },
]

export function CommandSearch({ className }: CommandSearchProps) {
  const [open, setOpen] = useState(false)
  const navigate = useViewTransitionNavigate()
  const location = useLocation()
  const {
    workspaceScoped,
    surfaceAccess,
  } = useScopedAppContext()
  const openSettingsDrawer = useSettingsDrawerStore((state) => state.openFromRoute)

  const navigationItems = useMemo(() => {
    const personalSettingsItems = listSettingsSurfaces({
      scopeKind: 'personal',
      placement: 'command',
    }).map((surface) => ({
      href: surface.routes.personal!,
      label: getSettingsSurfaceDisplayLabel(surface, 'personal', {
        includeScopePrefix: workspaceScoped && Boolean(surface.routes.workspace),
      }),
      icon: surface.icon,
      keywords: surface.commandKeywords,
      openInDrawer: surface.placements.includes('drawer'),
    }) satisfies NavigationItem)

    const workspaceSettingsItems = workspaceScoped
      ? listSettingsSurfaces({
          scopeKind: 'workspace',
          placement: 'command',
        })
          .filter((surface) =>
            canAccessWorkspaceSurface(surface, surfaceAccess)
          )
          .map((surface) => ({
            href: surface.routes.workspace!,
            label: getSettingsSurfaceDisplayLabel(surface, 'workspace', {
              includeScopePrefix: Boolean(surface.routes.personal),
            }),
            icon: surface.icon,
            keywords: surface.commandKeywords,
            openInDrawer: false,
          }) satisfies NavigationItem)
      : []

    return [
      baseNavigationItems[0],
      ...workspaceSettingsItems,
      ...personalSettingsItems,
    ]
  }, [
    surfaceAccess,
    workspaceScoped,
  ])

  const runCommand = useCallback((command: () => unknown) => {
    setOpen(false)
    command()
  }, [])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || e.key === '/') {
        if (
          (e.target instanceof HTMLElement && e.target.isContentEditable) ||
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          e.target instanceof HTMLSelectElement
        ) {
          return
        }
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }

    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  const handleNavigate = (href: string) => {
    if (href.startsWith('/settings/')) {
      openSettingsDrawer(href)
      return
    }

    if (location.pathname !== href) {
      navigate(href)
    }
  }

  const handleAction = (actionId: string) => {
    switch (actionId) {
      case 'new-project':
        navigate('/projects/new')
        break
      case 'connect-integration':
        handleNavigate(
          (workspaceScoped
            ? getSettingsSurfaceRoute('cliTools', 'workspace')
            : getSettingsSurfaceRoute('cliTools', 'personal')) ?? '/settings/cli-tools'
        )
        break
    }
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={() => setOpen(true)}
            variant="ghost"
            size="icon"
            className={cn('h-7 w-7 text-muted-foreground hover:text-foreground', className)}
          >
            <Search className="h-4 w-4" />
            <span className="sr-only">Search (⌘K)</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Search (Cmd/Ctrl+K)</TooltipContent>
      </Tooltip>

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent
          className="gap-0 overflow-hidden p-0 pb-10 sm:max-w-lg"
          showCloseButton={false}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>Search</DialogTitle>
            <DialogDescription>Search for pages and actions.</DialogDescription>
          </DialogHeader>
          <Command>
            <CommandInput placeholder="Type to search..." />
            <CommandList className="max-h-[400px]">
              <CommandEmpty>No results found.</CommandEmpty>

              <CommandGroup heading="Navigation">
                {navigationItems.map((item) => {
                  const Icon = item.icon
                  const isActive = location.pathname === item.href
                  return (
                    <CommandItem
                      key={item.href}
                      keywords={item.keywords}
                      onSelect={() =>
                        runCommand(() =>
                          item.openInDrawer ? openSettingsDrawer(item.href) : handleNavigate(item.href)
                        )
                      }
                      className={cn(isActive && 'bg-accent')}
                    >
                      <Icon className="mr-2 h-4 w-4" />
                      {item.label}
                      {isActive && (
                        <span className="ml-auto text-xs text-muted-foreground">Current</span>
                      )}
                    </CommandItem>
                  )
                })}
              </CommandGroup>

              <CommandGroup heading="Actions">
                {actionItems.map((item) => {
                  const Icon = item.icon
                  return (
                    <CommandItem
                      key={item.id}
                      keywords={item.keywords}
                      onSelect={() => runCommand(() => handleAction(item.id))}
                    >
                      <Icon className="mr-2 h-4 w-4" />
                      {item.label}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>

          <div className="absolute inset-x-0 bottom-0 flex h-10 items-center gap-2 border-t bg-background px-4 text-xs text-muted-foreground">
            <Kbd>
              <CornerDownLeft className="h-3 w-3" />
            </Kbd>
            <span>Select</span>
            <Kbd className="ml-2">Esc</Kbd>
            <span>Close</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
