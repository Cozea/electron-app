import React, {
  Children,
  Suspense,
  isValidElement,
  useCallback,
  lazy,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckmarkCircle02Icon as __CheckIconHugeIcon, DocumentAttachmentIcon as __CopyIconHugeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useTheme } from "@/contexts/ThemeContext";
import { resolveAppliedTheme } from "@/lib/theme";
import {
  openProjectFileInExternalEditor,
  readStoredExternalEditorPreference,
} from "@/features/projects/lib/externalEditorPreference";
import { splitPathAndPosition } from "@/lib/terminalLinks";
import { openInPreferredEditor } from "@/stores/editorPreferences";
import {
  resolveDiffThemeName,
  type DiffThemeName,
} from "@/features/projects/components/assistant/lib/diffRendering";
import {
  resolveMarkdownFileLinkTarget,
  rewriteMarkdownFileUriHref,
} from "@/stores/markdown-links";
import { readNativeApi } from "@/lib/nativeApi";
import { cn } from "@/lib/utils";

class CodeHighlightErrorBoundary extends React.Component<
  { fallback: ReactNode; children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { fallback: ReactNode; children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  override render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

interface ChatMarkdownProps {
  text: string;
  cwd: string | undefined;
  isStreaming?: boolean
  /** Timeline assistant bubbles: match workbench sidebar body (`text-xs`). */
  variant?: "default" | "timeline"
}

const CODE_HIGHLIGHT_ROOT_MARGIN = "720px 0px";
const CODE_HIGHLIGHT_IDLE_TIMEOUT_MS = 1200;

const LazyChatCodeHighlighter = lazy(() =>
  import("./ChatCodeHighlighter").then((module) => ({
    default: module.ChatCodeHighlighter,
  })),
);

function nodeToPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => nodeToPlainText(child)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeToPlainText(node.props.children);
  }
  return "";
}

function extractCodeBlock(
  children: ReactNode,
): { className: string | undefined; code: string } | null {
  const childNodes = Children.toArray(children);
  if (childNodes.length !== 1) {
    return null;
  }

  const onlyChild = childNodes[0];
  if (
    !isValidElement<{ className?: string; children?: ReactNode }>(onlyChild) ||
    onlyChild.type !== "code"
  ) {
    return null;
  }

  return {
    className: onlyChild.props.className,
    code: nodeToPlainText(onlyChild.props.children),
  };
}

function MarkdownCodeBlock({ code, children }: { code: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopy = useCallback(() => {
    if (typeof navigator === "undefined" || navigator.clipboard == null) {
      return;
    }
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        if (copiedTimerRef.current != null) {
          clearTimeout(copiedTimerRef.current);
        }
        setCopied(true);
        copiedTimerRef.current = setTimeout(() => {
          setCopied(false);
          copiedTimerRef.current = null;
        }, 1200);
      })
      .catch(() => undefined);
  }, [code]);

  useEffect(
    () => () => {
      if (copiedTimerRef.current != null) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    },
    [],
  );

  return (
    <div className="chat-markdown-codeblock">
      <button
        type="button"
        className="chat-markdown-copy-button"
        onClick={handleCopy}
        title={copied ? "Copied" : "Copy code"}
        aria-label={copied ? "Copied" : "Copy code"}
      >
        {copied ? <HugeiconsIcon icon={__CheckIconHugeIcon} className="size-3" /> : <HugeiconsIcon icon={__CopyIconHugeIcon} className="size-3" />}
      </button>
      {children}
    </div>
  );
}

interface ViewportCodeHighlighterProps {
  className: string | undefined;
  code: string;
  fallback: ReactNode;
  themeName: DiffThemeName;
}

function ViewportCodeHighlighter({
  className,
  code,
  fallback,
  themeName,
}: ViewportCodeHighlighterProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    if (shouldLoad) return;

    const win = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;
    let observer: IntersectionObserver | null = null;
    let cancelled = false;

    const requestLoad = () => {
      if (cancelled) return;

      const load = () => {
        if (!cancelled) {
          setShouldLoad(true);
        }
      };

      if (win.requestIdleCallback) {
        idleHandle = win.requestIdleCallback(load, {
          timeout: CODE_HIGHLIGHT_IDLE_TIMEOUT_MS,
        });
        return;
      }

      timeoutHandle = window.setTimeout(load, 0);
    };

    const node = hostRef.current;
    if (!node || !("IntersectionObserver" in window)) {
      requestLoad();
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) {
            return;
          }
          observer?.disconnect();
          observer = null;
          requestLoad();
        },
        { rootMargin: CODE_HIGHLIGHT_ROOT_MARGIN },
      );
      observer.observe(node);
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
      if (idleHandle !== null) {
        win.cancelIdleCallback?.(idleHandle);
      }
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
      }
    };
  }, [shouldLoad]);

  return (
    <div ref={hostRef} className="chat-markdown-code-highlight-host">
      {shouldLoad ? (
        <CodeHighlightErrorBoundary fallback={fallback}>
          <Suspense fallback={fallback}>
            <LazyChatCodeHighlighter
              className={className}
              code={code}
              themeName={themeName}
            />
          </Suspense>
        </CodeHighlightErrorBoundary>
      ) : (
        fallback
      )}
    </div>
  );
}

function ChatMarkdown({ text, cwd, isStreaming = false, variant = "default" }: ChatMarkdownProps) {
  const { theme } = useTheme();
  const appliedTheme = resolveAppliedTheme(theme);
  const diffThemeName = resolveDiffThemeName(appliedTheme === "light" ? "light" : "dark");
  const markdownUrlTransform = useCallback((href: string) => {
    return rewriteMarkdownFileUriHref(href) ?? defaultUrlTransform(href);
  }, []);
  const markdownComponents = useMemo<Components>(
    () => ({
      a({ node: _node, href, ...props }) {
        const targetPath = resolveMarkdownFileLinkTarget(href, cwd);
        if (!targetPath) {
          return <a {...props} href={href} target="_blank" rel="noreferrer" />;
        }

        return (
          <a
            {...props}
            href={href}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const { path, line: lineStr, column: columnStr } = splitPathAndPosition(targetPath);
              const line = lineStr ? Number.parseInt(lineStr, 10) : undefined;
              const column = columnStr ? Number.parseInt(columnStr, 10) : undefined;

              if (typeof window !== "undefined" && window.electronAPI?.editor) {
                void openProjectFileInExternalEditor({
                  filePath: path,
                  line: Number.isFinite(line) ? line : undefined,
                  column: Number.isFinite(column) ? column : undefined,
                  projectPath: cwd ?? null,
                  preferredEditorId: readStoredExternalEditorPreference(),
                }).then((result) => {
                  if (!result.success) {
                    console.warn(
                      "Unable to open markdown file link in external editor.",
                      result.error,
                    );
                  }
                });
                return;
              }

              const api = readNativeApi();
              if (api) {
                void openInPreferredEditor(api, targetPath);
              } else {
                console.warn("Native API not found. Unable to open file in editor.");
              }
            }}
          />
        );
      },
      pre({ node: _node, children, ...props }) {
        const codeBlock = extractCodeBlock(children);
        if (!codeBlock) {
          return <pre {...props}>{children}</pre>;
        }
        const plainCodeBlock = <pre {...props}>{children}</pre>;

        return (
          <MarkdownCodeBlock code={codeBlock.code}>
            {isStreaming ? (
              plainCodeBlock
            ) : (
              <ViewportCodeHighlighter
                className={codeBlock.className}
                code={codeBlock.code}
                fallback={plainCodeBlock}
                themeName={diffThemeName}
              />
            )}
          </MarkdownCodeBlock>
        );
      },
    }),
    [cwd, diffThemeName, isStreaming],
  );

  return (
    <div
      className={cn(
        "chat-markdown w-full min-w-0 text-foreground/80",
        variant === "timeline" ? "text-xs leading-normal" : "text-sm leading-relaxed",
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={markdownComponents}
        urlTransform={markdownUrlTransform}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default memo(ChatMarkdown);
