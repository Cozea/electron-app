import { useState, useEffect } from 'react'
import { useYjsProject } from '@/contexts/YjsProjectContext'
import { cn } from '@/lib/utils'
import { WifiOff, Cloud, CloudOff, Loader2 } from 'lucide-react'

interface ConnectionStatusProps {
  className?: string
  showLabel?: boolean
}

/**
 * ConnectionStatus - Shows the current sync status for the collaborative editor.
 *
 * Displays:
 * - Online/offline indicator
 * - Sync status animation
 */
export function ConnectionStatus({
  className,
  showLabel = true,
}: ConnectionStatusProps) {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const [isSyncing, setIsSyncing] = useState(false)
  const { isConnected } = useYjsProject()

  // Track online/offline status
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      // Show syncing animation briefly when coming back online
      setIsSyncing(true)
      setTimeout(() => setIsSyncing(false), 2000)
    }
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // Determine status
  const status = !isOnline
    ? 'offline'
    : !isConnected
      ? 'disconnected'
      : isSyncing
        ? 'syncing'
        : 'connected'

  const statusConfig = {
    offline: {
      icon: WifiOff,
      label: 'Offline',
      color: 'text-red-500',
      bgColor: 'bg-red-500/10',
      description: 'Changes saved locally, will sync when online',
    },
    disconnected: {
      icon: CloudOff,
      label: 'Disconnected',
      color: 'text-yellow-500',
      bgColor: 'bg-yellow-500/10',
      description: 'Reconnecting to server...',
    },
    syncing: {
      icon: Loader2,
      label: 'Syncing',
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
      description: 'Syncing changes...',
    },
    connected: {
      icon: Cloud,
      label: 'Connected',
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
      description: 'All changes synced',
    },
  }

  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 rounded-md transition-colors',
        config.bgColor,
        className
      )}
      title={config.description}
    >
      <Icon
        className={cn(
          'w-3.5 h-3.5',
          config.color,
          status === 'syncing' && 'animate-spin'
        )}
      />
      {showLabel && (
        <span className={cn('text-xs font-medium', config.color)}>
          {config.label}
        </span>
      )}
    </div>
  )
}

/**
 * OfflineBanner - Shows a prominent banner when offline.
 *
 * Use this at the top of the editor to make it clear that
 * the user is working offline and changes will sync later.
 */
export function OfflineBanner() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  if (isOnline) return null

  return (
    <div className="bg-yellow-100 dark:bg-yellow-900/30 border-b border-yellow-200 dark:border-yellow-800 px-4 py-2 flex items-center gap-3">
      <WifiOff className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
      <div className="flex-1">
        <span className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
          You're offline
        </span>
        <span className="text-sm text-yellow-700 dark:text-yellow-300 ml-2">
          Changes are saved locally and will sync when you're back online.
        </span>
      </div>
    </div>
  )
}

/**
 * SyncIndicator - A minimal sync indicator for tight spaces.
 *
 * Shows just a colored dot indicating connection status.
 */
export function SyncIndicator({ className }: { className?: string }) {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )
  const { isConnected } = useYjsProject()

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const color = !isOnline
    ? 'bg-red-500'
    : !isConnected
      ? 'bg-yellow-500'
      : 'bg-green-500'

  const tooltip = !isOnline
    ? 'Offline - changes saved locally'
    : !isConnected
      ? 'Reconnecting...'
      : 'Connected'

  return (
    <div
      className={cn('w-2 h-2 rounded-full', color, className)}
      title={tooltip}
    />
  )
}
