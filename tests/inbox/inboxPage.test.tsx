import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InboxPage } from "@/features/inbox/pages/InboxPage";

let mockIncoming: any = [];
vi.mock("convex/react", () => ({
  useQuery: () => mockIncoming,
  useMutation: () => vi.fn(),
  useConvex: () => ({}),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ principalId: "principal-123" }),
}));

vi.mock("@/lib/useProjectHeader", () => ({
  useProjectHeader: vi.fn(),
}));

vi.mock("@/lib/navigation", () => ({
  useViewTransitionNavigate: () => vi.fn(),
}));

describe("InboxPage", () => {
  it("renders empty state when there are no pending invitations", () => {
    mockIncoming = [];
    const markup = renderToStaticMarkup(<InboxPage />);
    expect(markup).toContain("Inbox");
    expect(markup).toContain("No pending invitations");
  });

  it("renders pending invitations with project name, role, and actions", () => {
    mockIncoming = [
      {
        _id: "enrollment-1",
        projectId: "proj-1",
        projectName: "Crossand Mobile",
        inviterName: "Alice's MacBook",
        role: "developer",
        status: "pending",
        expiresAt: Date.now() + 5 * 24 * 60 * 60 * 1000,
      },
    ];
    const markup = renderToStaticMarkup(<InboxPage />);
    expect(markup).toContain("Crossand Mobile");
    expect(markup).toContain("Alice&#x27;s MacBook");
    expect(markup).toContain("Developer");
    expect(markup).toContain("Accept");
    expect(markup).toContain("Decline");
    expect(markup).toContain("Expires in 5 days");
  });
});
