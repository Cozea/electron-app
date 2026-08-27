import type { ProviderOptionDescriptor } from "@cozea/assistant-contracts"
import {
  getProviderOptionCurrentValue,
} from "@cozea/assistant-shared/model"
import { memo } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ZapIcon as __ZapIconHugeIcon,
  BrainIcon as __BrainIconHugeIcon,
  BookOpen01Icon as __BookOpen01IconHugeIcon,
  AiBrain05Icon as __AiBrain05IconHugeIcon,
  BotIcon as __BotIconHugeIcon,
} from "@hugeicons/core-free-icons"

import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { ensureNativeApi } from "@/lib/nativeApi"

interface ProviderOptionControlsProps {
  descriptors: ReadonlyArray<ProviderOptionDescriptor>
  disabled?: boolean
  onOptionChange: (id: string, value: string | boolean) => void
}

function descriptorKey(descriptor: ProviderOptionDescriptor): string {
  return `${descriptor.type}:${descriptor.id}`
}

function getDescriptorIcon(id: string) {
  switch (id) {
    case "fastMode":
      return __ZapIconHugeIcon
    case "thinking":
      return __BrainIconHugeIcon
    case "contextWindow":
      return __BookOpen01IconHugeIcon
    case "effort":
      return __AiBrain05IconHugeIcon
    case "agent":
    case "agentType":
      return __BotIconHugeIcon
    default:
      return __AiBrain05IconHugeIcon
  }
}

export const ProviderOptionControls = memo(function ProviderOptionControls(
  props: ProviderOptionControlsProps,
) {
  if (props.descriptors.length === 0) {
    return null
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {props.descriptors.map((descriptor) => {
        const Icon = getDescriptorIcon(descriptor.id)
        if (descriptor.type === "boolean") {
          const checked = getProviderOptionCurrentValue(descriptor) === true
          return (
            <label
              key={descriptorKey(descriptor)}
              className={cn(
                "inline-flex h-6 shrink-0 whitespace-nowrap cursor-pointer items-center gap-1.5 rounded-full border border-transparent px-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                props.disabled && "opacity-60 cursor-not-allowed",
              )}
              title={descriptor.description ?? descriptor.label}
            >
              <HugeiconsIcon icon={Icon} className="size-3.5" />
              {descriptor.id === "fastMode" && <span className="truncate">{descriptor.label}</span>}
              <Switch
                checked={checked}
                disabled={props.disabled}
                onCheckedChange={(nextChecked) => {
                  props.onOptionChange(descriptor.id, nextChecked)
                }}
                className="scale-[0.7] -mr-1"
              />
            </label>
          )
        }

        const currentValue = getProviderOptionCurrentValue(descriptor)
        return (
          <button
            key={descriptorKey(descriptor)}
            type="button"
            className={cn(
              "inline-flex h-6 shrink-0 whitespace-nowrap items-center gap-1 rounded-full border border-transparent px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              props.disabled && "opacity-60 cursor-not-allowed",
            )}
            title={descriptor.description ?? descriptor.label}
            disabled={props.disabled}
            onClick={async (event) => {
              if (props.disabled) return
              
              if (descriptor.options.length === 2) {
                const currentIndex = descriptor.options.findIndex((o) => o.id === currentValue)
                const nextIndex = currentIndex === 0 ? 1 : 0
                const nextOption = descriptor.options[nextIndex]
                if (nextOption) {
                  props.onOptionChange(descriptor.id, nextOption.id)
                }
                return
              }

              const rect = event.currentTarget.getBoundingClientRect()
              const items = descriptor.options.map((option) => ({
                id: option.id,
                label: option.label,
                type: "checkbox" as const,
                checked: option.id === currentValue,
              }))
              
              const result = await ensureNativeApi().contextMenu.show(items, {
                x: Math.round(rect.left),
                y: Math.round(rect.bottom + 4),
              })
              
              if (result) {
                props.onOptionChange(descriptor.id, result)
              }
            }}
          >
            <HugeiconsIcon icon={Icon} className="size-3.5" />
            <span className="text-foreground">
              {descriptor.options.find((o) => o.id === currentValue)?.label ?? currentValue}
            </span>
          </button>
        )
      })}
    </div>
  )
})
