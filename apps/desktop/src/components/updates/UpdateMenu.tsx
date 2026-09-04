import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useAutoUpdater } from '@/app/hooks/useAutoUpdater'
import { useAutoUpdateStore } from '@/app/model/autoUpdateStore'
import { cn } from '@/lib/utils'
import logoLightMode from '@/assets/logos/logo_light_mode.png'
import { useTranslation } from '@/lib/i18n'

import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDownZeroOneIcon as __ArrowDownToLineHugeIcon, ArrowDownZeroOneIcon as __DownloadHugeIcon, Cancel01Icon as __XHugeIcon, Refresh01Icon as __RefreshCwHugeIcon } from '@hugeicons/core-free-icons'

interface UpdateMenuProps {
  disableAutoUpdaterHook?: boolean
}

function parseChangelogItems(releaseNotes?: string): string[] {
  if (!releaseNotes) return []
  return releaseNotes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith('#'))
    .map((line) => line.replace(/^[-*]\s+/, ''))
    .slice(0, 4)
}

export function UpdateMenu({ disableAutoUpdaterHook = false }: UpdateMenuProps) {
  useAutoUpdater({ enabled: !disableAutoUpdaterHook })
  const { t } = useTranslation()

  const status = useAutoUpdateStore((s) => s.status)
  const version = useAutoUpdateStore((s) => s.version)
  const progress = useAutoUpdateStore((s) => s.progress)
  const releaseNotes = useAutoUpdateStore((s) => s.releaseNotes)
  const setInstallMode = useAutoUpdateStore((s) => s.setInstallMode)

  const showButton = status === 'available' || status === 'downloading' || status === 'downloaded'
  const percent = progress?.percent ? Math.round(progress.percent) : 0

  const changelogItems = useMemo(() => parseChangelogItems(releaseNotes), [releaseNotes])
  const effectiveVersion = version ?? 'latest'
  const dismissKey = `${status}:${effectiveVersion}`
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)
  const shouldShow = showButton && dismissedKey !== dismissKey

  if (!shouldShow || typeof document === 'undefined') return null

  const handleDownload = async (mode: 'now' | 'later') => {
    if (!window.electronAPI?.updates) return
    setInstallMode(mode)

    if (status === 'downloaded') {
      if (mode === 'now') {
        void window.electronAPI.updates.install()
      } else {
        setDismissedKey(dismissKey)
      }
      return
    }

    await window.electronAPI.updates.download()
  }

  const handleRestart = () => {
    if (!window.electronAPI?.updates) return
    void window.electronAPI.updates.install()
  }

  return createPortal(
    <div
      className={cn(
        'fixed bottom-4 left-4 z-[var(--cozea-layer-toast)] w-[360px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl',
        'border border-black/10 bg-white text-zinc-900 shadow-[0_18px_45px_rgba(0,0,0,0.2)]',
        'animate-in fade-in slide-in-from-bottom-3 duration-300'
      )}
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        className="absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
        onClick={() => setDismissedKey(dismissKey)}
        aria-label={t('update.dismissLabel')}
      >
        <HugeiconsIcon icon={__XHugeIcon} className="h-4 w-4" />
      </button>

      <div className="h-24 border-b border-zinc-200 bg-gradient-to-b from-zinc-50 to-white">
        <div className="flex h-full items-center justify-center">
          <img src={logoLightMode} alt="Cozea" className="h-11 w-auto object-contain" />
        </div>
      </div>

      <div className="space-y-3 px-4 py-4">
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">{t('update.title')}</div>
          <div className="text-2xl font-semibold leading-tight">{t('update.version')} {effectiveVersion}</div>
        </div>

        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-500">{t('update.changelog')}</div>
          <div className="space-y-1 text-sm text-zinc-700">
            {changelogItems.length > 0 ? (
              changelogItems.map((item, index) => (
                <p key={`${item}-${index}`} className="line-clamp-2 leading-5">
                  {item}
                </p>
              ))
            ) : (
              <p className="leading-5 text-zinc-600">{t('update.defaultChangelog')}</p>
            )}
          </div>
        </div>

        {status === 'downloading' && (
          <div className="space-y-1.5">
            <div className="text-xs text-zinc-500">{t('update.downloading')} {percent}%</div>
            <Progress value={percent} className="h-1.5 bg-zinc-200 [&_[data-slot=progress-indicator]]:bg-zinc-900" />
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          {status === 'available' && (
            <>
              <Button
                size="sm"
                className="h-8 flex-1 bg-zinc-900 text-white hover:bg-zinc-800"
                onClick={() => handleDownload('now')}
              >
                <HugeiconsIcon icon={__DownloadHugeIcon} className="h-3.5 w-3.5" />
                {t('update.downloadRestart')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-8 bg-zinc-100 text-zinc-800 hover:bg-zinc-200"
                onClick={() => handleDownload('later')}
              >
                <HugeiconsIcon icon={__ArrowDownToLineHugeIcon} className="h-3.5 w-3.5" />
                {t('update.downloadOnly')}
              </Button>
            </>
          )}

          {status === 'downloading' && (
            <Button
              size="sm"
              disabled
              className="h-8 flex-1 bg-zinc-900 text-white hover:bg-zinc-900"
            >
              {t('update.downloadingBtn')}
            </Button>
          )}

          {status === 'downloaded' && (
            <>
              <Button
                size="sm"
                className="h-8 flex-1 bg-zinc-900 text-white hover:bg-zinc-800"
                onClick={handleRestart}
              >
                <HugeiconsIcon icon={__RefreshCwHugeIcon} className="h-3.5 w-3.5" />
                {t('update.downloadRestart')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-8 bg-zinc-100 text-zinc-800 hover:bg-zinc-200"
                onClick={() => setDismissedKey(dismissKey)}
              >
                {t('common.later')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
