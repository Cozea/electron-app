'use client'

import { useState, useCallback } from 'react'
import { Pipette } from 'lucide-react'
import { HexColorPicker, HexColorInput } from 'react-colorful'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { toHex } from './InlineInput'
import { cn } from '@/lib/utils'

declare global {
  interface Window {
    EyeDropper?: new () => { open: (options?: { signal?: AbortSignal }) => Promise<{ sRGBHex: string }> }
  }
}

interface ColorPickerPopoverProps {
  value: string
  onChange: (hex: string) => void
  trigger: React.ReactNode
  className?: string
}

/** Custom color picker popover with hex as the default (hex input on top, then gradient picker). */
export function ColorPickerPopover({
  value,
  onChange,
  trigger,
  className,
}: ColorPickerPopoverProps) {
  const hexValue = toHex(value)
  const [open, setOpen] = useState(false)
  const [eyedropperPending, setEyedropperPending] = useState(false)
  const supportsEyedropper = typeof window !== 'undefined' && 'EyeDropper' in window

  const handleChange = useCallback(
    (hex: string) => {
      onChange(toHex(hex))
    },
    [onChange]
  )

  const handleEyedropper = useCallback(async () => {
    if (!supportsEyedropper || !window.EyeDropper) return
    setEyedropperPending(true)
    try {
      const dropper = new window.EyeDropper()
      const result = await dropper.open()
      if (result?.sRGBHex) {
        handleChange(result.sRGBHex)
      }
    } catch {
      // User cancelled or API failed
    } finally {
      setEyedropperPending(false)
    }
  }, [supportsEyedropper, handleChange])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        side="right"
        sideOffset={8}
        className={cn('w-auto p-3', className)}
      >
        {/* Hex input + eyedropper (pick color from screen) */}
        <div className="space-y-1.5 mb-3">
          <label className="text-[11px] text-muted-foreground">Hex</label>
          <div className="flex items-center gap-1.5">
            <HexColorInput
              color={hexValue}
              onChange={handleChange}
              prefixed
              className="flex-1 min-w-0 h-8 text-[11px] font-mono px-2 rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0"
            />
            {supportsEyedropper && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0 border-input"
                onClick={handleEyedropper}
                disabled={eyedropperPending}
                title="Pick a color from screen"
                aria-label="Pick a color from screen"
              >
                <Pipette className="h-4 w-4 text-muted-foreground" />
              </Button>
            )}
          </div>
        </div>
        <HexColorPicker
          color={hexValue}
          onChange={handleChange}
          className="react-colorful-hex-picker"
          style={{ width: '100%', height: 160 }}
        />
      </PopoverContent>
    </Popover>
  )
}
