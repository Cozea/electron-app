import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatRelativeTimeLabel(timestamp: string | number): string {
  const parsed = typeof timestamp === "string" ? Date.parse(timestamp) : timestamp
  if (Number.isNaN(parsed) || parsed <= 0) return ""

  const seconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000))
  if (seconds < 60) return "now"
  
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  
  const days = Math.floor(hours / 24)
  if (days < 365) return `${days}d`
  
  const years = Math.floor(days / 365)
  return `${years}y`
}
