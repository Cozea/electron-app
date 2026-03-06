import type { PendingAttachment } from '@/stores/useAssistantPanelStore'
import { ChatAttachmentCard } from '@/components/assistant/ChatAttachmentCard'

interface ScreenshotAttachmentProps {
  attachment: PendingAttachment
  onRemove: () => void
}

export function ScreenshotAttachment({ attachment, onRemove }: ScreenshotAttachmentProps) {
  return (
    <ChatAttachmentCard
      mediaType={attachment.mediaType}
      name={attachment.name}
      url={attachment.data}
      size="composer"
      contextLabel={attachment.context?.pagePath ?? null}
      onRemove={onRemove}
    />
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
