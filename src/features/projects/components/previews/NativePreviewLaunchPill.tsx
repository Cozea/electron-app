import { createElement, memo, useMemo } from 'react'
import { ChevronDown, Hammer, Wifi } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export type NativePreviewLauncher = 'dev-build' | 'expo-go' | 'web'

interface NativePreviewLaunchPillProps {
  canOpenExpoGo: boolean
  onOpenExpoGo: () => void
  onOpenDevBuild: () => void
  onOpenWebPreview?: (() => void) | null
  selectedLauncher: NativePreviewLauncher
  supportsWebPreview: boolean
  onSelectedLauncherChange: (launcher: NativePreviewLauncher) => void
}

function ExpoGoIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2.75 19.25 7v10L12 21.25 4.75 17V7L12 2.75Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 9.25 12 7l3.5 2.25v5.5L12 17l-3.5-2.25v-5.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

function getLauncherMeta(launcher: NativePreviewLauncher) {
  switch (launcher) {
    case 'dev-build':
      return {
        label: 'Dev Build',
        icon: Hammer,
      }
    case 'web':
      return {
        label: 'Web',
        icon: Wifi,
      }
    case 'expo-go':
    default:
      return {
        label: 'Expo Go',
        icon: ExpoGoIcon,
      }
  }
}

export const NativePreviewLaunchPill = memo(function NativePreviewLaunchPill({
  canOpenExpoGo,
  onOpenExpoGo,
  onOpenDevBuild,
  onOpenWebPreview,
  selectedLauncher,
  supportsWebPreview,
  onSelectedLauncherChange,
}: NativePreviewLaunchPillProps) {
  const availableLaunchers = useMemo(() => {
    const launchers: NativePreviewLauncher[] = ['dev-build', 'expo-go']
    if (supportsWebPreview && onOpenWebPreview) {
      launchers.push('web')
    }
    return launchers
  }, [onOpenWebPreview, supportsWebPreview])

  const safeSelectedLauncher = availableLaunchers.includes(selectedLauncher)
    ? selectedLauncher
    : availableLaunchers[0]
  const meta = getLauncherMeta(safeSelectedLauncher)
  const isDisabled = safeSelectedLauncher === 'expo-go' ? !canOpenExpoGo : safeSelectedLauncher === 'web' ? !onOpenWebPreview : false

  const handleOpenSelected = () => {
    if (safeSelectedLauncher === 'dev-build') {
      onOpenDevBuild()
      return
    }
    if (safeSelectedLauncher === 'web') {
      onOpenWebPreview?.()
      return
    }
    onOpenExpoGo()
  }

  return (
    <div className="inline-flex h-7 items-center overflow-hidden rounded-full border border-border/60 bg-secondary/70 shadow-none">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 rounded-none border-0 bg-transparent px-2 shadow-none hover:bg-secondary data-[state=open]:bg-secondary"
        onClick={handleOpenSelected}
        disabled={isDisabled}
      >
        {createElement(meta.icon, { className: 'h-3.5 w-3.5 text-muted-foreground' })}
        <span className="text-xs text-muted-foreground">{meta.label}</span>
      </Button>

      {availableLaunchers.length > 1 ? (
        <>
          <div className="h-4 w-px bg-border/60" aria-hidden />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-6 rounded-none border-0 bg-transparent shadow-none hover:bg-secondary data-[state=open]:bg-secondary"
                aria-label="Choose preview launcher"
              >
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Open preview with</div>
              <DropdownMenuRadioGroup
                value={safeSelectedLauncher}
                onValueChange={(value) => onSelectedLauncherChange(value as NativePreviewLauncher)}
              >
                {availableLaunchers.map((launcher) => {
                  const launcherMeta = getLauncherMeta(launcher)
                  return (
                    <DropdownMenuRadioItem key={launcher} value={launcher}>
                      {createElement(launcherMeta.icon, { className: 'mr-2 h-4 w-4 text-muted-foreground' })}
                      {launcherMeta.label}
                    </DropdownMenuRadioItem>
                  )
                })}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
    </div>
  )
})
