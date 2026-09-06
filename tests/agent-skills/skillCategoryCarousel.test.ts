import { describe, expect, it } from "vitest";

import {
  centeredScrollTarget,
  findCenteredIndex,
  measureCarouselMetrics,
  reanchorCategoryIndex,
} from "../../apps/desktop/src/features/projects/components/AgentSkillCategoryCarousel";

describe("which category card is centred", () => {
  const centers = [200, 700, 1200, 1700];

  it("picks the card nearest the middle of the viewport", () => {
    expect(findCenteredIndex(centers, 210)).toBe(0);
    expect(findCenteredIndex(centers, 690)).toBe(1);
    expect(findCenteredIndex(centers, 1650)).toBe(3);
  });

  it("resolves a card sitting exactly between two to the earlier one", () => {
    expect(findCenteredIndex(centers, 450)).toBe(0);
  });

  it("survives having no cards", () => {
    expect(findCenteredIndex([], 500)).toBe(0);
  });
});

/**
 * A smooth scroll reports a centred index for every frame it travels, so
 * jumping from the first category to the fifth passed through the three in
 * between. The highlight followed each one for a frame, which read as a blink
 * before it slid. Only the destination of a programmatic scroll counts.
 */
describe("the highlight during a smooth scroll", () => {
  const centers = [400, 1180, 1960, 2740, 3520, 4300];

  function framesBetween(from: number, to: number, steps = 12): number[] {
    return Array.from({ length: steps }, (_, i) => from + ((to - from) * (i + 1)) / steps);
  }

  it("would otherwise report every category it passes", () => {
    const reported = framesBetween(centers[0], centers[4]).map((center) =>
      findCenteredIndex(centers, center),
    );
    expect(new Set(reported)).toEqual(new Set([0, 1, 2, 3, 4]));
  });

  it("reports only the destination once the pending target gates it", () => {
    const pending = 4;
    const accepted = framesBetween(centers[0], centers[4])
      .map((center) => findCenteredIndex(centers, center))
      .filter((index) => index === pending);
    expect(new Set(accepted)).toEqual(new Set([pending]));
  });

  it("still follows a hand-driven scroll, which has no destination", () => {
    const reported = framesBetween(centers[0], centers[1], 4).map((center) =>
      findCenteredIndex(centers, center),
    );
    expect(reported.at(-1)).toBe(1);
  });
});

/**
 * Switching the Installed / Not installed filter rebuilds the category list.
 * Deriving the selection from scroll position let it drift to whichever card
 * sat under the middle of the rebuilt track and then settle back — a visible
 * move-and-return. The selection follows the category instead.
 */
describe("keeping the selection when the category list changes", () => {
  const before = ["memory", "code", "testing", "design", "ops"];

  it("follows the selected category to its new position", () => {
    const after = ["code", "design", "ops"];
    expect(reanchorCategoryIndex(after, "design", 3)).toBe(1);
  });

  it("stays put when the list is unchanged", () => {
    expect(reanchorCategoryIndex(before, "testing", 2)).toBe(2);
  });

  it("falls back to position when the category filtered away entirely", () => {
    const after = ["code", "design"];
    expect(reanchorCategoryIndex(after, "memory", 4)).toBe(1);
  });

  it("never points past the end of a shorter list", () => {
    expect(reanchorCategoryIndex(["code"], null, 7)).toBe(0);
  });

  it("survives an empty list", () => {
    expect(reanchorCategoryIndex([], "code", 3)).toBe(0);
  });
});

describe("centring the selected category card", () => {
  /** The whole point: the card lands under the middle, not against the left inset. */
  it("puts the card's centre on the track's centre", () => {
    const { cardWidth, inset } = measureCarouselMetrics(1400)
    const firstCardLeft = inset
    const scroll = centeredScrollTarget(firstCardLeft, cardWidth, 1400)
    const cardCentreOnScreen = firstCardLeft - scroll + cardWidth / 2
    expect(cardCentreOnScreen).toBeCloseTo(700, 5)
  })

  it("leaves the first card centred without scrolling", () => {
    // The inset exists so the first card can reach the middle; if it were
    // smaller, the card could never centre because scrollLeft cannot go below 0.
    const { cardWidth, inset } = measureCarouselMetrics(1400)
    expect(centeredScrollTarget(inset, cardWidth, 1400)).toBe(0)
    expect(inset + cardWidth / 2).toBeCloseTo(700, 5)
  })

  it("never returns a negative scroll offset", () => {
    expect(centeredScrollTarget(0, 900, 1400)).toBe(0)
  })

  it("keeps the card inside the track at every width", () => {
    for (const width of [500, 900, 1200, 1600, 2400, 3200]) {
      const { cardWidth, inset } = measureCarouselMetrics(width)
      expect(cardWidth).toBeLessThanOrEqual(Math.max(width, 320))
      expect(inset).toBeGreaterThanOrEqual(24)
      // Centred means equal gutters, which is exactly what the inset is.
      if (cardWidth < width) expect(inset).toBeCloseTo((width - cardWidth) / 2, 5)
    }
  })

  it("caps the card so it does not sprawl on a wide window", () => {
    expect(measureCarouselMetrics(4000).cardWidth).toBe(960)
    expect(measureCarouselMetrics(300).cardWidth).toBe(320)
  })

  it("shows a sliver of the neighbouring cards, so the row reads as scrollable", () => {
    const { cardWidth } = measureCarouselMetrics(1400)
    expect(cardWidth).toBeLessThan(1400)
  })
})
