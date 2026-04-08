import { createContext, useContext, type ReactNode } from "react";

import type { Id } from "../../../../convex/_generated/dataModel";
import type { SyncProgress } from "@/lib/sync/types";

export interface ProjectSyncContextValue {
  isSynced: boolean;
  cloudSyncBlocked: boolean;
  lastSyncAt: number | null;
  projectPath: string | null;
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
  userId: Id<"users"> | null;
  userName: string | null;
  projectSlug: string | null;
  localPath: string | null;
  lastSyncAt?: number;
  skipInitialSyncCheck?: boolean;
  onFilesChanged?: () => void;
}
