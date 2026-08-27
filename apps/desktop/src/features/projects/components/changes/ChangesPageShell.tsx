import { HugeiconsIcon } from '@hugeicons/react'
import {
  FilterMailIcon as __FilterHugeIcon,
  PanelLeftIcon as __SidebarHugeIcon,
  Search01Icon as __SearchHugeIcon,
  Settings02Icon as __SettingsHugeIcon,
} from '@hugeicons/core-free-icons'

import { useTranslation } from '@/lib/i18n'

export function ChangesPageShell() {
  const { t } = useTranslation()

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="min-h-0 flex-1 overflow-auto">
        <div className="flex h-full min-h-0 w-full overflow-hidden">
          <div className="w-[30%] min-w-[200px] max-w-[300px] border-r border-border/70 flex flex-col shrink-0">
            <div className="p-4 pb-0 shrink-0">
              <div className="mb-3 flex items-center">
                <label className="relative flex h-8 min-w-0 flex-1 items-center rounded-md border border-border/40 bg-muted/60 transition-colors">
                  <HugeiconsIcon
                    icon={__SearchHugeIcon}
                    className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground/70"
                  />
                  <input
                    readOnly
                    placeholder={t('changes.placeholder.filterFiles')}
                    className="h-full min-w-0 flex-1 bg-transparent pl-7 pr-8 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70"
                  />
                  <button
                    type="button"
                    className="absolute right-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground/80"
                    aria-label={t('changes.action.filterFiles')}
                    tabIndex={-1}
                  >
                    <HugeiconsIcon icon={__FilterHugeIcon} className="size-3.5" />
                  </button>
                </label>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-4" />
          </div>

          <div className="flex min-w-0 flex-1 flex-col bg-background">
            <div className="flex items-center gap-2 px-6 py-3 border-b border-border/70 shrink-0">
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-transparent text-muted-foreground"
                tabIndex={-1}
              >
                <HugeiconsIcon icon={__SidebarHugeIcon} className="size-4.5" />
              </button>
              <label className="relative flex h-9 min-w-0 flex-1 items-center rounded-lg border border-border/40 bg-muted/60 transition-colors">
                <HugeiconsIcon
                  icon={__SearchHugeIcon}
                  className="pointer-events-none absolute left-3 size-4 text-muted-foreground/70"
                />
                <input
                  readOnly
                  placeholder="Search within code"
                  className="h-full min-w-0 flex-1 bg-transparent pl-9 pr-4 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70"
                />
              </label>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground"
                tabIndex={-1}
              >
                <HugeiconsIcon icon={__SettingsHugeIcon} className="size-4.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1" />
          </div>
        </div>
      </div>
    </div>
  )
}
