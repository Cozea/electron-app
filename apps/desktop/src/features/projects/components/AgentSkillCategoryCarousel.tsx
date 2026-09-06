import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentSkillRecord } from "@shared/electronApiTypes";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon as __ArrowLeftHugeIcon,
  ArrowRight01Icon as __ArrowRightHugeIcon,
} from "@hugeicons/core-free-icons";

export interface AgentSkillCategoryGroup {
  category: string;
  label: string;
  skills: AgentSkillRecord[];
}

interface AgentSkillCategoryCarouselProps {
  groups: AgentSkillCategoryGroup[];
  renderSkill: (skill: AgentSkillRecord) => React.ReactNode;
}

/**
 * Which card sits under the middle of the viewport.
 *
 * Measured from geometry rather than tracked as state through the scroll
 * handler, so a programmatic scroll, a drag of the scrollbar and a wheel all
 * agree on the answer.
 */
export function findCenteredIndex(
  cardCenters: readonly number[],
  viewportCenter: number,
): number {
  if (cardCenters.length === 0) return 0;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  cardCenters.forEach((center, index) => {
    const distance = Math.abs(center - viewportCenter);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

const CARD_WIDTH_RATIO = 0.62;
const CARD_MAX_WIDTH = 960;
const CARD_MIN_WIDTH = 320;
const EDGE_INSET_MIN = 24;

/**
 * The card width, and the inset that leaves it centred.
 *
 * Both are derived from the track's own width rather than from each other. A
 * card sized as a percentage of the *content* box cannot be centred by padding,
 * because the padding then changes the width it is meant to be centring: solve
 * that and the only answer is a card of zero width. Measuring one step earlier,
 * from the track, breaks the circle.
 */
export function measureCarouselMetrics(trackWidth: number): {
  cardWidth: number;
  inset: number;
} {
  const cardWidth = Math.min(
    CARD_MAX_WIDTH,
    Math.max(CARD_MIN_WIDTH, trackWidth * CARD_WIDTH_RATIO),
  );
  return { cardWidth, inset: Math.max(EDGE_INSET_MIN, (trackWidth - cardWidth) / 2) };
}

/** Scroll offset that puts a card under the middle of the track. */
export function centeredScrollTarget(
  cardLeft: number,
  cardWidth: number,
  trackWidth: number,
): number {
  return Math.max(0, cardLeft - (trackWidth - cardWidth) / 2);
}

/**
 * Where the selection lands after the category list changes underneath it.
 *
 * Changing the Installed / Not installed filter rebuilds the groups, and
 * re-deriving the selection from scroll position made it drift to whichever
 * card happened to sit under the middle and then settle back. The selection
 * belongs to a *category*, so it follows that category to its new index and
 * only falls back to position when the category is gone entirely.
 */
export function reanchorCategoryIndex(
  categories: readonly string[],
  selected: string | null,
  previousIndex: number,
): number {
  if (categories.length === 0) return 0;
  const found = selected ? categories.indexOf(selected) : -1;
  if (found >= 0) return found;
  return Math.min(Math.max(previousIndex, 0), categories.length - 1);
}

export function AgentSkillCategoryCarousel({
  groups,
  renderSkill,
}: AgentSkillCategoryCarouselProps) {
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const cardRefs = React.useRef<Array<HTMLDivElement | null>>([]);
  const chipRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const chipRowRef = React.useRef<HTMLDivElement | null>(null);
  const chipScrollRef = React.useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = React.useState(false);
  const [canScrollRight, setCanScrollRight] = React.useState(false);
  const [indicator, setIndicator] = React.useState<{ left: number; width: number } | null>(null);

  const updateChipScroll = React.useCallback(() => {
    const el = chipScrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  React.useEffect(() => {
    updateChipScroll();
    const el = chipScrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateChipScroll);
    observer.observe(el);
    return () => observer.disconnect();
  }, [groups, updateChipScroll]);
  // The card a smooth scroll is heading for, so the cards it passes on the way
  // do not each become "selected" for a frame.
  const pendingIndexRef = React.useRef<number | null>(null);
  const activeCategoryRef = React.useRef<string | null>(null);
  const groupsRef = React.useRef(groups);
  groupsRef.current = groups;
  const [hasPlacedIndicator, setHasPlacedIndicator] = React.useState(false);
  const activeIndexRef = React.useRef(0);
  const [activeIndex, setActiveIndex] = React.useState(0);

  const [metrics, setMetrics] = React.useState(() => measureCarouselMetrics(960));

  React.useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => setMetrics(measureCarouselMetrics(track.clientWidth));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  const scrollTargetFor = React.useCallback((card: HTMLDivElement) => {
    const track = trackRef.current;
    if (!track) return 0;
    return centeredScrollTarget(card.offsetLeft, card.offsetWidth, track.clientWidth);
  }, []);

  const measureActive = React.useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const currentScroll = track.scrollLeft;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    cardRefs.current.forEach((card, index) => {
      if (!card) return;
      const dist = Math.abs(scrollTargetFor(card) - currentScroll);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestIndex = index;
      }
    });

    const pending = pendingIndexRef.current;
    if (pending !== null) {
      if (bestIndex !== pending) return;
      pendingIndexRef.current = null;
    }

    activeIndexRef.current = bestIndex;
    activeCategoryRef.current = groupsRef.current[bestIndex]?.category ?? null;
    setActiveIndex(bestIndex);
  }, [scrollTargetFor]);

  const scrollToIndex = React.useCallback((index: number) => {
    const track = trackRef.current;
    const clamped = Math.min(Math.max(index, 0), cardRefs.current.length - 1);
    const card = cardRefs.current[clamped];
    if (!track || !card) return;
    pendingIndexRef.current = clamped;
    activeIndexRef.current = clamped;
    activeCategoryRef.current = groupsRef.current[clamped]?.category ?? null;
    setActiveIndex(clamped);
    track.scrollTo({ left: scrollTargetFor(card), behavior: "smooth" });
  }, [scrollTargetFor]);

  // Re-anchor on the same category when the list changes, without a slide:
  // the categories moved, so animating between them would be meaningless.
  React.useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;

    const nextIndex = reanchorCategoryIndex(
      groups.map((group) => group.category),
      activeCategoryRef.current,
      activeIndexRef.current,
    );

    pendingIndexRef.current = null;
    activeIndexRef.current = nextIndex;
    activeCategoryRef.current = groups[nextIndex]?.category ?? null;
    setActiveIndex(nextIndex);
    setHasPlacedIndicator(false);

    const card = cardRefs.current[nextIndex];
    if (card) {
      track.scrollTo({ left: scrollTargetFor(card), behavior: "auto" });
    }
  }, [groups, scrollTargetFor]);

  /*
   * One pill slides between chips rather than each chip lighting up its own
   * background, so moving category reads as the selection travelling. Measured
   * from the chips themselves, so it stays aligned through a resize, a font
   * swap or a change in the category list.
   */
  React.useLayoutEffect(() => {
    const measure = () => {
      const chip = chipRefs.current[activeIndex];
      if (!chip) return;
      setIndicator({ left: chip.offsetLeft, width: chip.offsetWidth });
      // Animate only once it has a real position; otherwise the first paint
      // sweeps in from zero width.
      requestAnimationFrame(() => setHasPlacedIndicator(true));
    };
    measure();

    const row = chipRowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [activeIndex, groups]);

  // Keep the selected chip reachable when the row is wider than the page.
  React.useEffect(() => {
    chipRefs.current[activeIndex]?.scrollIntoView({
      // Instant while re-anchoring, so a filter change does not slide the row.
      behavior: hasPlacedIndicator ? "smooth" : "auto",
      inline: "center",
      block: "nearest",
    });
    const timer = setTimeout(updateChipScroll, 300);
    return () => clearTimeout(timer);
  }, [activeIndex, hasPlacedIndicator, updateChipScroll]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    scrollToIndex(activeIndexRef.current + (event.key === "ArrowRight" ? 1 : -1));
  };

  const atStart = activeIndex <= 0;
  const atEnd = activeIndex >= groups.length - 1;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* The primary control. A horizontal swipe also works, but not every
          pointing device makes one easy, and vertical scrolling belongs to the
          skill list inside each card. */}
      <CarouselArrow
        side="left"
        disabled={atStart}
        onClick={() => scrollToIndex(activeIndex - 1)}
      />
      <CarouselArrow side="right" disabled={atEnd} onClick={() => scrollToIndex(activeIndex + 1)} />

      {/* One row always: bounded strictly to the search bar width on both sides with lateral fade */}
      <div className="mx-auto w-full max-w-[960px] px-6 shrink-0 pb-4">
        <div
          ref={chipScrollRef}
          onScroll={updateChipScroll}
          className="relative w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{
            maskImage: `linear-gradient(to right, ${
              canScrollLeft ? "transparent 0%, black 28px" : "black 0%"
            }, black calc(100% - 28px), ${
              canScrollRight ? "transparent 100%" : "black 100%"
            })`,
            WebkitMaskImage: `linear-gradient(to right, ${
              canScrollLeft ? "transparent 0%, black 28px" : "black 0%"
            }, black calc(100% - 28px), ${
              canScrollRight ? "transparent 100%" : "black 100%"
            })`,
          }}
        >
          <div
            ref={chipRowRef}
            role="tablist"
            aria-label="Jump to a category"
            className="relative flex w-max items-center gap-1.5"
          >
            {indicator ? (
              <span
                aria-hidden="true"
                /* `left-0` is load-bearing: without it an absolutely positioned
                   flex child sits at its static position — inside the row's
                   padding — and `translateX(offsetLeft)`, which is already
                   measured from the padding box, adds that inset a second time. */
                className={cn(
                  "absolute top-0 bottom-0 left-0 rounded-full bg-foreground/12",
                  hasPlacedIndicator && "transition-[transform,width] duration-300 ease-out",
                )}
                style={{
                  transform: `translateX(${indicator.left}px)`,
                  width: `${indicator.width}px`,
                }}
              />
            ) : null}
            {groups.map((group, index) => {
              const isActive = index === activeIndex;
              return (
                <button
                  key={group.category}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  ref={(node) => {
                    chipRefs.current[index] = node;
                  }}
                  onClick={() => scrollToIndex(index)}
                  className={cn(
                    "relative z-10 shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                    isActive
                      ? "border-transparent font-medium text-foreground"
                      : "border-border/50 text-muted-foreground hover:border-border hover:text-foreground",
                  )}
                >
                  {group.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div
        ref={trackRef}
        role="group"
        aria-label="Skill categories"
        tabIndex={0}
        onScroll={measureActive}
        onKeyDown={onKeyDown}
        className={cn(
          "relative flex min-h-0 flex-1 snap-x snap-mandatory gap-5 overflow-x-auto overflow-y-hidden",
          "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          "focus-visible:outline-none",
        )}
        /* Equal insets so the first and last cards can still reach the middle. */
        style={{ paddingLeft: metrics.inset, paddingRight: metrics.inset }}
      >
        {groups.map((group, index) => {
          const isActive = index === activeIndex;
          return (
            <div
              key={group.category}
              ref={(node) => {
                cardRefs.current[index] = node;
              }}
              aria-current={isActive ? "true" : undefined}
              style={{ width: metrics.cardWidth }}
              className={cn(
                "flex h-full shrink-0 snap-center flex-col",
                "rounded-2xl border border-border/50 bg-card/40",
                "transition-[opacity,transform] duration-300 ease-out",
                isActive
                  ? "opacity-100 [transform:scale(1)]"
                  : "opacity-65 [transform:scale(0.98)]",
              )}
            >
              <button
                type="button"
                onClick={() => scrollToIndex(index)}
                /* A raised band so the card reads as titled content rather
                   than a list whose first row happens to be bold. */
                className={cn(
                  "flex shrink-0 items-baseline justify-between gap-3 rounded-t-2xl px-5 py-3.5 text-left",
                  "border-b border-border/50 bg-foreground/[0.05] transition-colors",
                  "hover:bg-foreground/[0.08]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                )}
              >
                <span className="text-sm font-semibold text-foreground">{group.label}</span>
                <span className="text-[11px] tabular-nums text-muted-foreground/70">
                  {group.skills.length}
                </span>
              </button>
              <div
                data-skill-list
                className="min-h-0 flex-1 divide-y divide-border/25 overflow-y-auto overscroll-contain"
              >
                {group.skills.map((skill) => renderSkill(skill))}
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
}

function CarouselArrow({
  side,
  disabled,
  onClick,
}: {
  side: "left" | "right";
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-xl"
      disabled={disabled}
      onClick={onClick}
      aria-label={side === "left" ? "Previous category" : "Next category"}
      className={cn(
        // Both breakpoints, or the size variant's `sm:` rule wins back.
        "absolute top-1/2 z-10 size-12 -translate-y-1/2 rounded-full sm:size-12",
        /*
         * The outline variant is `dark:bg-input/32` — a 32%-opacity surface
         * that all but vanishes against the dark canvas these sit over. These
         * float above content, so they need a solid ground of their own, a real
         * rim and a shadow to lift them off the cards behind.
         */
        "border-border bg-popover shadow-lg dark:bg-popover",
        "hover:bg-accent dark:hover:bg-accent",
        "disabled:pointer-events-none disabled:opacity-0",
        side === "left" ? "left-4" : "right-4",
      )}
    >
      {/* Sized here rather than through the button, whose base rule only
          applies to icons without a size class of their own. */}
      <HugeiconsIcon
        icon={side === "left" ? __ArrowLeftHugeIcon : __ArrowRightHugeIcon}
        className="size-6 opacity-100"
      />
    </Button>
  );
}
