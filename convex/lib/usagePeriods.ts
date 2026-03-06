const DAY_MS = 24 * 60 * 60 * 1000

export function getUtcDayStartTimestamp(value: number): number {
  const date = new Date(value)
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  )
}

export function getUtcMonthStartTimestamp(value: number): number {
  const date = new Date(value)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
}

export function getTrailingUtcDayRange(
  days: number,
  now: number = Date.now()
): {
  startDate: number
  endDate: number
} {
  const normalizedDays = Math.max(1, Math.floor(days))
  const currentDayStart = getUtcDayStartTimestamp(now)

  return {
    startDate: currentDayStart - (normalizedDays - 1) * DAY_MS,
    endDate: currentDayStart + DAY_MS - 1,
  }
}
