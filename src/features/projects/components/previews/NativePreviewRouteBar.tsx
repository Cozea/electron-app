import { memo, useMemo } from 'react'
import { ChevronDown, RefreshCw, Smartphone } from 'lucide-react'
import { FaApple, FaAndroid } from 'react-icons/fa6'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { NativePreviewDeviceDescriptor } from '@shared/electronApiTypes'

export type NativePreviewTarget = 'ios' | 'android'

interface NativePreviewRouteBarProps {
  devices: NativePreviewDeviceDescriptor[]
  devicesLoading: boolean
  target: NativePreviewTarget
  selectedDeviceId?: string | null
  onSelectDevice: (device: NativePreviewDeviceDescriptor) => void
  onRefreshDevices: () => void
  onSelectTarget: (target: NativePreviewTarget) => void
}

function getTargetLabel(target: NativePreviewTarget): React.ReactNode {
  switch (target) {
    case 'ios':
      return <FaApple className="h-3.5 w-3.5 ml-1" />
    case 'android':
      return <FaAndroid className="h-3.5 w-3.5 ml-1" />
    default:
      return null
  }
}

function getTargetSummary(
  target: NativePreviewTarget,
  devices: NativePreviewDeviceDescriptor[],
  selectedDeviceId?: string | null,
): string {
  const relevantDevices = devices.filter((device) => device.platform === target)

  const booted = relevantDevices.filter((device) => device.state === 'booted')
  const selected = selectedDeviceId ? relevantDevices.find((device) => device.id === selectedDeviceId) : null
  const preferred = selected ?? booted[0] ?? relevantDevices[0]
  
  if (preferred) {
    return preferred.name
  }

  return target === 'ios' ? 'No simulator' : 'No emulator'
}

function getTargetIcon(_target: NativePreviewTarget) {
  return <Smartphone className="h-3.5 w-3.5" />
}

export const NativePreviewRouteBar = memo(function NativePreviewRouteBar({
  devices,
  devicesLoading,
  target,
  selectedDeviceId,
  onSelectDevice,
  onRefreshDevices,
  onSelectTarget,
}: NativePreviewRouteBarProps) {
  const widthClassName = 'w-64 max-w-[42vw] min-w-0 max-[980px]:hidden'
  const targetSummary = useMemo(() => getTargetSummary(target, devices, selectedDeviceId), [devices, selectedDeviceId, target])
  const quickDevices = useMemo(() => {
    return devices
      .filter((device) => device.platform === target)
      .sort((a, b) => {
        if (a.id === selectedDeviceId) return -1
        if (b.id === selectedDeviceId) return 1
        if (a.state === 'booted' && b.state !== 'booted') return -1
        if (b.state === 'booted' && a.state !== 'booted') return 1
        return a.name.localeCompare(b.name)
      })
      .slice(0, 8)
  }, [devices, selectedDeviceId, target])

  return (
    <div className={widthClassName}>
      <DropdownMenu>
        <div className="flex h-7 items-center gap-2 rounded-full border border-border/60 bg-secondary/70 px-3 shadow-none">
          <div className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground">
            {getTargetIcon(target)}
          </div>

          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
              aria-label="Choose native preview target"
            >
              <span className="truncate text-sm text-foreground">{targetSummary}</span>
              <span className="shrink-0 text-muted-foreground flex items-center justify-center">{getTargetLabel(target)}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>

          <div className="h-4 w-px bg-border/60" aria-hidden />

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0 rounded-full text-muted-foreground hover:bg-accent/70 hover:text-foreground"
            onClick={onRefreshDevices}
            disabled={devicesLoading}
            aria-label="Refresh native devices"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', devicesLoading && 'animate-spin')} />
          </Button>
        </div>

        <DropdownMenuContent
          align="center"
          side="bottom"
          sideOffset={6}
          className="w-64"
        >
          <DropdownMenuLabel>Preview target</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onSelectTarget('ios')}>
            <FaApple className="h-3.5 w-3.5 mr-2" /> iOS
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSelectTarget('android')}>
            <FaAndroid className="h-3.5 w-3.5 mr-2" /> Android
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel>Devices</DropdownMenuLabel>

          {quickDevices.length === 0 ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">
              No matching devices found.
            </div>
          ) : (
            quickDevices.map((device) => (
              <DropdownMenuItem
                key={device.id}
                onSelect={() => {
                  onSelectTarget(device.platform)
                  onSelectDevice(device)
                }}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate">{device.name}</span>
                  {device.id === selectedDeviceId ? (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-primary">Selected</span>
                  ) : null}
                  <span className="shrink-0 text-xs text-muted-foreground capitalize">{device.state}</span>
                </div>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
})
