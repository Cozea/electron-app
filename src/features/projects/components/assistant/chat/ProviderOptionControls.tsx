import type { ProviderOptionDescriptor } from "@cozea/assistant-contracts"
import {
  getProviderOptionCurrentValue,
} from "@cozea/assistant-shared/model"
import { memo } from "react"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

interface ProviderOptionControlsProps {
  descriptors: ReadonlyArray<ProviderOptionDescriptor>
  disabled?: boolean
  onOptionChange: (id: string, value: string | boolean) => void
}

function descriptorKey(descriptor: ProviderOptionDescriptor): string {
  return `${descriptor.type}:${descriptor.id}`
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
        if (descriptor.type === "boolean") {
          const checked = getProviderOptionCurrentValue(descriptor) === true
          return (
            <label
              key={descriptorKey(descriptor)}
              className={cn(
                "inline-flex h-7 items-center gap-2 rounded-full border border-transparent bg-secondary/70 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent/80 hover:text-foreground",
                props.disabled && "opacity-60",
              )}
              title={descriptor.description ?? descriptor.label}
            >
              <span className="truncate">{descriptor.label}</span>
              <Switch
                checked={checked}
                disabled={props.disabled}
                onCheckedChange={(nextChecked) => {
                  props.onOptionChange(descriptor.id, nextChecked)
                }}
                className="scale-90"
              />
            </label>
          )
        }

        const currentValue = getProviderOptionCurrentValue(descriptor)
        return (
          <div
            key={descriptorKey(descriptor)}
            className="inline-flex min-w-0 items-center gap-1 rounded-full border border-transparent bg-secondary/70 ps-2 pe-1 text-xs text-muted-foreground"
            title={descriptor.description ?? descriptor.label}
          >
            <span className="truncate">{descriptor.label}</span>
            <Select
              value={typeof currentValue === "string" ? currentValue : undefined}
              onValueChange={(value) => {
                props.onOptionChange(descriptor.id, value)
              }}
              disabled={props.disabled}
            >
              <SelectTrigger
                size="sm"
                className="h-6 rounded-full bg-transparent px-2 text-xs text-foreground hover:bg-transparent"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                {descriptor.options.map((option) => (
                  <SelectItem key={`${descriptor.id}:${option.id}`} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )
      })}
    </div>
  )
})
