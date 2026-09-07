import { describe, expect, it, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { WorkbenchAssistantTabStatus } from "@/features/workbench/assistant/WorkbenchAssistantTabStatus";
import type { WorkbenchAssistantChatTile } from "@/lib/workbenchStore";

vi.mock("@/substrate/useSubstrateChatTransport", () => ({
  useSubstrateChatTransport: () => ({
    active: true,
    shadowBaseUrl: "http://127.0.0.1:13959",
    shadowStatus: null,
    loading: false,
    error: null,
  }),
}));

vi.mock("@/substrate/t3CutoverStore", () => ({
  useT3CutoverActive: () => true,
}));

let mockConnectionStatus: {
  phase: "connecting" | "connected" | "reconnecting" | "error";
  attempt: number;
  error: string | null;
} | null = null;

vi.mock("@/substrate/t3ConnectionStatus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/substrate/t3ConnectionStatus")>();
  return {
    ...actual,
    useT3ConnectionStatus: () => mockConnectionStatus,
  };
});

let mockThreadDetailError: string | null = null;
vi.mock("@/features/assistant/model/threadDetailStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/assistant/model/threadDetailStore")>();
  return {
    ...actual,
    useThreadDetailStore: (selector: any) =>
      selector({
        byThreadId: {
          "thread-123": {
            error: mockThreadDetailError,
          },
        },
      }),
  };
});

let mockRuntimeStatus: {
  phase: "idle" | "starting" | "ready" | "error";
  wsUrl: string | null;
  lastError: string | null;
  updatedAt: number;
} = {
  phase: "ready",
  wsUrl: null,
  lastError: null,
  updatedAt: 0,
};

vi.mock("@/features/workbench/useAssistantRuntimeStatus", () => ({
  useAssistantRuntimeStatus: () => mockRuntimeStatus,
}));

const mockTile: WorkbenchAssistantChatTile = {
  id: "tile-1",
  type: "assistantChat",
  title: "hey",
  threadId: "thread-123",
  provider: "codex",
  createdAt: Date.now(),
};

describe("WorkbenchAssistantTabStatus", () => {
  beforeEach(() => {
    mockConnectionStatus = null;
    mockThreadDetailError = null;
    mockRuntimeStatus = {
      phase: "ready",
      wsUrl: null,
      lastError: null,
      updatedAt: 0,
    };
  });

  it("renders null during normal connected phase (no attention icon)", () => {
    mockConnectionStatus = { phase: "connected", attempt: 0, error: null };

    const html = renderToStaticMarkup(<WorkbenchAssistantTabStatus tile={mockTile} />);
    expect(html).toBe("");
  });

  it("renders null during transient connecting phase (no loading spinner as requested)", () => {
    mockConnectionStatus = { phase: "connecting", attempt: 0, error: null };

    const html = renderToStaticMarkup(<WorkbenchAssistantTabStatus tile={mockTile} />);
    expect(html).toBe("");
  });

  it("renders attention icon when connection is reconnecting", () => {
    mockConnectionStatus = { phase: "reconnecting", attempt: 1, error: null };

    const html = renderToStaticMarkup(<WorkbenchAssistantTabStatus tile={mockTile} />);
    expect(html).toContain('data-slot="assistant-tab-attention"');
    expect(html).toContain("text-amber-500");
    expect(html).toContain("Connection interrupted. Reconnecting");
  });

  it("renders attention icon when connection has an error", () => {
    mockConnectionStatus = {
      phase: "error",
      attempt: 2,
      error: "WebSocket disconnected unexpectedly",
    };

    const html = renderToStaticMarkup(<WorkbenchAssistantTabStatus tile={mockTile} />);
    expect(html).toContain('data-slot="assistant-tab-attention"');
    expect(html).toContain("WebSocket disconnected unexpectedly");
  });

  it("renders attention icon when runtime has an error", () => {
    mockRuntimeStatus = {
      phase: "error",
      wsUrl: null,
      lastError: "Local chat runtime failed to start",
      updatedAt: 0,
    };

    const html = renderToStaticMarkup(<WorkbenchAssistantTabStatus tile={mockTile} />);
    expect(html).toContain('data-slot="assistant-tab-attention"');
    expect(html).toContain("Local chat runtime failed to start");
  });

  it("renders attention icon when thread detail has an error", () => {
    mockThreadDetailError = "Thread failed to initialize";

    const html = renderToStaticMarkup(<WorkbenchAssistantTabStatus tile={mockTile} />);
    expect(html).toContain('data-slot="assistant-tab-attention"');
    expect(html).toContain("Thread failed to initialize");
  });

  it("verifies ChatConnectionNotice is removed from CozeaChatSurface", () => {
    const chatSurfaceSource = readFileSync(
      resolve(process.cwd(), "apps/desktop/src/features/assistant/chat/CozeaChatSurface.tsx"),
      "utf8",
    );
    expect(chatSurfaceSource).not.toContain("<ChatConnectionNotice");
  });

  it("verifies WorkbenchDockTab renders WorkbenchAssistantTabStatus for assistantChat tiles", () => {
    const dockPanelsSource = readFileSync(
      resolve(process.cwd(), "apps/desktop/src/features/workbench/WorkbenchDockPanels.tsx"),
      "utf8",
    );
    expect(dockPanelsSource).toContain("<WorkbenchAssistantTabStatus tile={tile} />");
  });
});
