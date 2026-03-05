"use client";

import {
  Artifact,
  ArtifactHeader,
  ArtifactTitle,
  ArtifactDescription,
  ArtifactActions,
  ArtifactAction,
  ArtifactClose,
  ArtifactContent,
  CodeArtifact,
  DocumentArtifact,
} from "@/components/ai-elements/artifact";
import { CodeBlock } from "@/components/ai-elements/code-block";
import {
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  Maximize2Icon,
} from "lucide-react";
import { useCallback } from "react";

export type ArtifactType = "code" | "document" | "data" | "image" | "html";

export interface ArtifactDisplayProps {
  /** Artifact title */
  title: string;
  /** Optional description */
  description?: string;
  /** Artifact content */
  content: string;
  /** Type of artifact */
  type: ArtifactType;
  /** Programming language (for code artifacts) */
  language?: string;
  /** Callback when artifact is closed */
  onClose?: () => void;
  /** Callback to open in expanded view */
  onExpand?: () => void;
  /** Optional className for styling */
  className?: string;
}

/**
 * Displays generated content as an artifact with copy/download actions.
 *
 * @example
 * ```tsx
 * <ArtifactDisplay
 *   title="api-routes.ts"
 *   type="code"
 *   language="typescript"
 *   content={generatedCode}
 *   onClose={() => setArtifact(null)}
 * />
 * ```
 */
export function ArtifactDisplay({
  title,
  description,
  content,
  type,
  language,
  onClose,
  onExpand,
  className,
}: ArtifactDisplayProps) {
  // Copy content to clipboard
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [content]);

  // Download content as file
  const handleDownload = useCallback(() => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = title.includes(".") ? title : `${title}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [content, title]);

  // Open in new window (for HTML artifacts)
  const handleOpenInNewWindow = useCallback(() => {
    if (type === "html") {
      const newWindow = window.open("", "_blank");
      if (newWindow) {
        newWindow.document.write(content);
        newWindow.document.close();
      }
    }
  }, [content, type]);

  // Generate description based on content
  const displayDescription =
    description ??
    (type === "code" && language
      ? `${language} • ${content.split("\n").length} lines`
      : undefined);

  // Render code artifact
  if (type === "code") {
    return (
      <CodeArtifact
        title={title}
        language={language}
        lineCount={content.split("\n").length}
        onCopy={handleCopy}
        onDownload={handleDownload}
        onClose={onClose}
        className={className}
      >
        <CodeBlock
          code={content}
          language={language ?? "text"}
          className="[--codeblock-surface:var(--tool-surface)] [--codeblock-foreground:var(--tool-surface-foreground)] border-0 rounded-none"
        />
      </CodeArtifact>
    );
  }

  // Render document artifact
  if (type === "document") {
    return (
      <DocumentArtifact
        title={title}
        onCopy={handleCopy}
        onDownload={handleDownload}
        onClose={onClose}
        className={className}
      >
        <div className="prose prose-sm dark:prose-invert max-w-none">
          {content}
        </div>
      </DocumentArtifact>
    );
  }

  // Render HTML artifact with preview option
  if (type === "html") {
    return (
      <Artifact className={className}>
        <ArtifactHeader>
          <ArtifactTitle>{title}</ArtifactTitle>
          {displayDescription && (
            <ArtifactDescription>{displayDescription}</ArtifactDescription>
          )}
          <ArtifactActions>
            <ArtifactAction
              icon={ExternalLinkIcon}
              tooltip="Open in new window"
              onClick={handleOpenInNewWindow}
            />
            <ArtifactAction
              icon={CopyIcon}
              tooltip="Copy"
              onClick={handleCopy}
            />
            <ArtifactAction
              icon={DownloadIcon}
              tooltip="Download"
              onClick={handleDownload}
            />
            {onExpand && (
              <ArtifactAction
                icon={Maximize2Icon}
                tooltip="Expand"
                onClick={onExpand}
              />
            )}
            {onClose && <ArtifactClose onClick={onClose} />}
          </ArtifactActions>
        </ArtifactHeader>
        <ArtifactContent>
          <CodeBlock code={content} language="html" />
        </ArtifactContent>
      </Artifact>
    );
  }

  // Default: render as generic artifact
  return (
    <Artifact className={className}>
      <ArtifactHeader>
        <ArtifactTitle>{title}</ArtifactTitle>
        {displayDescription && (
          <ArtifactDescription>{displayDescription}</ArtifactDescription>
        )}
        <ArtifactActions>
          <ArtifactAction
            icon={CopyIcon}
            tooltip="Copy"
            onClick={handleCopy}
          />
          <ArtifactAction
            icon={DownloadIcon}
            tooltip="Download"
            onClick={handleDownload}
          />
          {onExpand && (
            <ArtifactAction
              icon={Maximize2Icon}
              tooltip="Expand"
              onClick={onExpand}
            />
          )}
          {onClose && <ArtifactClose onClick={onClose} />}
        </ArtifactActions>
      </ArtifactHeader>
      <ArtifactContent className="p-4">
        <pre className="whitespace-pre-wrap text-sm">{content}</pre>
      </ArtifactContent>
    </Artifact>
  );
}

// Re-export components for convenience
export {
  Artifact,
  ArtifactHeader,
  ArtifactTitle,
  ArtifactDescription,
  ArtifactActions,
  ArtifactAction,
  ArtifactClose,
  ArtifactContent,
  CodeArtifact,
  DocumentArtifact,
};

export default ArtifactDisplay;
