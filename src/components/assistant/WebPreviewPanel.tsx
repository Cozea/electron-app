"use client";

import {
  WebPreview,
  WebPreviewNavigation,
  WebPreviewNavigationButton,
  WebPreviewUrl,
  WebPreviewBody,
  WebPreviewConsole,
  type ConsoleLogEntry,
} from "@/components/ai-elements/web-preview";
import { Loader } from "@/components/ai-elements/loader";
import { useState, useCallback } from "react";

export interface WebPreviewPanelProps {
  /** Initial URL to load */
  initialUrl?: string;
  /** HTML content to preview (alternative to URL) */
  htmlContent?: string;
  /** Callback when URL changes */
  onUrlChange?: (url: string) => void;
  /** Optional className */
  className?: string;
  /** Height of the preview panel */
  height?: string | number;
}

/**
 * Live web preview panel with navigation controls.
 * Can display either a URL or raw HTML content in a sandboxed iframe.
 *
 * @example
 * ```tsx
 * // Preview a URL
 * <WebPreviewPanel initialUrl="https://example.com" />
 *
 * // Preview generated HTML
 * <WebPreviewPanel
 *   htmlContent="<h1>Hello World</h1><p>Generated content</p>"
 * />
 * ```
 */
export function WebPreviewPanel({
  initialUrl,
  htmlContent,
  onUrlChange,
  className,
  height = 400,
}: WebPreviewPanelProps) {
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLogEntry[]>([]);

  // Handler to add console logs (can be connected to iframe message events)
  const _addConsoleLog = useCallback(
    (level: ConsoleLogEntry["level"], message: string) => {
      setConsoleLogs((prev) => [
        ...prev,
        { level, message, timestamp: new Date() },
      ]);
    },
    []
  );

  // Clear console logs
  const _clearConsole = useCallback(() => {
    setConsoleLogs([]);
  }, []);

  // These are available for future use with iframe message events
  void _addConsoleLog;
  void _clearConsole;

  return (
    <WebPreview
      defaultUrl={initialUrl}
      onUrlChange={onUrlChange}
      className={className}
      style={{ height: typeof height === "number" ? `${height}px` : height }}
    >
      <WebPreviewNavigation>
        <WebPreviewNavigationButton action="back" />
        <WebPreviewNavigationButton action="forward" />
        <WebPreviewNavigationButton action="refresh" />
        <WebPreviewUrl />
        <WebPreviewNavigationButton action="external" />
      </WebPreviewNavigation>
      <WebPreviewBody
        htmlContent={htmlContent}
        loading={<Loader className="size-8" />}
      />
      <WebPreviewConsole logs={consoleLogs} />
    </WebPreview>
  );
}

// Re-export components for custom usage
export {
  WebPreview,
  WebPreviewNavigation,
  WebPreviewNavigationButton,
  WebPreviewUrl,
  WebPreviewBody,
  WebPreviewConsole,
  type ConsoleLogEntry,
};

export default WebPreviewPanel;
