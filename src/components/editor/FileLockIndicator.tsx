import { useFileLock, type TrafficLight } from '@/hooks/useFileLock'
import type { Id } from '../../../convex/_generated/dataModel'
import { cn } from '@/lib/utils'

interface FileLockIndicatorProps {
  projectId: Id<'projects'>
  filePath: string
  userId: Id<'users'>
  className?: string
  showLabel?: boolean
}

/**
 * Traffic light colors for the indicator.
 */
const TRAFFIC_LIGHT_COLORS: Record<TrafficLight, string> = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
}

/**
 * Traffic light labels.
 */
const TRAFFIC_LIGHT_LABELS: Record<TrafficLight, string> = {
  green: 'Available',
  yellow: 'Being edited',
  red: 'Agent working',
}

/**
 * FileLockIndicator - Shows the traffic light status for a file.
 *
 * - 🟢 Green: File is free for editing
 * - 🟡 Yellow: A human is editing
 * - 🔴 Red: An AI agent is working on the file
 */
export function FileLockIndicator({
  projectId,
  filePath,
  userId,
  className,
  showLabel = false,
}: FileLockIndicatorProps) {
  const { trafficLight, lockedByName, taskDescription, isAgentLocked } = useFileLock(
    projectId,
    filePath,
    userId
  )

  const tooltipText = isAgentLocked
    ? `🤖 ${lockedByName ?? 'Agent'}${taskDescription ? `: ${taskDescription}` : ''}`
    : lockedByName
      ? `${lockedByName} is editing`
      : TRAFFIC_LIGHT_LABELS[trafficLight]

  return (
    <div
      className={cn('flex items-center gap-1.5', className)}
      title={tooltipText}
    >
      <div
        className={cn(
          'w-2 h-2 rounded-full',
          TRAFFIC_LIGHT_COLORS[trafficLight]
        )}
      />
      {showLabel && (
        <span className="text-xs text-muted-foreground">
          {TRAFFIC_LIGHT_LABELS[trafficLight]}
        </span>
      )}
    </div>
  )
}

/**
 * AgentWorkingBanner - Shows a banner when an agent is modifying the file.
 *
 * Display this at the top of the editor to warn users that
 * the file is being modified by an AI agent.
 */
export function AgentWorkingBanner({
  projectId,
  filePath,
  userId,
}: {
  projectId: Id<'projects'>
  filePath: string
  userId: Id<'users'>
}) {
  const { isAgentLocked, lockedByName, taskDescription } = useFileLock(
    projectId,
    filePath,
    userId
  )

  if (!isAgentLocked) return null

  return (
    <div className="bg-yellow-100 dark:bg-yellow-900/30 border-b border-yellow-200 dark:border-yellow-800 px-3 py-2 text-sm flex items-center gap-2">
      <span className="text-lg">🤖</span>
      <span className="text-yellow-800 dark:text-yellow-200">
        <strong>{lockedByName ?? 'AI Agent'}</strong> is modifying this file
        {taskDescription && (
          <span className="text-yellow-700 dark:text-yellow-300">
            : {taskDescription}
          </span>
        )}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <span className="text-xs text-yellow-700 dark:text-yellow-300">
          Working...
        </span>
      </div>
    </div>
  )
}

/**
 * TrafficLightIcon - A simple traffic light icon component.
 */
export function TrafficLightIcon({
  light,
  size = 'sm',
}: {
  light: TrafficLight
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizeClasses = {
    sm: 'w-2 h-2',
    md: 'w-3 h-3',
    lg: 'w-4 h-4',
  }

  return (
    <div
      className={cn(
        'rounded-full',
        sizeClasses[size],
        TRAFFIC_LIGHT_COLORS[light]
      )}
    />
  )
}
