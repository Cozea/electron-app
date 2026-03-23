import { memo, useMemo } from 'react'
import { ChevronDown, RefreshCw, Smartphone, TabletSmartphone } from 'lucide-react'

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

export type NativePreviewTarget = 'ios' | 'android' | 'both'

interface NativePreviewRouteBarProps {
  devices: NativePreviewDeviceDescriptor[]
  devicesLoading: boolean
  target: NativePreviewTarget
  onOpenDevice: (device: NativePreviewDeviceDescriptor) => void
  onRefreshDevices: () => void
  onSelectTarget: (target: NativePreviewTarget) => void
}

function getTargetLabel(target: NativePreviewTarget): string {
  switch (target) {
    case 'ios':
      return 'iOS'
    case 'android':
      return 'Android'
    case 'both':
    default:
      return 'Both'
  }
}

function getTargetSummary(target: NativePreviewTarget, devices: NativePreviewDeviceDescriptor[]): string {
  const relevantDevices = target === 'both'
    ? devices
    : devices.filter((device) => device.platform === target)

  const booted = relevantDevices.filter((device) => device.state === 'booted')
  if (target === 'both') {
    if (booted.length > 0) {
      return booted.map((device) => device.name).join(' · ')
    }
    return `${relevantDevices.length} available`
  }

  const preferred = booted[0] ?? relevantDevices[0]
  if (preferred) {
    return preferred.name
  }

  return target === 'ios' ? 'No simulator' : 'No emulator'
}

function getTargetIcon(target: NativePreviewTarget) {
  if (target === 'both') return <TabletSmartphone className="h-3.5 w-3.5" />
  return <Smartphone className="h-3.5 w-3.5" />
}

export const NativePreviewRouteBar = memo(function NativePreviewRouteBar({
  devices,
  devicesLoading,
  target,
  onOpenDevice,
  onRefreshDevices,
  onSelectTarget,
}: NativePreviewRouteBarProps) {
  const widthClassName = 'w-[28rem] max-w-[42vw] min-w-0 max-xl:w-[22rem] max-lg:w-[18rem] max-[980px]:hidden'
  const targetSummary = useMemo(() => getTargetSummary(target, devices), [devices, target])
  const quickDevices = useMemo(() => {
    if (target === 'both') {
      return devices.slice(0, 8)
    }
    return devices.filter((device) => device.platform === target).slice(0, 8)
  }, [devices, target])

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
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              aria-label="Choose native preview target"
            >
              <span className="truncate text-sm text-foreground">{targetSummary}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{getTargetLabel(target)}</span>
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
          className="w-[28rem] max-w-[42vw] max-xl:w-[22rem] max-lg:w-[18rem] max-[980px]:hidden"
        >
          <DropdownMenuLabel>Preview target</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onSelectTarget('ios')}>iOS</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSelectTarget('android')}>Android</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSelectTarget('both')}>Both</DropdownMenuItem>

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
                  onOpenDevice(device)
                }}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate">{device.name}</span>
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
