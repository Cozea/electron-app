import { createContext, useContext, useMemo, type ReactNode } from "react";
import { ThreadId } from "@cozea/assistant-contracts";
import { useAuthorizedChatMedia } from "./useAuthorizedChatMedia";
import { classifyChatMediaSource } from "./chatMediaSource";
import type { ChatAttachment } from "@/features/assistant/model/types";

const MediaContext = createContext<{ threadId: string; baseUrl: string | null } | null>(null);
export function ChatMediaProvider({
  threadId,
  baseUrl,
  children,
}: {
  threadId: string;
  baseUrl: string | null;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ threadId, baseUrl }), [threadId, baseUrl]);
  return <MediaContext.Provider value={value}>{children}</MediaContext.Provider>;
}

export function useChatAttachmentUrl(attachment: ChatAttachment) {
  const context = useContext(MediaContext);
  const preview =
    attachment.type === "image" &&
    attachment.previewUrl &&
    classifyChatMediaSource(attachment.previewUrl).kind === "direct"
      ? attachment.previewUrl
      : null;
  const signed = useAuthorizedChatMedia(
    context?.baseUrl ?? null,
    preview || attachment.type === "unsupported"
      ? null
      : {
          _tag: "attachment",
          attachmentId: attachment.id,
          fileName: attachment.name,
          mimeType: attachment.mimeType,
          ...(attachment.type === "image" ? { disposition: "inline" as const } : {}),
        },
  );
  return preview
    ? { url: preview, error: false }
    : !context?.baseUrl
      ? { url: null, error: true }
      : signed;
}

export function AuthorizedChatAttachment({
  attachment,
  onImageExpand,
}: {
  attachment: ChatAttachment;
  onImageExpand?: (url: string, name: string) => void;
}) {
  const { url, error } = useChatAttachmentUrl(attachment);
  if (attachment.type === "unsupported")
    return (
      <span>
        {attachment.name} (unsupported {attachment.originalType} attachment)
      </span>
    );
  const resolved = url;
  if (!resolved)
    return (
      <span>
        {attachment.name} ({error ? "preview unavailable" : "loading"})
      </span>
    );
  if (attachment.type === "file")
    return (
      <a href={resolved} download={attachment.name}>
        {attachment.name}
      </a>
    );
  return (
    <button
      type="button"
      onClick={() => onImageExpand?.(resolved, attachment.name)}
      aria-label={`Expand ${attachment.name}`}
    >
      <img
        src={resolved}
        alt={attachment.name}
        loading="lazy"
        className="max-h-64 rounded-md object-contain"
      />
    </button>
  );
}

export function ChatMarkdownMedia({ src, alt, cwd }: { src: string; alt: string; cwd?: string }) {
  const context = useContext(MediaContext);
  const source = classifyChatMediaSource(src, cwd);
  const { url, error } = useAuthorizedChatMedia(
    context?.baseUrl ?? null,
    context && source.kind === "file"
      ? {
          _tag: "media-file",
          threadId: ThreadId.makeUnsafe(context.threadId),
          path: source.value,
        }
      : null,
  );
  if (source.kind === "external")
    return (
      <a href={source.value} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">
        {alt || "External media"} (open external media)
      </a>
    );
  const resolved = source.kind === "direct" ? source.value : url;
  if (!resolved)
    return (
      <span>
        {alt || src} (
        {error || source.kind === "blocked" || !context?.baseUrl
          ? "media unavailable"
          : "loading media"}
        )
      </span>
    );
  const path = src.split(/[?#]/)[0]!;
  if (/\.(mp4|webm|mov|m4v)$/i.test(path))
    return (
      <video
        src={resolved}
        controls
        preload="metadata"
        aria-label={alt}
        className="max-h-96 max-w-full"
      />
    );
  if (/\.(mp3|wav|ogg|m4a|flac)$/i.test(path))
    return <audio src={resolved} controls preload="metadata" aria-label={alt} />;
  if (/\.(pdf|html?)$/i.test(path))
    return <span>{alt || src} (inline document preview unsupported)</span>;
  return (
    <img src={resolved} alt={alt} loading="lazy" className="max-h-96 max-w-full object-contain" />
  );
}
