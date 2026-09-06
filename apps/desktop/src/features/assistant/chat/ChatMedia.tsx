import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ThreadId } from "@cozea/assistant-contracts";
import { useAuthorizedChatMedia } from "./useAuthorizedChatMedia";
import { classifyChatMediaSource } from "./chatMediaSource";
import type { ChatAttachment } from "@/features/assistant/model/types";
import { cn } from "@/lib/utils";

const MediaContext = createContext<{ threadId: string; baseUrl: string | null } | null>(null);
const MAX_REMEMBERED_MEDIA_REVEALS = 512;
const revealedMarkdownMedia = new Set<string>();

function rememberMarkdownMediaReveal(key: string) {
  revealedMarkdownMedia.add(key);
  if (revealedMarkdownMedia.size <= MAX_REMEMBERED_MEDIA_REVEALS) return;
  const oldest = revealedMarkdownMedia.values().next().value;
  if (typeof oldest === "string") revealedMarkdownMedia.delete(oldest);
}

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
  const [revealedSrc, setRevealedSrc] = useState<string | null>(() =>
    revealedMarkdownMedia.has(src) ? src : null,
  );
  const revealFrameRef = useRef<number | null>(null);
  const mediaRevealed = revealedSrc === src || revealedMarkdownMedia.has(src);

  useEffect(() => {
    if (revealFrameRef.current !== null) {
      window.cancelAnimationFrame(revealFrameRef.current);
      revealFrameRef.current = null;
    }
  }, [src]);

  useEffect(
    () => () => {
      if (revealFrameRef.current !== null) {
        window.cancelAnimationFrame(revealFrameRef.current);
      }
    },
    [],
  );

  const revealMedia = useCallback(() => {
    if (revealedMarkdownMedia.has(src)) {
      setRevealedSrc(src);
      return;
    }
    if (revealFrameRef.current !== null) {
      window.cancelAnimationFrame(revealFrameRef.current);
    }
    // The intrinsic size is known at this point. Start from a one-pixel layout
    // footprint, then let Chromium interpolate to `auto` so LegendList observes
    // one continuous size change instead of a single large late reflow. Keep the
    // source in state so a stale frame from an older src cannot reveal a new one.
    revealFrameRef.current = window.requestAnimationFrame(() => {
      revealFrameRef.current = null;
      rememberMarkdownMediaReveal(src);
      setRevealedSrc(src);
    });
  }, [src]);

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
        onLoadedMetadata={revealMedia}
        className={cn(
          "max-h-96 max-w-full [interpolate-size:allow-keywords] transition-[height,opacity] duration-200 ease-out motion-reduce:transition-none",
          mediaRevealed ? "h-auto opacity-100" : "h-px opacity-0",
        )}
      />
    );
  if (/\.(mp3|wav|ogg|m4a|flac)$/i.test(path))
    return <audio src={resolved} controls preload="metadata" aria-label={alt} />;
  if (/\.(pdf|html?)$/i.test(path))
    return <span>{alt || src} (inline document preview unsupported)</span>;
  return (
    <img
      src={resolved}
      alt={alt}
      loading="lazy"
      onLoad={revealMedia}
      className={cn(
        "max-h-96 max-w-full object-contain [interpolate-size:allow-keywords] transition-[height,opacity] duration-200 ease-out motion-reduce:transition-none",
        mediaRevealed ? "h-auto opacity-100" : "h-px opacity-0",
      )}
    />
  );
}
