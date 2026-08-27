import type { Id } from "../../../../../../convex/_generated/dataModel";

export type ProjectInviteRole = "project_manager" | "developer" | "designer" | "viewer";

export type InviteLookupUser = {
  id: Id<"users">;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
};

export type PersonalProjectContact = {
  email: string;
  user: InviteLookupUser | null;
  lastSharedAt: number;
};

export interface ProjectRepoAccessRecord {
  accessState: "pending" | "granted" | "needs_identity" | "manual_required" | "revoked" | "error";
  errorMessage?: string;
  inviteEmail?: string;
  memberUserId?: Id<"users">;
  providerAccountHandle?: string;
}

export const PERSONAL_CONTACTS_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

export const PROJECT_INVITE_ROLE_OPTIONS: Array<{ value: ProjectInviteRole; label: string }> = [
  { value: "project_manager", label: "Project Manager" },
  { value: "developer", label: "Developer" },
  { value: "designer", label: "Designer" },
  { value: "viewer", label: "Viewer" },
];

export function cleanConvexError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback;
  return raw.replace(/^\[CONVEX.*?\]\s*/, "").replace(/\s*Called by client$/, "") || fallback;
}

export function getLinkPermissionDescription(role: ProjectInviteRole): string {
  switch (role) {
    case "project_manager":
      return "Link members can edit everything and manage project members.";
    case "developer":
      return "Link members can build and edit project code.";
    case "designer":
      return "Link members can edit design-related project content.";
    case "viewer":
      return "Link members can view the project only.";
    default:
      return "Link members receive the selected role permissions.";
  }
}

export function formatInviteeDisplayName(
  email: string,
  user: InviteLookupUser | null | undefined,
): string {
  const first = user?.firstName?.trim() ?? "";
  const last = user?.lastName?.trim() ?? "";
  const fullName = `${first} ${last}`.trim();
  if (fullName) return fullName;
  if (user?.email) return user.email;
  return email;
}

export function getInitials(value: string): string {
  const source = value.trim();
  if (!source) return "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}
