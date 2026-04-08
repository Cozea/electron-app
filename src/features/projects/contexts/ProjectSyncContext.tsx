export {
  IDLE_SYNC_PROGRESS,
  ProjectSyncContext,
  useOptionalProjectSyncContext,
  useProjectSyncContext,
  type ProjectSyncContextValue,
  type ProjectSyncProviderProps,
} from "@/features/projects/contexts/projectSyncShared";

import { ProjectSyncProviderRuntime } from "@/features/projects/contexts/ProjectSyncProviderRuntime";
import type { ProjectSyncProviderProps } from "@/features/projects/contexts/projectSyncShared";

export function ProjectSyncProvider(props: ProjectSyncProviderProps) {
  return <ProjectSyncProviderRuntime {...props} />;
}
