import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("observes shell recovery on the transport URL independently of native-only media", () => {
  const source = readFileSync(new URL("../../apps/desktop/src/features/workbench/assistant/useWorkbenchAssistantTileController.tsx", import.meta.url), "utf8");
  // Wiring guard: legacy shell recovery must remain observable when cutover
  // disables native media/detail. Runtime owner behavior has separate tests.
  //
  // These patterns tolerate line wrapping and redundant parens — the contract is
  // which value each hook is keyed on, not how the expression is formatted.
  expect(
    /const transportBaseUrl = substrateTransport\.active\s*\?\s*\(?\s*substrateTransport\.shadowBaseUrl \?\? null\s*\)?\s*:\s*null/.test(
      source,
    ),
  ).toBe(true);
  expect(
    /const shellConnection = useT3ConnectionStatus\(\s*transportBaseUrl \? t3ShellConnectionKey\(transportBaseUrl\) : null,?\s*\)/.test(
      source,
    ),
  ).toBe(true);
  expect(/const mediaBaseUrl = t3CutoverActive \? transportBaseUrl : null/.test(source)).toBe(true);
  // The point of the guard: shell recovery keys on the transport URL, never on
  // the cutover-gated media URL, or it goes dark exactly when cutover is on.
  expect(/const shellConnection = useT3ConnectionStatus\(\s*mediaBaseUrl/.test(source)).toBe(false);
});
