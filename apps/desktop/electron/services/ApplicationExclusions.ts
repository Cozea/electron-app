/**
 * Application exclusions for Computer Use.
 * Password managers and credential vaults are strictly excluded from observation and interaction.
 */

export const EXCLUDED_BUNDLE_IDS: ReadonlySet<string> = new Set([
  'com.1password.1password',
  'com.1password.safari',
  'com.bitwarden.desktop',
  'com.dashlane.dashlanephonefinal',
  'com.dashlane.dashlane',
  'com.dashlane.mac.dashlane',
  'com.lastpass.lastpass',
  'com.lastpass.lastpassmacdesktop',
  'com.nordsec.nordpass',
  'me.proton.pass.electron',
  'me.proton.pass.catalyst',
  'com.apple.passwords',
])

export const EXCLUDED_APP_NAMES: ReadonlySet<string> = new Set([
  '1password',
  'bitwarden',
  'dashlane',
  'lastpass',
  'nordpass',
  'proton pass',
  'passwords',
  'keepassxc',
])

export const EXCLUDED_BUNDLE_PREFIXES: readonly string[] = [
  'com.1password.',
  'com.bitwarden.',
  'com.dashlane.',
  'com.lastpass.',
  'com.nordsec.',
  'me.proton.pass.',
  'org.keepassxc.',
  'com.apple.passwords',
]

export const EXCLUDED_APP_ERROR = 'Password managers are excluded from Computer Use.'

export function isApplicationExcluded(identifier?: string | null): boolean {
  if (!identifier) return false
  const normalized = identifier.trim().toLowerCase()
  if (EXCLUDED_BUNDLE_IDS.has(normalized) || EXCLUDED_APP_NAMES.has(normalized)) return true
  for (const prefix of EXCLUDED_BUNDLE_PREFIXES) {
    if (normalized.startsWith(prefix) || normalized === prefix.replace(/\.$/, '')) return true
  }
  for (const name of EXCLUDED_APP_NAMES) {
    if (normalized === name || normalized.startsWith(`${name} `) || normalized.startsWith(`${name}-`)) return true
  }
  return false
}

export interface AppCandidate {
  pid: number
  name: string
  bundleId?: string
  bundle_id?: string
  running?: boolean
}

export function filterVisibleApplications<T extends AppCandidate>(apps: T[]): T[] {
  return apps.filter((app) => {
    const bundle = app.bundleId ?? app.bundle_id
    if (bundle && isApplicationExcluded(bundle)) return false
    if (app.name && isApplicationExcluded(app.name)) return false
    return true
  })
}

export function resolveApplication<T extends AppCandidate>(
  query: string,
  candidates: T[],
): { app: T } | { error: string } {
  const normalized = query.trim().toLowerCase()
  if (isApplicationExcluded(normalized)) {
    return { error: EXCLUDED_APP_ERROR }
  }

  // 1. Direct PID match
  const numericPid = /^\d+$/.test(normalized) ? parseInt(normalized, 10) : null
  if (numericPid !== null) {
    const byPid = candidates.filter((c) => c.pid === numericPid)
    if (byPid.length === 1) {
      const target = byPid[0]!
      const bundle = target.bundleId ?? target.bundle_id
      if (isApplicationExcluded(bundle) || isApplicationExcluded(target.name)) {
        return { error: EXCLUDED_APP_ERROR }
      }
      return { app: target }
    }
  }

  // 2. Exact or normalized bundle ID match
  const byBundle = candidates.filter((c) => {
    const b = (c.bundleId ?? c.bundle_id ?? '').toLowerCase()
    return b === normalized
  })
  if (byBundle.length === 1) {
    const target = byBundle[0]!
    if (isApplicationExcluded(target.bundleId ?? target.bundle_id) || isApplicationExcluded(target.name)) {
      return { error: EXCLUDED_APP_ERROR }
    }
    return { app: target }
  }

  // 3. Name match (case-insensitive)
  const byName = candidates.filter((c) => c.name.toLowerCase() === normalized)
  if (byName.length === 1) {
    const target = byName[0]!
    const bundle = target.bundleId ?? target.bundle_id
    if (isApplicationExcluded(bundle) || isApplicationExcluded(target.name)) {
      return { error: EXCLUDED_APP_ERROR }
    }
    return { app: target }
  }

  if (byName.length > 1 || byBundle.length > 1) {
    return { error: 'Multiple applications match. Use a PID from list_apps.' }
  }

  return { error: 'The target application is not running. Open it, then call get_app_state.' }
}
