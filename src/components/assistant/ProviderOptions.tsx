'use client'

import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Wrench, Search, Code, Terminal, Monitor, FileText } from 'lucide-react'

interface ModelCapabilities {
  supportsExtendedThinking: boolean
  reasoningType: 'effort' | 'budget' | 'level' | 'none'
  reasoningRange?: { min: number; max: number } | string[]
  supportsWebSearch: boolean
  supportsFileSearch: boolean
  supportsCodeInterpreter: boolean
  supportsComputerUse: boolean
  supportsShellTool: boolean
  supportsTextEditor: boolean
  supportsApplyPatch: boolean
  supportsEffortParameter: boolean // Opus 4.5 only
}

export interface ProviderOptionsState {
  // OpenAI
  enableShellTool?: boolean
  enableApplyPatch?: boolean
  enableCodeInterpreter?: boolean

  // Anthropic
  thinkingEffort?: 'low' | 'medium' | 'high' // Opus 4.5 only - moved to main bar
  enableComputerUse?: boolean
  enableBashTool?: boolean
  enableTextEditor?: boolean

  // Google
  enableSearchGrounding?: boolean
  enableCodeExecution?: boolean

  // Common
  enableWebSearch?: boolean
}

interface ProviderOptionsProps {
  provider: 'anthropic' | 'openai' | 'google'
  capabilities: ModelCapabilities
  options: ProviderOptionsState
  onChange: (options: ProviderOptionsState) => void
  disabled?: boolean
}

export function ProviderOptions({
  provider,
  capabilities,
  options,
  onChange,
  disabled,
}: ProviderOptionsProps) {
  // Only show if there are tool options
  const hasToolOptions =
    capabilities.supportsWebSearch ||
    capabilities.supportsCodeInterpreter ||
    capabilities.supportsComputerUse ||
    capabilities.supportsShellTool ||
    capabilities.supportsTextEditor ||
    capabilities.supportsApplyPatch

  if (!hasToolOptions) return null

  return (
    <Popover>
      <PopoverTrigger className="h-6 px-2 rounded-full border border-transparent hover:bg-accent text-muted-foreground transition-colors flex items-center">
        <Wrench className="size-3" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-3 rounded-2xl">
        <div className="space-y-3">
          {capabilities.supportsWebSearch && (
            <ToolToggle
              icon={<Search className="size-3" />}
              label="Web Search"
              checked={options.enableWebSearch ?? false}
              onChange={(checked) => onChange({ ...options, enableWebSearch: checked })}
              disabled={disabled}
            />
          )}

          {capabilities.supportsCodeInterpreter && (
            <ToolToggle
              icon={<Code className="size-3" />}
              label={provider === 'google' ? 'Code Execution' : 'Code Interpreter'}
              checked={
                provider === 'google'
                  ? options.enableCodeExecution ?? false
                  : options.enableCodeInterpreter ?? false
              }
              onChange={(checked) =>
                onChange({
                  ...options,
                  ...(provider === 'google'
                    ? { enableCodeExecution: checked }
                    : { enableCodeInterpreter: checked }),
                })
              }
              disabled={disabled}
            />
          )}

          {/* OpenAI-specific tools */}
          {provider === 'openai' && (
            <>
              {capabilities.supportsShellTool && (
                <ToolToggle
                  icon={<Terminal className="size-3" />}
                  label="Shell Tool"
                  checked={options.enableShellTool ?? false}
                  onChange={(checked) => onChange({ ...options, enableShellTool: checked })}
                  disabled={disabled}
                />
              )}
              {capabilities.supportsApplyPatch && (
                <ToolToggle
                  icon={<FileText className="size-3" />}
                  label="Apply Patch"
                  checked={options.enableApplyPatch ?? false}
                  onChange={(checked) => onChange({ ...options, enableApplyPatch: checked })}
                  disabled={disabled}
                />
              )}
              {capabilities.supportsComputerUse && (
                <ToolToggle
                  icon={<Monitor className="size-3" />}
                  label="Computer Use"
                  checked={options.enableComputerUse ?? false}
                  onChange={(checked) => onChange({ ...options, enableComputerUse: checked })}
                  disabled={disabled}
                />
              )}
            </>
          )}

          {/* Anthropic-specific tools */}
          {provider === 'anthropic' && (
            <>
              {capabilities.supportsComputerUse && (
                <ToolToggle
                  icon={<Monitor className="size-3" />}
                  label="Computer Use"
                  checked={options.enableComputerUse ?? false}
                  onChange={(checked) => onChange({ ...options, enableComputerUse: checked })}
                  disabled={disabled}
                />
              )}
              {capabilities.supportsShellTool && (
                <ToolToggle
                  icon={<Terminal className="size-3" />}
                  label="Bash Tool"
                  checked={options.enableBashTool ?? false}
                  onChange={(checked) => onChange({ ...options, enableBashTool: checked })}
                  disabled={disabled}
                />
              )}
              {capabilities.supportsTextEditor && (
                <ToolToggle
                  icon={<FileText className="size-3" />}
                  label="Text Editor"
                  checked={options.enableTextEditor ?? false}
                  onChange={(checked) => onChange({ ...options, enableTextEditor: checked })}
                  disabled={disabled}
                />
              )}
            </>
          )}

          {/* Google-specific tools */}
          {provider === 'google' && capabilities.supportsWebSearch && (
            <ToolToggle
              icon={<Search className="size-3" />}
              label="Search Grounding"
              checked={options.enableSearchGrounding ?? false}
              onChange={(checked) => onChange({ ...options, enableSearchGrounding: checked })}
              disabled={disabled}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface ToolToggleProps {
  icon: React.ReactNode
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

function ToolToggle({ icon, label, checked, onChange, disabled }: ToolToggleProps) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-xs flex items-center gap-1.5 cursor-pointer">
        {icon}
        {label}
      </Label>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="scale-75 origin-right"
      />
    </div>
  )
}
