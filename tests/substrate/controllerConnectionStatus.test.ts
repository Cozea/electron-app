import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("observes shell recovery on the transport URL independently of native-only media", () => {
  const source = readFileSync(new URL("../../apps/desktop/src/features/workbench/assistant/useWorkbenchAssistantTileController.tsx", import.meta.url), "utf8");
  // Wiring guard: legacy shell recovery must remain observable when cutover
  // disables native media/detail. Runtime owner behavior has separate tests.
  expect(/const transportBaseUrl = substrateTransport\.active \? substrateTransport\.shadowBaseUrl \?\? null : null/.test(source)).toBe(true);
  expect(/const shellConnection = useT3ConnectionStatus\(transportBaseUrl \? t3ShellConnectionKey\(transportBaseUrl\) : null\)/.test(source)).toBe(true);
  expect(/const mediaBaseUrl = t3CutoverActive \? transportBaseUrl : null/.test(source)).toBe(true);
});
