export type SourceControlProviderPreference = 'github' | 'gitlab'

const SOURCE_CONTROL_PROVIDER_PREFERENCES_KEY = 'cozea.sourceControlProviderPreferences'

function normalizePreferences(
  value: unknown
): SourceControlProviderPreference[] {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(
    new Set(
      value.filter(
        (entry): entry is SourceControlProviderPreference =>
          entry === 'github' || entry === 'gitlab'
      )
    )
  )
}

export function readSourceControlProviderPreferences(): SourceControlProviderPreference[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem(SOURCE_CONTROL_PROVIDER_PREFERENCES_KEY)
    if (!raw) {
      return []
    }

    return normalizePreferences(JSON.parse(raw))
  } catch {
    return []
  }
}

export function writeSourceControlProviderPreferences(
  preferences: SourceControlProviderPreference[]
): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const normalized = normalizePreferences(preferences)
    if (normalized.length === 0) {
      window.localStorage.removeItem(SOURCE_CONTROL_PROVIDER_PREFERENCES_KEY)
      return
    }

    window.localStorage.setItem(
      SOURCE_CONTROL_PROVIDER_PREFERENCES_KEY,
      JSON.stringify(normalized)
    )
  } catch {
    // no-op
  }
}
