import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import { InboxPage } from "@/features/inbox/pages/InboxPage";

let mockIncoming: any = [];
let mockSessionInvitations: any = [];
let mockOrganizationInvitations: any = [];
vi.mock("convex/react", () => ({
  useQuery: (query: any) => {
    switch (getFunctionName(query)) {
      case "collaborationSessions:listIncomingInvitations":
        return mockSessionInvitations;
      case "organizations:listIncomingEnrollments":
        return mockOrganizationInvitations;
      default:
        return mockIncoming;
    }
  },
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

const DAY_MS = 24 * 60 * 60 * 1000;

describe("InboxPage", () => {
  it("renders empty state when there are no pending invitations", () => {
    mockIncoming = [];
    mockSessionInvitations = [];
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
        expiresAt: Date.now() + 5 * DAY_MS,
      },
    ];
    mockSessionInvitations = [];
    const markup = renderToStaticMarkup(<InboxPage />);
    expect(markup).toContain("Crossand Mobile");
    expect(markup).toContain("Alice&#x27;s MacBook");
    expect(markup).toContain("Developer");
    expect(markup).toContain("Accept");
    expect(markup).toContain("Decline");
    expect(markup).toContain("Expires in 5 days");
  });

  it("renders organization invitations beside project ones, each under its own title", () => {
    mockIncoming = [
      {
        _id: "enrollment-1",
        projectId: "proj-1",
        projectName: "Crossand Mobile",
        inviterName: "Alice's MacBook",
        role: "developer",
        status: "pending",
        expiresAt: Date.now() + 5 * DAY_MS,
      },
    ];
    mockOrganizationInvitations = [
      {
        _id: "org-enrollment-1",
        organizationId: "org-1",
        organizationName: "Crossand",
        groupId: "grp_0123",
        inviterName: "Bob's Mac mini",
        role: "member",
        status: "pending",
        expiresAt: Date.now() + 3 * DAY_MS,
      },
    ];
    mockSessionInvitations = [];
    const markup = renderToStaticMarkup(<InboxPage />);
    expect(markup).toContain("Organization invitations");
    expect(markup).toContain("Device invitations");
    expect(markup).toContain("Crossand</h3>");
    expect(markup).toContain("Bob&#x27;s Mac mini");
    expect(markup).toContain("Member");
    expect(markup).toContain("Expires in 3 days");
    expect(markup).not.toContain("No pending invitations");
    mockOrganizationInvitations = [];
  });

  it("renders live session invitations with their branch and a join action", () => {
    mockIncoming = [];
    mockSessionInvitations = [
      {
        invitationId: "invitation-1",
        sessionId: "session-1",
        publicSessionId: "czs_0123456789abcdef",
        projectId: "proj-2",
        projectName: "Atlas",
        branchName: "feature/live",
        targetBranch: "main",
        role: "developer",
        sessionLifecycle: "ACTIVE",
        inviterName: "Sam's MacBook",
        expiresAt: Date.now() + 2 * DAY_MS,
        createdAt: Date.now(),
      },
    ];
    const markup = renderToStaticMarkup(<InboxPage />);
    expect(markup).toContain("Live sessions");
    expect(markup).toContain("Atlas");
    expect(markup).toContain("feature/live");
    expect(markup).toContain("which merges into main");
    expect(markup).toContain("Join session");
    expect(markup).not.toContain("No pending invitations");
    expect(markup).not.toContain("Device invitations");
  });
});
