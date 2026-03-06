import { FileImage, FileText, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ChatAttachmentCardProps {
  mediaType: string
  name: string
  url: string
  size?: 'composer' | 'message'
  contextLabel?: string | null
  onRemove?: () => void
}

function formatMediaTypeLabel(mediaType: string): string {
  const normalized = mediaType.trim().toLowerCase()
  if (normalized === 'application/pdf') return 'PDF'

  const [, subtype = 'file'] = normalized.split('/')
  return subtype.toUpperCase()
}

export function ChatAttachmentCard({
  mediaType,
  name,
  url,
  size = 'message',
  contextLabel,
  onRemove,
}: ChatAttachmentCardProps) {
  const normalizedMediaType = mediaType.trim().toLowerCase()
  const isImage = normalizedMediaType.startsWith('image/')
  const isComposer = size === 'composer'

  return (
    <div className="group inline-flex max-w-full flex-col gap-1">
      <div
        className={cn(
          'relative overflow-hidden border border-border bg-muted/80 shadow-sm',
          isComposer ? 'rounded-lg' : 'rounded-2xl'
        )}
      >
        {isImage ? (
          <img
            src={url}
            alt={name}
            className={cn(
              'block w-auto max-w-full object-cover',
              isComposer ? 'h-16 max-w-[120px]' : 'max-h-[260px] max-w-[280px]'
            )}
          />
        ) : (
          <div
            className={cn(
              'flex items-center gap-3',
              isComposer ? 'min-w-[120px] max-w-[180px] px-3 py-2' : 'min-w-[220px] max-w-[280px] px-3.5 py-3'
            )}
          >
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-background/80 text-muted-foreground">
              {normalizedMediaType.startsWith('image/')
                ? <FileImage className="h-4 w-4" />
                : <FileText className="h-4 w-4" />}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{name}</div>
              <div className="text-xs text-muted-foreground">{formatMediaTypeLabel(normalizedMediaType)}</div>
            </div>
          </div>
        )}

        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn(
              'absolute right-1 top-1 h-5 w-5 rounded-full bg-background/85 opacity-0 transition-opacity group-hover:opacity-100',
              isComposer ? '' : 'backdrop-blur-sm'
            )}
            onClick={onRemove}
            aria-label={`Remove ${name}`}
          >
            <X className="h-3 w-3" />
          </Button>
        ) : null}
      </div>

      {contextLabel ? (
        <div
          className={cn(
            'truncate text-muted-foreground',
            isComposer ? 'max-w-[120px] text-[10px]' : 'max-w-[280px] text-xs'
          )}
        >
          {contextLabel}
        </div>
      ) : null}
    </div>
  )
}
