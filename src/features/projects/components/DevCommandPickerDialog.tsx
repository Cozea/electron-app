import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { DevCommandSuggestion } from '@shared/electronApiTypes'

interface DevCommandPickerDialogProps {
  open: boolean
  defaultCommand?: string
  suggestions: DevCommandSuggestion[]
  onOpenChange: (open: boolean) => void
  onConfirm: (command: string) => void
}

function formatConfidence(value: number): string {
  const clamped = Math.max(0, Math.min(1, value))
  return `${Math.round(clamped * 100)}%`
}

export function DevCommandPickerDialog({
  open,
  defaultCommand,
  suggestions,
  onOpenChange,
  onConfirm,
}: DevCommandPickerDialogProps) {
  const [command, setCommand] = useState(defaultCommand ?? '')

  useEffect(() => {
    if (open) {
      setCommand(defaultCommand ?? '')
    }
  }, [defaultCommand, open])

  const orderedSuggestions = useMemo(
    () => [...suggestions].sort((a, b) => b.confidence - a.confidence).slice(0, 6),
    [suggestions]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Select Dev Command</DialogTitle>
          <DialogDescription>
            Cozea could not confidently pick a dev server command. Choose one to run.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {orderedSuggestions.length > 0 ? (
            <div className="space-y-2">
              {orderedSuggestions.map((suggestion) => (
                <button
                  key={`${suggestion.command}:${suggestion.reason}`}
                  type="button"
                  className="w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/50"
                  onClick={() => setCommand(suggestion.command)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <code className="truncate text-xs">{suggestion.command}</code>
                    <span className="text-[11px] text-muted-foreground">
                      {formatConfidence(suggestion.confidence)}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{suggestion.reason}</p>
                </button>
              ))}
            </div>
          ) : null}

          <Input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="npm run dev"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => onConfirm(command.trim())}
            disabled={!command.trim()}
          >
            Run Command
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
