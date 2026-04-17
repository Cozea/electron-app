import { useEffect, useState } from "react";

import { projectOpenDesktopClient } from "@/features/projects/lib/projectOpenDesktopClient";

function normalizeProjectPath(projectPath: string): string {
  return projectPath.replace(/\\/g, "/").replace(/\/+$/, "");
}

/**
 * Resolve a canonical git cwd for the current project.
 *
 * This intentionally only returns a cwd when the project's own local path is the
 * repo root, so nested folders do not accidentally inherit a parent checkout.
 */
export function useProjectGitCwd(projectPath: string | null): string | null {
  const [gitCwd, setGitCwd] = useState<string | null>(null);

  useEffect(() => {
    if (!projectPath) {
      setGitCwd(null);
      return;
    }

    const normalizedProjectPath = normalizeProjectPath(projectPath);
    let cancelled = false;

    const loadGitCwd = async () => {
      try {
        const statusResult = await projectOpenDesktopClient.sync.gitStatus({
          projectPath,
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
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [projectPath]);

  return gitCwd;
}
