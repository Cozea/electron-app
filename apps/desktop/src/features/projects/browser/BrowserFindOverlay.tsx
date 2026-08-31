import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { useBrowserFindUiStore } from "./browserFindUiStore";
import { useBrowserSurfaceStateStore } from "./browserSurfaceStateStore";

export function BrowserFindOverlay({ runtimeTabId }: { readonly runtimeTabId: string }) {
  const preview = window.desktopBridge?.preview;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const visible = useBrowserFindUiStore((store) => store.visibleByTabId[runtimeTabId] ?? false);
  const findState = useBrowserSurfaceStateStore((store) => store.byTabId[runtimeTabId]?.find);
  const [query, setQuery] = useState(findState?.query ?? "");

  useEffect(() => {
    if (!visible) return;
    setQuery(findState?.query ?? "");
    queueMicrotask(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [findState?.query, visible]);

  const close = () => {
    useBrowserFindUiStore.getState().setVisible(runtimeTabId, false);
    void preview?.stopFindInPage(runtimeTabId, "keepSelection").catch(() => undefined);
  };
  const find = (nextQuery: string, forward = true, findNext = false) => {
    setQuery(nextQuery);
    void preview?.findInPage(runtimeTabId, nextQuery, { forward, findNext }).catch(() => undefined);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Enter") {
      event.preventDefault();
      find(query, !event.shiftKey, true);
    }
  };

  if (!visible) return null;
  const matchLabel = findState?.matches
    ? `${findState.activeMatchOrdinal} of ${findState.matches}`
    : query.trim()
      ? "0 of 0"
      : "";

  return (
    <div className="absolute right-3 top-3 z-50 flex h-9 items-center gap-1 rounded-lg border border-border bg-popover p-1 shadow-lg">
      <HugeiconsIcon icon={Search01Icon} className="ml-1 size-3.5 text-muted-foreground" />
      <Input
        ref={inputRef}
        value={query}
        onChange={(event) => find(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in page"
        className="h-7 w-48 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
        aria-label="Find in page"
      />
      <span className="min-w-12 text-center text-[11px] tabular-nums text-muted-foreground">
        {matchLabel}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={!query.trim()}
        onClick={() => find(query, false, true)}
        aria-label="Previous match"
      >
        ↑
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={!query.trim()}
        onClick={() => find(query, true, true)}
        aria-label="Next match"
      >
        ↓
      </Button>
      <Button type="button" variant="ghost" size="icon-xs" onClick={close} aria-label="Close find">
        <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
      </Button>
    </div>
  );
}
