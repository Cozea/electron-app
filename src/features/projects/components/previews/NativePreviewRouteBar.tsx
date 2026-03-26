import { memo, useMemo, useCallback } from 'react'
import { CheckCircle2, ChevronRight, Folder, Smartphone } from 'lucide-react'


import type { NativePreviewDeviceDescriptor } from '@shared/electronApiTypes'

export type NativePreviewTarget = 'ios' | 'android'

interface NativePreviewRouteBarProps {
  devices: NativePreviewDeviceDescriptor[]
  target: NativePreviewTarget
  selectedDeviceId?: string | null
  onSelectDevice: (device: NativePreviewDeviceDescriptor) => void
  onSelectTarget: (target: NativePreviewTarget) => void
}

function getTargetIcon(_target: NativePreviewTarget) {
  return <Smartphone className="h-4 w-4" />
}

const cleanDeviceName = (name: string) => name.replace(/\s+OK$/i, '')

export const NativePreviewRouteBar = memo(function NativePreviewRouteBar({
  devices,
  target,
  selectedDeviceId,
  onSelectDevice,
  onSelectTarget,
  projectName
}: NativePreviewRouteBarProps & { projectName?: string }) {
  const widthClassName = 'flex items-center text-sm text-muted-foreground max-[980px]:hidden gap-2'
  const preferredDevice = useMemo(() => {
    const relevantDevices = devices.filter((device) => device.platform === target)
    const booted = relevantDevices.filter((device) => device.state === 'booted')
    const selected = selectedDeviceId ? relevantDevices.find((device) => device.id === selectedDeviceId) : null
    return selected ?? booted[0] ?? relevantDevices[0] ?? null
  }, [devices, selectedDeviceId, target])

  const targetSummary = preferredDevice ? cleanDeviceName(preferredDevice.name) : (target === 'ios' ? 'No simulator' : 'No emulator')
  const isReady = preferredDevice?.state === 'booted'

  const iosDevices = useMemo(() => {
    return devices
      .filter((device) => device.platform === 'ios')
      .sort((a, b) => {
        if (a.id === selectedDeviceId) return -1
        if (b.id === selectedDeviceId) return 1
        if (a.state === 'booted' && b.state !== 'booted') return -1
        if (b.state === 'booted' && a.state !== 'booted') return 1
        return a.name.localeCompare(b.name)
      })
  }, [devices, selectedDeviceId])

  const androidDevices = useMemo(() => {
    return devices
      .filter((device) => device.platform === 'android')
      .sort((a, b) => {
        if (a.id === selectedDeviceId) return -1
        if (b.id === selectedDeviceId) return 1
        if (a.state === 'booted' && b.state !== 'booted') return -1
        if (b.state === 'booted' && a.state !== 'booted') return 1
        return a.name.localeCompare(b.name)
      })
  }, [devices, selectedDeviceId])

  const handleMenuClick = useCallback(async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    
    // Convert to electron native menu format
    const formatDevice = (d: NativePreviewDeviceDescriptor) => ({
      id: d.id,
      name: cleanDeviceName(d.name),
      state: d.state,
      isSelected: d.id === selectedDeviceId
    })

    const result = await window.electronAPI.contextMenu.showNativePreviewMenu({
      x: event.clientX,
      y: event.clientY,
      iosDevices: iosDevices.map(formatDevice),
      androidDevices: androidDevices.map(formatDevice)
    })

    if (result) {
      if (result.action === 'select-device') {
        const device = devices.find(d => d.id === result.deviceId)
        if (device) {
          onSelectTarget(result.platform)
          onSelectDevice(device)
        }
      } else if (result.action === 'select-target') {
        onSelectTarget(result.target)
      }
    }
  }, [iosDevices, androidDevices, selectedDeviceId, devices, onSelectTarget, onSelectDevice])

  return (
    <div className={widthClassName}>
      <div className="flex h-8 items-center gap-2 px-3 shadow-none">
        {projectName && (
          <>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Folder className="h-4 w-4" />
              <span className="truncate max-w-[150px] text-foreground">{projectName}</span>
            </div>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-50" />
          </>
        )}

        <button
          type="button"
          onClick={handleMenuClick}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Choose native preview target"
        >
          {getTargetIcon(target)}
          <span className="truncate text-foreground">{targetSummary}</span>
          {isReady && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 fill-emerald-500 text-background ml-1" />}
        </button>
      </div>
    </div>
  )
})
