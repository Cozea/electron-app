import { LEGACY_DESKTOP_DOMAINS } from '@shared/desktopPersistenceTypes'
let pending: Promise<void> | null = null
let completed = false
/** Migration is a separate one-time barrier; ordinary peeks never read storage. */
export function migrateLegacyDesktopState(): Promise<void> {
  if (completed) return Promise.resolve()
  if (pending) return pending
  if (typeof window === 'undefined' || !window.electronAPI?.desktopPersistence) return Promise.resolve()
  const api = window.electronAPI.desktopPersistence
  const attempt = (async () => {
    for (const domain of LEGACY_DESKTOP_DOMAINS) {
      const rawPayload = window.localStorage.getItem(domain)
      if (rawPayload?.trim()) await api.migrateLegacy({ domain, rawPayload })
    }
    completed = true
  })()
  pending = attempt
  void attempt.then(() => { if (pending === attempt) pending = null }, () => { if (pending === attempt) pending = null })
  return attempt
}
