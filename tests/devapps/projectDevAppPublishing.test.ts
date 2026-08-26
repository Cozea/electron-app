import { beforeEach, describe, expect, it, vi } from "vitest";

const { detectFramework, getDevServerConfig } = vi.hoisted(() => ({
  detectFramework: vi.fn(),
  getDevServerConfig: vi.fn(),
}));

vi.mock("@/utils/projectDetector", () => ({
  detectFramework,
  getDevServerConfig,
}));

import {
  buildProjectDevAppSourceFingerprint,
  prepareProjectDevApp,
} from "@/features/devapps/projectDevAppPublishing";

beforeEach(() => {
  detectFramework.mockReset();
  getDevServerConfig.mockReset();
});

describe("project DevApp source fingerprint", () => {
  it("is stable when file discovery returns the same snapshot in another order", async () => {
    const first = await buildProjectDevAppSourceFingerprint({
      framework: "vite-react",
      devCommand: "bun run dev",
      devPort: 5173,
      headCommit: "abc123",
      changedFiles: [
        { path: "src/App.tsx", hash: "hash-app" },
        { path: "src/main.tsx", hash: "hash-main" },
      ],
      files: [
        { path: "src/App.tsx", sizeBytes: 42 },
        { path: "package.json", sizeBytes: 180 },
      ],
    });
    const reordered = await buildProjectDevAppSourceFingerprint({
      framework: "vite-react",
      devCommand: "bun run dev",
      devPort: 5173,
      headCommit: "abc123",
      changedFiles: [
        { path: "src/main.tsx", hash: "hash-main" },
        { path: "src\\App.tsx", hash: "hash-app" },
      ],
      files: [
        { path: "package.json", sizeBytes: 180 },
        { path: "src\\App.tsx", sizeBytes: 42 },
      ],
    });

    expect(reordered).toBe(first);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when modified source content changes", async () => {
    const base = {
      framework: "vite-react",
      devCommand: "bun run dev",
      devPort: 5173,
      files: [{ path: "src/App.tsx", sizeBytes: 42 }],
    };
    const before = await buildProjectDevAppSourceFingerprint({
      ...base,
      changedFiles: [{ path: "src/App.tsx", hash: "before" }],
    });
    const after = await buildProjectDevAppSourceFingerprint({
      ...base,
      changedFiles: [{ path: "src/App.tsx", hash: "after" }],
    });

    expect(after).not.toBe(before);
  });

  it("refuses to publish a fallback command that has no matching package script", async () => {
    detectFramework.mockResolvedValue({
      framework: "vite-react",
      displayName: "Vite React",
      devCommand: "npm run dev",
      devPort: 5173,
    });
    getDevServerConfig.mockResolvedValue({
      command: "npm run dev",
      port: 5173,
      label: "Vite React Dev",
      suggestions: [],
      requiresUserSelection: false,
      packageDirectory: null,
      commandVerified: false,
    });

    await expect(prepareProjectDevApp("workspace-without-dev-script")).rejects.toThrow(
      "could not find a runnable DevApp script",
    );
  });
});
