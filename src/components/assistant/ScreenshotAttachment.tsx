import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PendingAttachment } from '@/stores/useAssistantPanelStore'

interface ScreenshotAttachmentProps {
  attachment: PendingAttachment
  onRemove: () => void
}

export function ScreenshotAttachment({ attachment, onRemove }: ScreenshotAttachmentProps) {
  return (
    <div className="relative group inline-block">
      <div className="relative rounded-lg overflow-hidden border border-border bg-muted">
        <img
          src={attachment.data}
          alt={attachment.name}
          className="h-16 w-auto max-w-[120px] object-cover"
        />
        <Button
          variant="ghost"
          size="icon"
          className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={onRemove}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
      {attachment.context?.pagePath && (
        <div className="text-[10px] text-muted-foreground truncate max-w-[120px] mt-0.5">
          {attachment.context.pagePath}
        </div>
      )}
    </div>
  )
}

interface ScreenshotAttachmentsProps {
  attachments: PendingAttachment[]
  onRemove: (index: number) => void
}

export function ScreenshotAttachments({ attachments, onRemove }: ScreenshotAttachmentsProps) {
  if (attachments.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 p-2 border-b border-border">
      {attachments.map((attachment, index) => (
        <ScreenshotAttachment
          key={`${attachment.name}-${index}`}
          attachment={attachment}
          onRemove={() => onRemove(index)}
        />
      ))}
    </div>
  )
}
