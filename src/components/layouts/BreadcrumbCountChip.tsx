import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface BreadcrumbCountChipProps {
  current: number
  limit: number
  currentLabel?: string
  limitLabel?: string
  title?: string
  className?: string
}

export function BreadcrumbCountChip({
  current,
  limit,
  currentLabel,
  limitLabel,
  title,
  className,
}: BreadcrumbCountChipProps) {
  if (limit <= 0) return null

  const percentage = Math.min((current / limit) * 100, 100)
  const circumference = 2 * Math.PI * 8 // radius = 8
  const strokeDashoffset = circumference - (percentage / 100) * circumference
  const progressClassName =
    percentage >= 100
      ? "text-destructive stroke-current"
      : percentage >= 90
        ? "text-amber-500 stroke-current"
        : "text-primary stroke-current"

  return (
    <Badge
      variant="secondary"
      className={cn("flex items-center gap-1.5 text-xs font-normal pl-1.5 pr-2 py-0.5", className)}
      title={title}
    >
      <svg width="16" height="16" viewBox="0 0 20 20" className="transform -rotate-90">
        <circle
          cx="10"
          cy="10"
          r="8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="opacity-20"
        />
        <circle
          cx="10"
          cy="10"
          r="8"
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className={progressClassName}
        />
      </svg>
      <span>{currentLabel ?? current}/{limitLabel ?? limit}</span>
    </Badge>
  )
}
