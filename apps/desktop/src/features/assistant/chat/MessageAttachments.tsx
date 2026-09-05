import { memo, useLayoutEffect, useRef, useState } from "react";
import { AuthorizedChatAttachment, useChatAttachmentUrl } from "./ChatMedia";
import { cn } from "@/lib/utils";
import type { ChatAttachment, ChatImageAttachment } from "@/features/assistant/model/types";
import type { ExpandedImagePreview } from "./ExpandedImagePreview";

const MessageImage = memo(function MessageImage({
  attachment,
  urls,
  onExpand,
}: {
  attachment: ChatImageAttachment;
  urls: Map<string, string>;
  onExpand: (id: string) => void;
}) {
  const media = useChatAttachmentUrl(attachment);
  const url = media.url;
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const usable = url && url !== failedUrl ? url : null;
  useLayoutEffect(() => {
    if (usable) urls.set(attachment.id, usable);
    else urls.delete(attachment.id);
    return () => {
      urls.delete(attachment.id);
    };
  }, [attachment.id, usable, urls]);
  return (
    <div className="relative h-24 w-32 shrink-0 overflow-hidden rounded-xl border border-border/40">
      {usable ? (
        <button
          type="button"
          className="h-full w-full cursor-zoom-in"
          aria-label={`Preview ${attachment.name}`}
          onClick={() => onExpand(attachment.id)}
        >
          <img
            src={usable}
            alt={attachment.name}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setFailedUrl(usable)}
          />
        </button>
      ) : (
        <div className="flex h-full items-center justify-center bg-secondary/30 px-2 text-center text-xs text-muted-foreground">
          <span>
            {attachment.name}
            {media.error || failedUrl ? " (preview unavailable)" : ""}
          </span>
        </div>
      )}
    </div>
  );
});

/** Signed media updates measure only their own row; preserve Cozea's gallery. */
export const MessageAttachments = memo(function MessageAttachments({
  attachments,
  onExpand,
  align = "end",
}: {
  attachments: readonly ChatAttachment[];
  onExpand: (preview: ExpandedImagePreview) => void;
  align?: "start" | "end";
}) {
  const urls = useRef(new Map<string, string>()).current;
  const expand = (id: string) => {
    const images = attachments.flatMap((attachment) => {
      const src = urls.get(attachment.id);
      return attachment.type === "image" && src
        ? [{ id: attachment.id, src, name: attachment.name }]
        : [];
    });
    const index = images.findIndex((image) => image.id === id);
    if (index >= 0) onExpand({ images, index });
  };
  return (
    <div
      className={cn(
        "mb-1 flex w-full flex-wrap gap-2",
        align === "end" ? "justify-end" : "justify-start",
      )}
    >
      {attachments.map((attachment) =>
        attachment.type === "image" ? (
          <MessageImage key={attachment.id} attachment={attachment} urls={urls} onExpand={expand} />
        ) : (
          <span key={attachment.id} className="rounded-md border border-border px-2 py-1 text-xs">
            <AuthorizedChatAttachment attachment={attachment} />
          </span>
        ),
      )}
    </div>
  );
});
