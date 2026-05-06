import { useEffect, useState } from "react";

function normalizeProjectPath(workspaceId: string): string {
  return workspaceId.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Resolve a canonical git cwd for the current project.
 *
 * This intentionally only returns a cwd when the project's own local path is the
 * repo root, so nested folders do not accidentally inherit a parent checkout.
 */
export function useProjectGitCwd(workspaceId: string | null): string | null {
  const [gitCwd, setGitCwd] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceId) {
      setGitCwd(null);
      return;
    }

    const normalizedProjectPath = normalizeProjectPath(workspaceId);
    let cancelled = false;

    const loadGitCwd = async () => {
      try {
        const statusResult = await window.electronAPI.workspaceSync.gitStatus({
          workspaceId,
        });
        if (cancelled) {
          return;
        }

        const normalizedTopLevelPath =
          statusResult.success && statusResult.topLevelPath
            ? normalizeProjectPath(statusResult.topLevelPath)
            : null;

        if (
          statusResult.success &&
          statusResult.isRepo &&
          normalizedTopLevelPath === normalizedProjectPath
        ) {
          setGitCwd(normalizedTopLevelPath);
          return;
        }

        setGitCwd(null);
      } catch {
        if (!cancelled) {
          setGitCwd(null);
        }
      }
    };

    void loadGitCwd();
    const interval = window.setInterval(() => {
      void loadGitCwd();
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [workspaceId]);

  return gitCwd;
}
