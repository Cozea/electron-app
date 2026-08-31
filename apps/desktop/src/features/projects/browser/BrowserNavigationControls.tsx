import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon as __ArrowLeftHugeIcon,
  ArrowRight01Icon as __ArrowRightHugeIcon,
  LinkSquare02Icon as __ExternalLinkHugeIcon,
  LockIcon as __LockHugeIcon,
  Refresh01Icon as __RefreshHugeIcon,
} from "@hugeicons/core-free-icons";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkbenchDockRuntime } from "@/features/projects/components/workbench/WorkbenchDockRuntimeContext";
import {
  BROWSER_FOCUS_URL_EVENT,
  isExternallyOpenableBrowserUrl,
} from "@/features/projects/browser/urlInput";
import {
  selectProjectWorkbench,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore";
import { cn } from "@/lib/utils";

import { browserAddressDisplayValue, resolveBrowserAddressSubmission } from "./browserAddressState";
import { useBrowserFindUiStore } from "./browserFindUiStore";
import { browserSurfaceRuntimeTabId } from "./browserSurfaceIdentity";
import { useBrowserSurfaceStateStore } from "./browserSurfaceStateStore";

interface BrowserNavigationControlsProps {
  readonly tileId: string;
}

const NOOP = () => undefined;

function currentSurfaceUrl(
  fallback: string,
  state: ReturnType<typeof useBrowserSurfaceStateStore.getState>["byTabId"][string] | undefined,
): string {
  return state && state.navStatus.kind !== "Idle" ? state.navStatus.url : fallback;
}

export function BrowserNavigationControls({ tileId }: BrowserNavigationControlsProps) {
  const runtime = useWorkbenchDockRuntime();
  const actions = useProjectWorkbenchStore((state) => state.actions);
  const tile = useProjectWorkbenchStore((state) => {
    const workbench = selectProjectWorkbench(
      runtime.projectId,
      runtime.laneId,
      runtime.workspaceId,
    )(state);
    const candidate = workbench?.tiles[tileId];
    return candidate?.type === "browser" ? candidate : null;
  });
  const runtimeTabId = browserSurfaceRuntimeTabId({
    projectId: runtime.projectId,
    laneId: runtime.laneId,
    workspaceId: runtime.workspaceId,
    workbenchSessionKey: runtime.workbenchSessionKey,
    tileId,
    kind: "browser",
  });
  const state = useBrowserSurfaceStateStore((store) => store.byTabId[runtimeTabId]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const committedUrl = currentSurfaceUrl(tile?.url ?? "", state);
  const [draft, setDraft] = useState(committedUrl);
  const [inputFocused, setInputFocused] = useState(false);
  const preview = window.desktopBridge?.preview;
  const hasWebContents = Boolean(state?.webContentsId);
  const loading = state?.navStatus.kind === "Loading";

  const callTab = (operation: (tabId: string) => Promise<void>) => {
    if (!hasWebContents) return;
    void operation(runtimeTabId).catch(() => undefined);
  };
  const focusAddress = () => {
    inputRef.current?.focus();
    queueMicrotask(() => inputRef.current?.select());
  };
  const toggleFind = () => {
    if (!hasWebContents) return;
    useBrowserFindUiStore.getState().toggle(runtimeTabId);
  };
  const submit = (event?: FormEvent | KeyboardEvent) => {
    event?.preventDefault();
    if (!tile || !preview) return;
    const normalized = resolveBrowserAddressSubmission(draft);
    if (!normalized) return;
    actions.updateBrowserTile(
      runtime.projectId,
      runtime.laneId,
      tile.id,
      { url: normalized },
      runtime.workspaceId,
    );
    void preview.navigate(runtimeTabId, normalized).catch(() => undefined);
    inputRef.current?.blur();
  };

  useEffect(() => {
    const handleFocusRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ tileId?: string }>).detail;
      if (detail?.tileId === tileId) focusAddress();
    };
    window.addEventListener(BROWSER_FOCUS_URL_EVENT, handleFocusRequest);
    return () => window.removeEventListener(BROWSER_FOCUS_URL_EVENT, handleFocusRequest);
  }, [tileId]);

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "l") {
        event.preventDefault();
        focusAddress();
      } else if (key === "r" && preview) {
        event.preventDefault();
        callTab(event.shiftKey ? preview.hardReload : preview.refresh);
      } else if (key === "f") {
        event.preventDefault();
        toggleFind();
      } else if ((key === "+" || key === "=") && preview) {
        event.preventDefault();
        callTab(preview.zoomIn);
      } else if (key === "-" && preview) {
        event.preventDefault();
        callTab(preview.zoomOut);
      } else if (key === "0" && preview) {
        event.preventDefault();
        callTab(preview.resetZoom);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [hasWebContents, preview, runtimeTabId]);

  if (!tile) return null;
  const externalUrl = isExternallyOpenableBrowserUrl(committedUrl) ? committedUrl : null;
  const favicon = state?.favicon?.dataUrl ?? tile.favicon;
  const navButtonClass =
    "h-7 w-7 shrink-0 rounded-md border border-transparent text-muted-foreground";

  return (
    <form
      onSubmit={submit}
      className="cozea-workbench-header-controls flex h-full min-w-0 items-center gap-1 px-1"
    >
      <div className="flex items-center gap-0.5" role="group" aria-label="Navigation">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={navButtonClass}
              disabled={!state?.canGoBack}
              onClick={state?.canGoBack && preview ? () => callTab(preview.goBack) : NOOP}
              aria-label="Back"
            >
              <HugeiconsIcon icon={__ArrowLeftHugeIcon} className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Back</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={navButtonClass}
              disabled={!state?.canGoForward}
              onClick={state?.canGoForward && preview ? () => callTab(preview.goForward) : NOOP}
              aria-label="Forward"
            >
              <HugeiconsIcon icon={__ArrowRightHugeIcon} className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Forward</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={navButtonClass}
              disabled={!hasWebContents}
              onClick={preview ? () => callTab(preview.refresh) : NOOP}
              aria-label={loading ? "Loading" : "Reload"}
            >
              <HugeiconsIcon
                icon={__RefreshHugeIcon}
                className={cn("size-3.5", loading && "animate-spin")}
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{loading ? "Loading…" : "Reload"}</TooltipContent>
        </Tooltip>
      </div>

      <div
        className="group/address flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md bg-muted/45 px-2 focus-within:bg-background focus-within:ring-1 focus-within:ring-ring/50"
        data-browser-address-group
      >
        {favicon ? (
          <img src={favicon} alt="" className="size-3.5 shrink-0 rounded-sm object-contain" />
        ) : committedUrl.startsWith("https://") ? (
          <HugeiconsIcon
            icon={__LockHugeIcon}
            className="size-3.5 shrink-0 text-muted-foreground/70"
          />
        ) : null}
        <Input
          ref={inputRef}
          value={browserAddressDisplayValue({ committedUrl, draft, focused: inputFocused })}
          onChange={(event) => setDraft(event.target.value)}
          onFocus={() => {
            setDraft(committedUrl);
            setInputFocused(true);
            queueMicrotask(() => inputRef.current?.select());
          }}
          onBlur={() => setInputFocused(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit(event);
            if (event.key === "Escape") {
              event.preventDefault();
              setDraft(committedUrl);
              inputRef.current?.blur();
            }
          }}
          placeholder="Search or enter address"
          spellCheck={false}
          className="h-full min-w-0 flex-1 border-0 bg-transparent px-0 text-xs font-normal shadow-none outline-none focus-visible:ring-0 dark:bg-transparent"
          data-browser-url-input
        />
        {externalUrl && !inputFocused ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="opacity-0 transition-opacity group-hover/address:opacity-100"
                onClick={() => void window.electronAPI.shell.openExternal(externalUrl)}
                aria-label="Open in system browser"
              >
                <HugeiconsIcon icon={__ExternalLinkHugeIcon} className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open in system browser</TooltipContent>
          </Tooltip>
        ) : null}
      </div>

    </form>
  );
}
