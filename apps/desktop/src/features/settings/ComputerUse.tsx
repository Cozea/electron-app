import * as React from 'react'
import {
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsRowControl,
  SettingsRowLabel,
  SettingsSectionDescription,
  SettingsSectionTitle,
} from '@/features/settings/ui/SettingsChrome'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { saveLocalSettings, useLocalSettings } from '@/lib/settings/localSettings'
import { appToast } from '@/lib/appToast'
import { useTranslation } from '@/lib/i18n'
import type { ComputerUseDiagnostics } from '@shared/electronApiTypes'

import { HugeiconsIcon } from '@hugeicons/react'
import {
  Alert01Icon as __AlertHugeIcon,
  CheckmarkCircle02Icon as __CheckHugeIcon,
  RefreshIcon as __RefreshHugeIcon,
  ExternalLinkIcon as __ExternalLinkHugeIcon,
} from '@hugeicons/core-free-icons'

interface ComputerUseProps {
  surface?: 'page' | 'drawer'
  route?: string
}

const COMPUTER_USE_TOOLS = [
  {
    name: 'get_app_state',
    title: 'Window State & Screenshots',
    description: 'Capture active window accessibility hierarchy and screen snapshot.',
    type: 'read',
  },
  {
    name: 'list_apps',
    title: 'App Discovery',
    description: 'List running and recently used desktop applications.',
    type: 'read',
  },
  {
    name: 'click',
    title: 'Mouse Click',
    description: 'Click controls by accessibility element index or pixel coordinates.',
    type: 'action',
  },
  {
    name: 'type_text',
    title: 'Keyboard Typing',
    description: 'Type literal text into focused inputs and editable controls.',
    type: 'action',
  },
  {
    name: 'press_key',
    title: 'Shortcut Keys & Modifiers',
    description: 'Press keyboard shortcuts (e.g. Return, Tab, super+c).',
    type: 'action',
  },
  {
    name: 'set_value',
    title: 'Set Control Value',
    description: 'Directly set values on text inputs, sliders, and form elements.',
    type: 'action',
  },
  {
    name: 'scroll',
    title: 'Scroll View',
    description: 'Scroll documents, lists, and web views in any direction.',
    type: 'action',
  },
  {
    name: 'drag',
    title: 'Drag & Drop',
    description: 'Drag and drop between screen coordinates.',
    type: 'action',
  },
  {
    name: 'perform_secondary_action',
    title: 'Secondary & Context Actions',
    description: 'Trigger contextual accessibility actions exposed by controls.',
    type: 'action',
  },
] as const

export function ComputerUse({ surface = 'page', route: _route }: ComputerUseProps) {
  const { t } = useTranslation()
  const { data: savedSettings } = useLocalSettings()
  const computerUseEnabled = savedSettings?.computerUseEnabled ?? false
  const allowGlobalPointerFallbacks = savedSettings?.computerUseAllowGlobalPointerFallbacks ?? false
  const disabledTools = React.useMemo(
    () => new Set(savedSettings?.disabledComputerUseTools ?? []),
    [savedSettings?.disabledComputerUseTools],
  )

  const [diagnostics, setDiagnostics] = React.useState<ComputerUseDiagnostics | null>(null)
  const [isLoadingDiagnostics, setIsLoadingDiagnostics] = React.useState(false)
  const [isToggling, setIsToggling] = React.useState(false)

  const refreshDiagnostics = React.useCallback(async () => {
    if (!window.electronAPI.computerUse?.getDiagnostics) return
    setIsLoadingDiagnostics(true)
    try {
      const result = await window.electronAPI.computerUse.getDiagnostics()
      setDiagnostics(result)
    } catch {
      // Handled silently if main process hasn't reloaded yet
    } finally {
      setIsLoadingDiagnostics(false)
    }
  }, [])

  React.useEffect(() => {
    void refreshDiagnostics()
  }, [refreshDiagnostics])

  const handleToggle = React.useCallback(
    async (checked: boolean) => {
      setIsToggling(true)
      try {
        await saveLocalSettings({ computerUseEnabled: checked })
      } catch (err) {
        appToast.error({
          title: 'Computer Use',
          description: err instanceof Error ? err.message : 'Failed to update setting.',
        })
      } finally {
        setIsToggling(false)
      }
    },
    [],
  )

  const handleToggleTool = React.useCallback(
    async (toolName: string, checked: boolean) => {
      const next = new Set(savedSettings?.disabledComputerUseTools ?? [])
      if (checked) {
        next.delete(toolName)
      } else {
        next.add(toolName)
      }
      try {
        await saveLocalSettings({ disabledComputerUseTools: Array.from(next) })
      } catch (err) {
        appToast.error({
          title: 'Capabilities',
          description: err instanceof Error ? err.message : 'Failed to update tool setting.',
        })
      }
    },
    [savedSettings?.disabledComputerUseTools],
  )

  const handleGlobalPointerFallbackToggle = React.useCallback(async (checked: boolean) => {
    try {
      await saveLocalSettings({ computerUseAllowGlobalPointerFallbacks: checked })
    } catch (err) {
      appToast.error({
        title: 'Computer Use',
        description: err instanceof Error ? err.message : 'Failed to update pointer policy.',
      })
    }
  }, [])

  const handleOpenPermission = React.useCallback(
    async (target: 'accessibility' | 'screenRecording') => {
      try {
        await window.electronAPI.computerUse?.openPermissionSettings(target)
      } catch (err) {
        appToast.error({
          title: 'Permissions',
          description: err instanceof Error ? err.message : 'Unable to open System Settings.',
        })
      }
    },
    [],
  )

  return (
    <SettingsPageBody surface={surface} className="space-y-6">
      <SettingsPageHeader
        title={t('settings.computerUse.title')}
        description={t('settings.computerUse.description')}
      />

      <section>
        <SettingsGroup>
          <SettingsRow>
            <SettingsRowLabel
              title={t('settings.computerUse.enable')}
              description={t('settings.computerUse.enableDescription')}
            />
            <SettingsRowControl>
              <Switch
                checked={computerUseEnabled}
                onCheckedChange={(checked) => void handleToggle(checked)}
                disabled={isToggling}
              />
            </SettingsRowControl>
          </SettingsRow>
        </SettingsGroup>
      </section>

      <section>
        <div className="flex items-center justify-between pb-1">
          <div>
            <SettingsSectionTitle>
              {t('settings.computerUse.diagnosticsTitle')}
            </SettingsSectionTitle>
            <SettingsSectionDescription>
              {t('settings.computerUse.diagnosticsDescription')}
            </SettingsSectionDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => void refreshDiagnostics()}
            disabled={isLoadingDiagnostics}
          >
            <HugeiconsIcon
              icon={__RefreshHugeIcon}
              className={`h-3 w-3 ${isLoadingDiagnostics ? 'animate-spin' : ''}`}
            />
            {t('settings.computerUse.refresh')}
          </Button>
        </div>

        <SettingsGroup>
          <SettingsRow>
            <SettingsRowLabel
              title={t('settings.computerUse.accessibility')}
              description="Allows inspection of UI hierarchies and element interaction."
            />
            <SettingsRowControl className="flex items-center gap-2">
              <Badge
                variant={diagnostics?.accessibility ? 'secondary' : 'destructive'}
                className="gap-1.5"
              >
                <HugeiconsIcon
                  icon={diagnostics?.accessibility ? __CheckHugeIcon : __AlertHugeIcon}
                  className="h-3 w-3"
                />
                {diagnostics?.accessibility
                  ? t('settings.computerUse.permissionGranted')
                  : t('settings.computerUse.permissionMissing')}
              </Badge>
              {!diagnostics?.accessibility && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => void handleOpenPermission('accessibility')}
                >
                  <HugeiconsIcon icon={__ExternalLinkHugeIcon} className="h-3 w-3" />
                  {t('settings.computerUse.openSettings')}
                </Button>
              )}
            </SettingsRowControl>
          </SettingsRow>

          <SettingsRow>
            <SettingsRowLabel
              title={t('settings.computerUse.screenRecording')}
              description="Allows capturing window screenshots for visual layout verification."
            />
            <SettingsRowControl className="flex items-center gap-2">
              <Badge
                variant={diagnostics?.screenRecording ? 'secondary' : 'destructive'}
                className="gap-1.5"
              >
                <HugeiconsIcon
                  icon={diagnostics?.screenRecording ? __CheckHugeIcon : __AlertHugeIcon}
                  className="h-3 w-3"
                />
                {diagnostics?.screenRecording
                  ? t('settings.computerUse.permissionGranted')
                  : t('settings.computerUse.permissionMissing')}
              </Badge>
              {!diagnostics?.screenRecording && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => void handleOpenPermission('screenRecording')}
                >
                  <HugeiconsIcon icon={__ExternalLinkHugeIcon} className="h-3 w-3" />
                  {t('settings.computerUse.openSettings')}
                </Button>
              )}
            </SettingsRowControl>
          </SettingsRow>
        </SettingsGroup>
      </section>

      <section>
        <SettingsSectionTitle>{t('settings.computerUse.toolsTitle')}</SettingsSectionTitle>
        <SettingsSectionDescription>
          {t('settings.computerUse.toolsDescription')}
        </SettingsSectionDescription>

        <SettingsGroup>
          <div className="divide-y divide-border/40">
            {COMPUTER_USE_TOOLS.map((tool) => {
              const isToolEnabled = computerUseEnabled && !disabledTools.has(tool.name)

              return (
                <div
                  key={tool.name}
                  className="flex items-center justify-between px-4 py-3"
                >
                  <div className="min-w-0 flex-1 pr-4">
                    <span className="text-xs font-medium text-foreground">
                      {tool.title}
                    </span>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {tool.description}
                    </p>
                  </div>
                  <Switch
                    checked={isToolEnabled}
                    disabled={!computerUseEnabled}
                    onCheckedChange={(checked) => void handleToggleTool(tool.name, checked)}
                  />
                </div>
              )
            })}
          </div>
        </SettingsGroup>
      </section>

      <section>
        <SettingsSectionTitle>Advanced interaction</SettingsSectionTitle>
        <SettingsSectionDescription>
          Background and accessibility-targeted actions remain preferred. Physical pointer fallback is only used when an agent explicitly requests Open Computer Use&apos;s global click method.
        </SettingsSectionDescription>
        <SettingsGroup>
          <SettingsRow>
            <SettingsRowLabel
              title="Allow physical pointer fallback"
              description="Permit the upstream global pointer path to move and click the system cursor when targeted interaction is not appropriate. Off by default."
            />
            <SettingsRowControl>
              <Switch
                checked={computerUseEnabled && allowGlobalPointerFallbacks}
                disabled={!computerUseEnabled}
                onCheckedChange={(checked) => void handleGlobalPointerFallbackToggle(checked)}
              />
            </SettingsRowControl>
          </SettingsRow>
        </SettingsGroup>
      </section>
    </SettingsPageBody>
  )
}

export default ComputerUse
