import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The composer's plus menu: sources and modes as icon + name + description rows,
 * with a single highlight that glides to whichever row is active.
 *
 * Geometry and motion follow the reference composer this was modelled on: a
 * 10px panel that pops up from its bottom edge, 36px rows, and one highlight
 * that eases between them rather than each row lighting up on its own.
 *
 * The highlight follows an active index rather than the pointer alone, so the
 * arrow keys move it exactly as hovering does — which is why this does not use
 * the pointer-only GlideMenu primitive. The search field lives in the menu
 * itself, so this is a plain panel rather than a Base UI menu, whose own
 * typeahead would swallow what you type.
 */

/** The reference's glide curve, shared by the highlight and the pop-in. */
const GLIDE_EASE = "cubic-bezier(0.23,1,0.32,1)";

export interface ComposerSourceRow {
  key: string;
  name: string;
  /** Muted text after the name; omitted for rows whose name says everything. */
  description?: string;
  icon?: ReactNode;
  /** Right-aligned state, e.g. "On" for an active mode or "Soon" for a source we have not built. */
  status?: string;
  statusTone?: "positive" | "muted";
  disabled?: boolean;
  title?: string;
  onSelect: () => void;
}

export interface ComposerSourceSection {
  key: string;
  rows: ComposerSourceRow[];
}

function matchesQuery(row: ComposerSourceRow, query: string): boolean {
  if (!query) return true;
  const haystack = `${row.name} ${row.description ?? ""}`.toLowerCase();
  return haystack.includes(query);
}

export function ComposerSourceMenu({
  sections,
  onClose,
  className,
}: {
  sections: ComposerSourceSection[];
  onClose: () => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [engaged, setEngaged] = useState(false);
  const [highlight, setHighlight] = useState<{ top: number; height: number } | null>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const normalizedQuery = query.trim().toLowerCase();
  const visibleSections = useMemo(
    () =>
      sections
        .map((section) => ({
          ...section,
          rows: section.rows.filter((row) => matchesQuery(row, normalizedQuery)),
        }))
        .filter((section) => section.rows.length > 0),
    [normalizedQuery, sections],
  );
  const flatRows = useMemo(
    () => visibleSections.flatMap((section) => section.rows),
    [visibleSections],
  );
  const selectableIndexes = useMemo(
    () => flatRows.map((row, index) => (row.disabled ? -1 : index)).filter((index) => index >= 0),
    [flatRows],
  );

  useEffect(() => {
    setActive(selectableIndexes[0] ?? 0);
    setEngaged(false);
  }, [normalizedQuery, selectableIndexes]);

  useLayoutEffect(() => {
    const target = rowRefs.current[active];
    if (target) setHighlight({ top: target.offsetTop, height: target.offsetHeight });
  }, [active, flatRows.length, normalizedQuery]);

  const step = (offset: number) => {
    if (selectableIndexes.length === 0) return;
    const current = selectableIndexes.indexOf(active);
    const next = (current + offset + selectableIndexes.length) % selectableIndexes.length;
    const nextIndex = selectableIndexes[next] ?? 0;
    setActive(nextIndex);
    setEngaged(true);
    rowRefs.current[nextIndex]?.scrollIntoView({ block: "nearest" });
  };

  const pick = (row: ComposerSourceRow | undefined) => {
    if (!row || row.disabled) return;
    row.onSelect();
    onClose();
  };

  let rowIndex = -1;

  return (
    <div
      data-composer-source-menu="true"
      className={cn(
        "absolute bottom-[calc(100%+8px)] left-0 z-50 w-[min(26rem,100%)] origin-bottom overflow-hidden rounded-[10px] border border-border/60 bg-[var(--assistant-composer-surface)] p-1 shadow-2xl dark:border-white/[0.08]",
        "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-1 duration-[180ms] motion-reduce:animate-none",
        className,
      )}
      style={{ animationTimingFunction: GLIDE_EASE }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          step(event.key === "ArrowDown" ? 1 : -1);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          pick(flatRows[active]);
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="relative max-h-72 overflow-y-auto" onMouseLeave={() => setEngaged(false)}>
        {/* one highlight for the whole list, gliding between rows */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-accent motion-reduce:transition-none"
          style={{
            top: highlight?.top ?? 0,
            height: highlight?.height ?? 0,
            opacity: highlight && engaged && flatRows.length > 0 ? 1 : 0,
            transition: `top 220ms ${GLIDE_EASE}, height 220ms ${GLIDE_EASE}, opacity 150ms ease`,
          }}
        />
        {visibleSections.map((section, sectionIndex) => (
          <div key={section.key}>
            {sectionIndex > 0 ? <div className="my-1 border-t border-border/60" /> : null}
            {section.rows.map((row) => {
              rowIndex += 1;
              const index = rowIndex;
              return (
                <button
                  key={row.key}
                  type="button"
                  ref={(element) => {
                    rowRefs.current[index] = element;
                  }}
                  disabled={row.disabled}
                  title={row.title}
                  aria-label={row.description ? `${row.name} — ${row.description}` : row.name}
                  onMouseEnter={() => {
                    if (row.disabled) return;
                    setActive(index);
                    setEngaged(true);
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pick(row)}
                  className={cn(
                    "relative z-10 flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2 text-left outline-none",
                    row.disabled ? "cursor-default opacity-50" : "cursor-pointer",
                  )}
                >
                  {row.icon ? (
                    <span className="flex size-5.5 shrink-0 items-center justify-center text-muted-foreground">
                      {row.icon}
                    </span>
                  ) : null}
                  <span className="shrink-0 text-[12.5px] font-medium text-foreground">
                    {row.name}
                  </span>
                  {row.description ? (
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {row.description}
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1" />
                  )}
                  {row.status ? (
                    <span
                      className={cn(
                        "shrink-0 text-xs font-medium",
                        row.statusTone === "positive" ? "text-success" : "text-muted-foreground",
                      )}
                    >
                      {row.status}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
        {flatRows.length === 0 ? (
          <div className="flex h-9 items-center px-2 text-xs text-muted-foreground">
            No matches for “{query.trim()}”
          </div>
        ) : null}
      </div>

      <div className="mt-1 border-t border-border/60 px-2 pb-1 pt-1.5">
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Type to search sources & files"
          aria-label="Search sources and files"
          className="h-4 w-full bg-transparent text-caption text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}
