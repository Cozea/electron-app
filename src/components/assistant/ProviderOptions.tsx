'use client'

import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  reasoningSummary?: 'auto' | 'detailed'
  textVerbosity?: 'low' | 'medium' | 'high'
  serviceTier?: 'auto' | 'flex' | 'priority' | 'default'
  strictJsonSchema?: boolean
  parallelToolCalls?: boolean

  // Anthropic
  thinkingEffort?: 'low' | 'medium' | 'high' // Opus 4.5 only - moved to main bar
  enableComputerUse?: boolean
  enableBashTool?: boolean
  enableTextEditor?: boolean
  anthropicEnableWebFetch?: boolean
  anthropicEnableCodeExecution?: boolean
  anthropicEnableMemoryTool?: boolean
  anthropicEnableToolSearch?: boolean
  anthropicToolSearchType?: 'bm25' | 'regex'
  sendReasoning?: boolean
  disableParallelToolUse?: boolean
  toolStreaming?: boolean

  // Google
  enableSearchGrounding?: boolean
  enableCodeExecution?: boolean
  enableUrlContext?: boolean
  enableMapsGrounding?: boolean
  enableFileSearch?: boolean
  includeThoughts?: boolean
  structuredOutputs?: boolean

  // Common
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
  const hasLocalExecution = false

  if (!hasToolOptions) return null

  return (
    <Popover>
      <PopoverTrigger className="h-6 px-2 rounded-full border border-transparent hover:bg-accent text-muted-foreground transition-colors flex items-center">
        <Wrench className="size-3" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-3 rounded-2xl">
        <div className="space-y-3">
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
              <OptionSelect
                label="Reasoning Summary"
                value={options.reasoningSummary}
                placeholder="Off"
                items={[
                  { label: 'Off', value: 'off' },
                  { label: 'Auto', value: 'auto' },
                  { label: 'Detailed', value: 'detailed' },
                ]}
                onValueChange={(value) =>
                  onChange({
                    ...options,
                    reasoningSummary: value === 'off' ? undefined : value as ProviderOptionsState['reasoningSummary'],
                  })
                }
                disabled={disabled}
              />
              <OptionSelect
                label="Text Verbosity"
                value={options.textVerbosity}
                placeholder="Default"
                items={[
                  { label: 'Default', value: 'off' },
                  { label: 'Low', value: 'low' },
                  { label: 'Medium', value: 'medium' },
                  { label: 'High', value: 'high' },
                ]}
                onValueChange={(value) =>
                  onChange({
                    ...options,
                    textVerbosity: value === 'off' ? undefined : value as ProviderOptionsState['textVerbosity'],
                  })
                }
                disabled={disabled}
              />
              <OptionSelect
                label="Service Tier"
                value={options.serviceTier}
                placeholder="Auto"
                items={[
                  { label: 'Auto (Default)', value: 'off' },
                  { label: 'Auto', value: 'auto' },
                  { label: 'Flex', value: 'flex' },
                  { label: 'Priority', value: 'priority' },
                  { label: 'Default', value: 'default' },
                ]}
                onValueChange={(value) =>
                  onChange({
                    ...options,
                    serviceTier: value === 'off' ? undefined : value as ProviderOptionsState['serviceTier'],
                  })
                }
                disabled={disabled}
              />
              <ToolToggle
                icon={<CheckBoxIcon />}
                label="Strict JSON Schema"
                checked={options.strictJsonSchema ?? true}
                onChange={(checked) => onChange({ ...options, strictJsonSchema: checked })}
                disabled={disabled}
              />
              <ToolToggle
                icon={<CheckBoxIcon />}
                label="Parallel Tool Calls"
                checked={options.parallelToolCalls ?? true}
                onChange={(checked) => onChange({ ...options, parallelToolCalls: checked })}
                disabled={disabled}
              />
              {capabilities.supportsShellTool && hasLocalExecution && (
                <ToolToggle
                  icon={<Terminal className="size-3" />}
                  label="Shell Tool"
                  checked={options.enableShellTool ?? false}
                  onChange={(checked) => onChange({ ...options, enableShellTool: checked })}
                  disabled={disabled}
                />
              )}
              {capabilities.supportsApplyPatch && hasLocalExecution && (
                <ToolToggle
                  icon={<FileText className="size-3" />}
                  label="Apply Patch"
                  checked={options.enableApplyPatch ?? false}
                  onChange={(checked) => onChange({ ...options, enableApplyPatch: checked })}
                  disabled={disabled}
                />
              )}
              {capabilities.supportsComputerUse && hasLocalExecution && (
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
              <ToolToggle
                icon={<CheckBoxIcon />}
                label="Send Reasoning"
                checked={options.sendReasoning ?? true}
                onChange={(checked) => onChange({ ...options, sendReasoning: checked })}
                disabled={disabled}
              />
              <ToolToggle
                icon={<CheckBoxIcon />}
                label="Tool Streaming"
                checked={options.toolStreaming ?? true}
                onChange={(checked) => onChange({ ...options, toolStreaming: checked })}
                disabled={disabled}
              />
              <ToolToggle
                icon={<CheckBoxIcon />}
                label="Disable Parallel Tool Use"
                checked={options.disableParallelToolUse ?? false}
                onChange={(checked) => onChange({ ...options, disableParallelToolUse: checked })}
                disabled={disabled}
              />
              {capabilities.supportsComputerUse && hasLocalExecution && (
                <ToolToggle
                  icon={<Monitor className="size-3" />}
                  label="Computer Use"
                  checked={options.enableComputerUse ?? false}
                  onChange={(checked) => onChange({ ...options, enableComputerUse: checked })}
                  disabled={disabled}
                />
              )}
              {capabilities.supportsShellTool && hasLocalExecution && (
                <ToolToggle
                  icon={<Terminal className="size-3" />}
                  label="Bash Tool"
                  checked={options.enableBashTool ?? false}
                  onChange={(checked) => onChange({ ...options, enableBashTool: checked })}
                  disabled={disabled}
                />
              )}
              {capabilities.supportsTextEditor && hasLocalExecution && (
                <ToolToggle
                  icon={<FileText className="size-3" />}
                  label="Text Editor"
                  checked={options.enableTextEditor ?? false}
                  onChange={(checked) => onChange({ ...options, enableTextEditor: checked })}
                  disabled={disabled}
                />
              )}
              <ToolToggle
                icon={<Search className="size-3" />}
                label="Web Fetch"
                checked={options.anthropicEnableWebFetch ?? false}
                onChange={(checked) => onChange({ ...options, anthropicEnableWebFetch: checked })}
                disabled={disabled}
              />
              <ToolToggle
                icon={<Code className="size-3" />}
                label="Code Execution"
                checked={options.anthropicEnableCodeExecution ?? false}
                onChange={(checked) => onChange({ ...options, anthropicEnableCodeExecution: checked })}
                disabled={disabled}
              />
              {hasLocalExecution && (
                <ToolToggle
                  icon={<CheckBoxIcon />}
                  label="Memory Tool"
                  checked={options.anthropicEnableMemoryTool ?? false}
                  onChange={(checked) => onChange({ ...options, anthropicEnableMemoryTool: checked })}
                  disabled={disabled}
                />
              )}
              <ToolToggle
                icon={<CheckBoxIcon />}
                label="Tool Search"
                checked={options.anthropicEnableToolSearch ?? false}
                onChange={(checked) => onChange({ ...options, anthropicEnableToolSearch: checked })}
                disabled={disabled}
              />
              {options.anthropicEnableToolSearch && (
                <OptionSelect
                  label="Tool Search Type"
                  value={options.anthropicToolSearchType}
                  placeholder="BM25"
                  items={[
                    { label: 'BM25', value: 'bm25' },
                    { label: 'Regex', value: 'regex' },
                  ]}
                  onValueChange={(value) =>
                    onChange({ ...options, anthropicToolSearchType: value as ProviderOptionsState['anthropicToolSearchType'] })
                  }
                  disabled={disabled}
                />
              )}
            </>
          )}

          {/* Google-specific tools */}
          {provider === 'google' && (
            <>
              {capabilities.supportsWebSearch && (
                <ToolToggle
                  icon={<Search className="size-3" />}
                  label="Search Grounding"
                  checked={options.enableSearchGrounding ?? false}
                  onChange={(checked) => onChange({ ...options, enableSearchGrounding: checked })}
                  disabled={disabled}
                />
              )}
              {capabilities.supportsUrlContext && (
                <ToolToggle
                  icon={<Search className="size-3" />}
                  label="URL Context"
                  checked={options.enableUrlContext ?? false}
                  onChange={(checked) => onChange({ ...options, enableUrlContext: checked })}
                  disabled={disabled}
                />
              )}
              {capabilities.supportsMapsGrounding && (
                <ToolToggle
                  icon={<Search className="size-3" />}
                  label="Maps Grounding"
                  checked={options.enableMapsGrounding ?? false}
                  onChange={(checked) => onChange({ ...options, enableMapsGrounding: checked })}
                  disabled={disabled}
                />
              )}
              {capabilities.supportsFileSearch && (
                <ToolToggle
                  icon={<Search className="size-3" />}
                  label="File Search"
                  checked={options.enableFileSearch ?? false}
                  onChange={(checked) => onChange({ ...options, enableFileSearch: checked })}
                  disabled={disabled}
                />
              )}
              <ToolToggle
                icon={<CheckBoxIcon />}
                label="Include Thoughts"
                checked={options.includeThoughts ?? true}
                onChange={(checked) => onChange({ ...options, includeThoughts: checked })}
                disabled={disabled}
              />
              <ToolToggle
                icon={<CheckBoxIcon />}
                label="Structured Outputs"
                checked={options.structuredOutputs ?? true}
                onChange={(checked) => onChange({ ...options, structuredOutputs: checked })}
                disabled={disabled}
              />
            </>
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

interface OptionItem {
  label: string
  value: string
}

interface OptionSelectProps {
  label: string
  value?: string
  placeholder?: string
  items: OptionItem[]
  onValueChange: (value: string) => void
  disabled?: boolean
}

function OptionSelect({ label, value, placeholder, items, onValueChange, disabled }: OptionSelectProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-sm">{label}</Label>
      <Select value={value} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger className="h-7 w-[140px] text-xs">
          <SelectValue placeholder={placeholder ?? 'Select'} />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function CheckBoxIcon() {
  return <div className="size-3 rounded-[2px] border border-current" />
}
