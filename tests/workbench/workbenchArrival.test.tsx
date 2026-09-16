import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { useWorkbenchArrival } from "@/features/workbench/workbenchArrival";

const workbenchDir = resolve(__dirname, "../../apps/desktop/src/features/workbench");

function ArrivalProbe({ isActive, isReady }: { isActive: boolean; isReady: boolean }) {
  return <span>{useWorkbenchArrival(isActive, isReady) ? "settling" : "settled"}</span>;
}

describe("workbench arrival", () => {
  it("starts settling when the session mounts in the foreground", () => {
    expect(renderToStaticMarkup(<ArrivalProbe isActive isReady={false} />)).toContain("settling");
    expect(renderToStaticMarkup(<ArrivalProbe isActive isReady />)).toContain("settling");
  });

  it("does not settle a parked session", () => {
    expect(renderToStaticMarkup(<ArrivalProbe isActive={false} isReady />)).toContain("settled");
  });

  it("turns off transitions under a settling session host", () => {
    const css = readFileSync(resolve(workbenchDir, "workbench.css"), "utf8");
    expect(css).toMatch(
      /\[data-workbench-arrival="settling"\] \*[\s\S]*?\{\s*transition: none !important;/,
    );
  });

  it("gives tile content no enter animation", () => {
    for (const file of ["WorkbenchTileChrome.tsx", "WorkbenchSelectionTile.tsx"]) {
      expect(readFileSync(resolve(workbenchDir, file), "utf8")).not.toContain("animate-in");
    }
  });
});
