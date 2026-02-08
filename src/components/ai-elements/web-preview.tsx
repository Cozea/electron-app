"use client";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  Maximize2Icon,
  RefreshCwIcon,
  TerminalIcon,
} from "lucide-react";
import type { ComponentProps, HTMLAttributes, ReactNode } from "react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

/**
 * Console log entry
 */
export interface ConsoleLogEntry {
  level: "log" | "warn" | "error" | "info";
  message: string;
  timestamp: Date;
}

type WebPreviewContextValue = {
  url: string;
  setUrl: (url: string) => void;
  history: string[];
  historyIndex: number;
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
  refresh: () => void;
  refreshKey: number;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
};

const WebPreviewContext = createContext<WebPreviewContextValue | null>(null);

export const useWebPreview = () => {
  const context = useContext(WebPreviewContext);
  if (!context) {
    throw new Error("WebPreview components must be used within WebPreview");
  }
  return context;
};

export type WebPreviewProps = HTMLAttributes<HTMLDivElement> & {
  /** Default URL to load */
  defaultUrl?: string;
  /** Callback when URL changes */
  onUrlChange?: (url: string) => void;
};

/**
 * Container for web preview with navigation and sandboxed iframe.
 *
 * @example
 * ```tsx
 * <WebPreview defaultUrl="https://example.com">
 *   <WebPreviewNavigation>
 *     <WebPreviewNavigationButton action="back" />
 *     <WebPreviewNavigationButton action="forward" />
 *     <WebPreviewNavigationButton action="refresh" />
 *     <WebPreviewUrl />
 *   </WebPreviewNavigation>
 *   <WebPreviewBody />
 *   <WebPreviewConsole logs={consoleLogs} />
 * </WebPreview>
 * ```
 */
export const WebPreview = memo(
  ({
    className,
    defaultUrl = "",
    onUrlChange,
    children,
    ...props
  }: WebPreviewProps) => {
    const [url, setUrlState] = useState(defaultUrl);
    const [history, setHistory] = useState<string[]>([defaultUrl]);
    const [historyIndex, setHistoryIndex] = useState(0);
    const [refreshKey, setRefreshKey] = useState(0);
    const iframeRef = useRef<HTMLIFrameElement>(null);

    const setUrl = useCallback(
      (newUrl: string) => {
        setUrlState(newUrl);
        setHistory((prev) => [...prev.slice(0, historyIndex + 1), newUrl]);
        setHistoryIndex((prev) => prev + 1);
        onUrlChange?.(newUrl);
      },
      [historyIndex, onUrlChange]
    );

    const canGoBack = historyIndex > 0;
    const canGoForward = historyIndex < history.length - 1;

    const goBack = useCallback(() => {
      if (canGoBack) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setUrlState(history[newIndex]);
        onUrlChange?.(history[newIndex]);
      }
    }, [canGoBack, historyIndex, history, onUrlChange]);

    const goForward = useCallback(() => {
      if (canGoForward) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setUrlState(history[newIndex]);
        onUrlChange?.(history[newIndex]);
      }
    }, [canGoForward, historyIndex, history, onUrlChange]);

    const refresh = useCallback(() => {
      setRefreshKey((prev) => prev + 1);
    }, []);

    return (
      <WebPreviewContext.Provider
        value={{
          url,
          setUrl,
          history,
          historyIndex,
          canGoBack,
          canGoForward,
          goBack,
          goForward,
          refresh,
          refreshKey,
          iframeRef,
        }}
      >
        <div
          className={cn(
            "flex flex-col overflow-hidden rounded-lg border bg-card",
            className
          )}
          {...props}
        >
          {children}
        </div>
      </WebPreviewContext.Provider>
    );
  }
);

WebPreview.displayName = "WebPreview";

export type WebPreviewNavigationProps = HTMLAttributes<HTMLDivElement>;

/**
 * Navigation bar with controls and URL input
 */
export const WebPreviewNavigation = memo(
  ({ className, children, ...props }: WebPreviewNavigationProps) => (
    <div
      className={cn(
        "flex items-center gap-1 border-b bg-muted/30 px-2 py-1.5",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
);

WebPreviewNavigation.displayName = "WebPreviewNavigation";

export type WebPreviewNavigationButtonProps = ComponentProps<typeof Button> & {
  /** Button action type */
  action?: "back" | "forward" | "refresh" | "fullscreen" | "external";
  /** Tooltip text */
  tooltip?: string;
};

/**
 * Navigation control button
 */
export const WebPreviewNavigationButton = memo(
  ({
    className,
    action,
    tooltip,
    children,
    ...props
  }: WebPreviewNavigationButtonProps) => {
    const { canGoBack, canGoForward, goBack, goForward, refresh, url } =
      useWebPreview();

    // Determine icon and handler based on action
    let icon: ReactNode = children;
    let handler: (() => void) | undefined;
    let disabled = false;
    let tooltipText = tooltip;

    switch (action) {
      case "back":
        icon = <ArrowLeftIcon className="size-4" />;
        handler = goBack;
        disabled = !canGoBack;
        tooltipText = tooltip || "Go back";
        break;
      case "forward":
        icon = <ArrowRightIcon className="size-4" />;
        handler = goForward;
        disabled = !canGoForward;
        tooltipText = tooltip || "Go forward";
        break;
      case "refresh":
        icon = <RefreshCwIcon className="size-4" />;
        handler = refresh;
        tooltipText = tooltip || "Refresh";
        break;
      case "fullscreen":
        icon = <Maximize2Icon className="size-4" />;
        tooltipText = tooltip || "Fullscreen";
        break;
      case "external":
        icon = <ExternalLinkIcon className="size-4" />;
        handler = () => window.open(url, "_blank");
        tooltipText = tooltip || "Open in new tab";
        break;
    }

    const button = (
      <Button
        className={cn("size-7 p-0", className)}
        variant="ghost"
        size="icon"
        disabled={disabled}
        onClick={handler}
        {...props}
      >
        {icon}
      </Button>
    );

    if (!tooltipText) {
      return button;
    }

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>
            <p>{tooltipText}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
);

WebPreviewNavigationButton.displayName = "WebPreviewNavigationButton";

export type WebPreviewUrlProps = ComponentProps<typeof Input>;

/**
 * URL input field
 */
export const WebPreviewUrl = memo(
  ({ className, ...props }: WebPreviewUrlProps) => {
    const { url, setUrl } = useWebPreview();
    const [inputValue, setInputValue] = useState(url);

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      let newUrl = inputValue.trim();
      if (newUrl && !newUrl.startsWith("http")) {
        newUrl = `https://${newUrl}`;
      }
      setUrl(newUrl);
    };

    return (
      <form onSubmit={handleSubmit} className="flex-1">
        <Input
          className={cn(
            "h-7 rounded-full bg-background px-3 text-xs",
            className
          )}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Enter URL..."
          {...props}
        />
      </form>
    );
  }
);

WebPreviewUrl.displayName = "WebPreviewUrl";

export type WebPreviewBodyProps = HTMLAttributes<HTMLDivElement> & {
  /** Loading placeholder */
  loading?: ReactNode;
  /** HTML content to render (alternative to URL) */
  htmlContent?: string;
  /** Sandbox permissions */
  sandbox?: string;
};

/**
 * Sandboxed iframe for rendering preview content
 */
export const WebPreviewBody = memo(
  ({
    className,
    loading,
    htmlContent,
    sandbox = "allow-scripts allow-same-origin allow-forms allow-popups allow-presentation",
    ...props
  }: WebPreviewBodyProps) => {
    const { url, refreshKey, iframeRef } = useWebPreview();
    const [isLoading, setIsLoading] = useState(true);

    // Generate srcDoc from HTML content if provided
    const srcDoc = htmlContent
      ? `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${htmlContent}</body></html>`
      : undefined;

    return (
      <div
        className={cn("relative flex-1 bg-white", className)}
        {...props}
      >
        {isLoading && loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
            {loading}
          </div>
        )}
        <iframe
          ref={iframeRef}
          key={refreshKey}
          src={srcDoc ? undefined : url || "about:blank"}
          srcDoc={srcDoc}
          sandbox={sandbox}
          className="size-full border-0"
          onLoad={() => setIsLoading(false)}
          title="Web Preview"
        />
      </div>
    );
  }
);

WebPreviewBody.displayName = "WebPreviewBody";

export type WebPreviewConsoleProps = HTMLAttributes<HTMLDivElement> & {
  /** Console log entries */
  logs?: ConsoleLogEntry[];
  /** Default open state */
  defaultOpen?: boolean;
};

/**
 * Collapsible console output panel
 */
export const WebPreviewConsole = memo(
  ({
    className,
    logs = [],
    defaultOpen = false,
    ...props
  }: WebPreviewConsoleProps) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    if (logs.length === 0) {
      return null;
    }

    return (
      <Collapsible
        open={isOpen}
        onOpenChange={setIsOpen}
        className={cn("border-t", className)}
        {...props}
      >
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-muted/50">
          <div className="flex items-center gap-2">
            <TerminalIcon className="size-3.5" />
            <span>Console ({logs.length})</span>
          </div>
          <ChevronDownIcon
            className={cn(
              "size-3.5 transition-transform",
              isOpen && "rotate-180"
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="app-scrollbar max-h-32 overflow-auto bg-zinc-900 p-2 font-mono text-xs">
            {logs.map((log, index) => (
              <div
                key={index}
                className={cn(
                  "py-0.5",
                  log.level === "error" && "text-red-400",
                  log.level === "warn" && "text-yellow-400",
                  log.level === "info" && "text-blue-400",
                  log.level === "log" && "text-zinc-300"
                )}
              >
                <span className="text-zinc-500">
                  [{log.timestamp.toLocaleTimeString()}]
                </span>{" "}
                {log.message}
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }
);

WebPreviewConsole.displayName = "WebPreviewConsole";
