import { detectFramework, getDevServerConfig } from "@/utils/projectDetector";
import { isProjectDevAppCommand } from "@shared/projectDevAppCommand";

export interface PreparedProjectDevApp {
  framework: string;
  devCommand: string;
  devPort: number;
  sourceRevision?: string;
  sourceFingerprint: string;
}

interface ProjectDevAppFingerprintInput {
  framework: string;
  devCommand: string;
  devPort: number;
  headCommit?: string;
  changedFiles: ReadonlyArray<{ path: string; hash: string }>;
  files: ReadonlyArray<{ path: string; sizeBytes: number }>;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

export async function buildProjectDevAppSourceFingerprint(
  input: ProjectDevAppFingerprintInput,
): Promise<string> {
  const snapshot = JSON.stringify({
    framework: input.framework,
    devCommand: input.devCommand,
    devPort: input.devPort,
    headCommit: input.headCommit ?? null,
    changedFiles: [...input.changedFiles]
      .map((file) => ({ path: normalizePath(file.path), hash: file.hash }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    files: [...input.files]
      .map((file) => ({ path: normalizePath(file.path), sizeBytes: file.sizeBytes }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshot));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function prepareProjectDevApp(workspaceId: string): Promise<PreparedProjectDevApp> {
  const [frameworkInfo, config] = await Promise.all([
    detectFramework(workspaceId),
    getDevServerConfig(workspaceId),
  ]);

  if (config.requiresUserSelection) {
    throw new Error(
      "Cozea found multiple possible DevApp commands. Open the Dev Server tile and choose a command first.",
    );
  }

  if (!config.commandVerified) {
    throw new Error(
      "Cozea could not find a runnable DevApp script in this project's package.json. Add a dev, start, develop, web, or serve script first.",
    );
  }

  const devCommand = config.command.trim();
  if (!devCommand) {
    throw new Error("Cozea could not find a command that starts this project.");
  }
  if (!isProjectDevAppCommand(devCommand)) {
    throw new Error(
      "Cozea can launch DevApps only from a recognized preview script (dev, start, develop, web, or serve) without extra shell arguments.",
    );
  }

  const runtimeResult = await window.electronAPI.runtime.ensureForCommand({
    workspaceId,
    command: devCommand,
  });
  if (!runtimeResult.success) {
    throw new Error(runtimeResult.error || "Cozea could not prepare the project runtime.");
  }

  const filesResult = await window.electronAPI.project.listFiles({ workspaceId });
  if (!filesResult.success) {
    throw new Error(filesResult.error || "Cozea could not inspect the project files.");
  }

  let sourceRevision: string | undefined;
  let changedPaths: string[] = [];
  try {
    const gitStatus = await window.electronAPI.workspaceSync.gitStatus({ workspaceId });
    if (gitStatus.success) {
      sourceRevision = gitStatus.headCommit;
      changedPaths = gitStatus.changedPaths ?? [];
    }
  } catch {
    // A project does not need to be a Git repository to become a DevApp.
  }

  const changedFiles = await Promise.all(
    changedPaths.map(async (path) => {
      try {
        const result = await window.electronAPI.workspaceSync.hashFile({ workspaceId, path });
        return {
          path,
          hash: "hash" in result ? result.hash : "missing",
        };
      } catch {
        return { path, hash: "missing" };
      }
    }),
  );

  const framework =
    frameworkInfo.framework === "unknown"
      ? config.label.replace(/\s+Dev$/i, "").trim() || "web"
      : frameworkInfo.framework;
  const sourceFingerprint = await buildProjectDevAppSourceFingerprint({
    framework,
    devCommand,
    devPort: config.port,
    headCommit: sourceRevision,
    changedFiles,
    files: filesResult.files ?? [],
  });

  return {
    framework,
    devCommand,
    devPort: config.port,
    ...(sourceRevision ? { sourceRevision } : {}),
    sourceFingerprint,
  };
}
