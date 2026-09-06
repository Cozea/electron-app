import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

const surfaceSource = readSource(
  "apps/desktop/src/features/assistant/chat/CozeaChatSurface.tsx",
);
const panelSource = readSource(
  "apps/desktop/src/features/assistant/chat/ComposerPendingUserInputPanel.tsx",
);

/**
 * A pending question can be taller than the tile it renders in. The options
 * list scrolls, but only if every flex ancestor between it and the tile is
 * allowed to shrink: a flex item defaults to `min-height: auto`, which refuses
 * to go below its content, so one missing `min-h-0` pushes the composer — and
 * with it the way to answer — off the bottom of a small tile.
 */
describe("the composer's scroll chain in a small tile", () => {
  it("lets the undocked composer shrink, and caps it so the thread stays visible", () => {
    expect(surfaceSource).toMatch(
      /className="flex max-h-\[70%\] min-h-0 flex-col px-3 pt-1\.5 pb-4 sm:px-5 sm:pt-2 sm:pb-5"/,
    );
  });

  it("lets the composer form shrink", () => {
    expect(surfaceSource).toContain(
      'className="relative z-30 mx-auto flex w-full min-w-0 max-w-3xl min-h-0 flex-col"',
    );
  });

  it("lets the composer shell shrink", () => {
    expect(surfaceSource).toContain("relative flex min-h-0 flex-wrap");
  });

  it("bounds the full-width pending-question row and allows its contents to shrink", () => {
    expect(surfaceSource).toContain(
      '<div className="flex min-h-0 max-h-[40vh] basis-full flex-col border-b',
    );
  });

  it("scrolls the options inside the panel, below a question that stays put", () => {
    // Match the scroll-chain classes rather than the whole class string: the
    // card also carries enter-animation utilities, and this assertion exists to
    // catch a dropped `min-h-0`, not to freeze unrelated styling.
    expect(panelSource).toMatch(/className="flex h-full min-h-0 flex-col px-4 py-3 sm:px-5[ "]/);
    expect(panelSource).toContain(
      'className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain"',
    );
  });
});
