import { useId } from 'react'
import { ArrowPathIcon as RotateCcw, CheckIcon as Check, SwatchIcon as Palette } from "@heroicons/react/24/outline"

import {
  isWorkspaceCustomIconColor as isCustomWorkspaceIconColor,
  resolveWorkspaceIdentity,
  type WorkspaceIdentityInput,
  type WorkspaceIconColorValue,
} from '@shared/workspaceIdentity.ts'
import type { WorkspaceType } from '@shared/types'
import { Button } from '@/components/ui/button'
import {
  SettingsGroup,
  SettingsRow,
  SettingsRowLabel,
  SettingsSectionDescription,
  SettingsSectionTitle,
} from '@/components/settings/SettingsChrome'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  WORKSPACE_COLOR_OPTIONS,
  WORKSPACE_ICON_OPTIONS,
} from '@/lib/workspaces/workspaceIdentity'
import { WorkspaceAvatar } from '@/components/workspaces/WorkspaceAvatar'

interface WorkspaceIdentityPickerProps {
  workspaceType: WorkspaceType
  workspaceName: string
  value: WorkspaceIdentityInput
  onChange: (value: WorkspaceIdentityInput) => void
  disabled?: boolean
  layout?: 'stack' | 'rows' | 'groups'
}

export function WorkspaceIdentityPicker({
  workspaceType,
  workspaceName,
  value,
  onChange,
  disabled = false,
  layout = 'stack',
}: WorkspaceIdentityPickerProps) {
  const isDefaultIdentity = !value.iconKey && !value.iconColor
  const resolvedIdentity = resolveWorkspaceIdentity({
    workspaceType,
    iconKey: value.iconKey,
    iconColor: value.iconColor,
  })
  const selectedIconKey = resolvedIdentity.iconKey
  const colorInputId = useId()
  const hasCustomColor = isCustomWorkspaceIconColor(value.iconColor ?? '')
  const customColor = hasCustomColor ? value.iconColor : '#7c3aed'
  const gradientStyle = {
    backgroundImage:
      'linear-gradient(135deg, #f472b6, #34d399 40%, #38bdf8 70%, #facc15)',
  }

  const previewSummary = (
    <div className="flex min-w-0 items-center gap-3">
      <WorkspaceAvatar
        workspaceType={workspaceType}
        iconKey={value.iconKey}
        iconColor={value.iconColor}
        size="lg"
      />
      <div className="min-w-0">
        <div className="truncate text-sm text-foreground">{workspaceName || 'Workspace'}</div>
        <div className="text-xs text-muted-foreground">
          {isDefaultIdentity ? 'Default workspace style' : 'Custom workspace style'}
        </div>
      </div>
    </div>
  )

  const colorPicker = (
    <div className="flex flex-wrap gap-2">
      {WORKSPACE_COLOR_OPTIONS.map((color) => {
        const isSelected = (value.iconColor ?? 'default') === color.key
        return (
          <Tooltip key={color.key}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  'relative flex size-8 items-center justify-center rounded-full ring-1 ring-inset transition-all',
                  color.swatchClassName,
                  isSelected ? cn('scale-105 ring-2', color.selectedClassName) : 'ring-border/60',
                  disabled && 'opacity-50',
                )}
                onClick={() =>
                  onChange({
                    ...value,
                    iconColor: color.key,
                  })
                }
                disabled={disabled}
                aria-label={`Use ${color.label} icon color`}
              >
                {isSelected ? (
                  <Check
                    className={cn(
                      'size-3',
                      color.key === 'default' ? 'text-secondary-foreground' : 'text-white'
                    )}
                  />
                ) : null}
              </button>
            </TooltipTrigger>
            <TooltipContent>{color.label}</TooltipContent>
          </Tooltip>
        )
      })}

      <Tooltip>
        <TooltipTrigger asChild>
          <label
            htmlFor={colorInputId}
            className={cn(
              'relative flex size-8 cursor-pointer items-center justify-center overflow-hidden rounded-full ring-1 ring-inset transition-all',
              hasCustomColor ? 'scale-105 ring-2 ring-ring/60' : 'ring-border/60',
              disabled && 'pointer-events-none opacity-50',
            )}
            style={hasCustomColor ? { backgroundColor: customColor } : gradientStyle}
            aria-label="Choose a custom icon color"
          >
            {hasCustomColor ? (
              <Check className="size-3 text-white" />
            ) : (
              <Palette className="size-3 text-white/80" />
            )}
            <input
              id={colorInputId}
              type="color"
              className="absolute inset-0 cursor-pointer opacity-0"
              value={customColor}
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...value,
                  iconColor: event.target.value.toLowerCase() as WorkspaceIconColorValue,
                })
              }
            />
          </label>
        </TooltipTrigger>
        <TooltipContent>
          {hasCustomColor ? `Custom (${value.iconColor})` : 'Custom color'}
        </TooltipContent>
      </Tooltip>
    </div>
  )

  const iconPicker = (
    <div className="grid grid-cols-6 gap-2 sm:grid-cols-7">
      {WORKSPACE_ICON_OPTIONS.map((option) => {
        const isSelected = selectedIconKey === option.key
        const Icon = option.icon

        return (
          <Tooltip key={option.key}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  'flex h-11 items-center justify-center rounded-2xl bg-secondary/80 text-muted-foreground transition-colors dark:bg-secondary/40 hover:bg-[var(--table-row-hover)]',
                  isSelected && 'bg-[var(--table-row-selected)] text-foreground',
                  disabled && 'opacity-50',
                )}
                onClick={() =>
                  onChange({
                    iconKey: option.key,
                    iconColor: value.iconColor ?? 'default',
                  })
                }
                disabled={disabled}
                aria-label={`Use ${option.label} icon`}
              >
                <Icon className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{option.label}</TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )

  const iconColorRow = (
    <SettingsRow isFirst className="flex-col items-stretch gap-3">
      <SettingsRowLabel
        title="Icon color"
        description="Choose the color used for the workspace icon."
      />
      {colorPicker}
    </SettingsRow>
  )

  const iconRow = (
    <SettingsRow className="flex-col items-stretch gap-3">
      <SettingsRowLabel
        title="Icon"
        description="Choose the symbol shown for this workspace."
      />
      {iconPicker}
    </SettingsRow>
  )

  if (layout === 'groups') {
    return (
      <div className="space-y-3">
        <div>
          <SettingsSectionTitle className="mb-1">Appearance</SettingsSectionTitle>
          <SettingsSectionDescription className="mb-0">
            Choose the default appearance for this workspace.
          </SettingsSectionDescription>
        </div>
        <SettingsGroup>
          {iconColorRow}
          {iconRow}
        </SettingsGroup>
      </div>
    )
  }

  if (layout === 'rows') {
    return (
      <>
        <SettingsRow className="flex-col items-stretch gap-3">
          <SettingsRowLabel title="Icon color" />
          {colorPicker}
        </SettingsRow>
        <SettingsRow className="flex-col items-stretch gap-3">
          <SettingsRowLabel title="Icon" />
          {iconPicker}
        </SettingsRow>
      </>
    )
  }

  return (
    <div className="divide-y divide-border/40">
      <div className="flex items-center justify-between gap-4 py-3">
        <div className="min-w-0 pr-4">
          <p className="text-xs font-medium text-foreground">Preview</p>
          <p className="text-[11px] text-muted-foreground">How this workspace appears in the app.</p>
        </div>
        {previewSummary}
      </div>

      <div className="flex items-center justify-between gap-4 py-3">
        <div className="min-w-0 pr-4">
          <p className="text-xs font-medium text-foreground">Appearance</p>
          <p className="text-[11px] text-muted-foreground">Choose an icon and color for this workspace.</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 shrink-0 gap-1.5 rounded-full text-[11px] font-normal"
          onClick={() => onChange({})}
          disabled={disabled || isDefaultIdentity}
        >
          <RotateCcw className="size-3.5" />
          Default
        </Button>
      </div>

      <div className="space-y-3 py-3">
        <p className="text-xs font-medium text-foreground">Icon color</p>
        {colorPicker}
      </div>

      <div className="space-y-3 py-3">
        <p className="text-xs font-medium text-foreground">Icon</p>
        {iconPicker}
      </div>
    </div>
  )
}
