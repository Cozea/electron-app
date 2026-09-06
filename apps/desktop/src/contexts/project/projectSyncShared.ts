import { createContext, useContext, type ReactNode } from "react";

import type { Id } from "../../../../../convex/_generated/dataModel";
import type { CollabEncryptionBootstrap } from "@/features/collaboration/hooks/useCollabSession";
import type { SyncProgress } from "@/lib/sync/types";

export type CollabSessionStatus = "idle" | "loading" | "ready" | "error";
export type CollabEncryptionStatus = CollabEncryptionBootstrap["status"];

export interface ProjectSyncContextValue {
  isSynced: boolean;
  cloudSyncBlocked: boolean;
  lastSyncAt: number | null;
  workspaceId: string | null;
  gitCwd: string | null;
  collaborationEnabled: boolean;
  collaborationMode: "shared" | "local";
  activeBranch: string | null;
  sharedBranch: string | null;
  collabSessionStatus: CollabSessionStatus;
  collabSessionError: string | null;
  collabEncryptionStatus: CollabEncryptionStatus | null;
  triggerSync: () => Promise<void>;
  syncProgress: SyncProgress;
}

export const ProjectSyncContext = createContext<ProjectSyncContextValue | null>(null);

export const IDLE_SYNC_PROGRESS: SyncProgress = {
  status: "idle",
  message: "",
  current: 0,
  total: 0,
  logs: [],
};

export function useProjectSyncContext() {
  const ctx = useContext(ProjectSyncContext);
  if (!ctx) {
    throw new Error("useProjectSyncContext must be used within ProjectSyncProvider");
  }
  return ctx;
}

export function useOptionalProjectSyncContext() {
  return useContext(ProjectSyncContext);
}

export interface ProjectSyncProviderProps {
  children: ReactNode;
  projectId: Id<"projects"> | null;
  principalId: Id<"devicePrincipals"> | null;
  displayName: string | null;
  workspaceId: string | null;
  workspaceRevision: number;
  laneId?: string | null;
  projectSlug: string | null;
  gitCwd?: string | null;
  lastSyncAt?: number;
  skipInitialSyncCheck?: boolean;
  onFilesChanged?: () => void;
  collaborationEnabled?: boolean;
  activeBranch?: string | null;
  sharedBranch?: string | null;
  documentScopeId?: string | null;
}
