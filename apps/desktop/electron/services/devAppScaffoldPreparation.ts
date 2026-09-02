import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const COMMAND_TIMEOUT_MS = 5 * 60_000;

export interface ScaffoldCommandResult {
  status: number | null;
  output: string;
}

export type ScaffoldCommandRunner = (
  command: string,
  args: string[],
  cwd: string,
) => ScaffoldCommandResult;

export interface DevAppScaffoldPreparation {
  /** A `bun.lock` exists, so the package can reach the contained build. */
  lockfile: boolean;
  /** The scaffold is recorded in git rather than left as an uncommitted tree. */
  committed: boolean;
  warnings: string[];
}

function runCommand(command: string, args: string[], cwd: string): ScaffoldCommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: COMMAND_TIMEOUT_MS,
    env: { ...process.env, CI: "1" },
  });
  if (result.error) return { status: null, output: result.error.message };
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

/** Bun writes no lockfile for a package that declares nothing to lock. */
function declaresDependencies(packageRoot: string): boolean {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as Record<string, Record<string, string> | undefined>;
    return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"].some(
      (field) => Object.keys(manifest[field] ?? {}).length > 0,
    );
  } catch {
    return false;
  }
}

function firstMeaningfulLine(output: string): string {
  const lines = output
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.startsWith("$"));
  // Tools announce their version before they fail, and the banner explains nothing.
  const line = lines.find((entry) => /error|fatal|failed|cannot|not found/i.test(entry)) ?? lines[0];
  return line ? line.slice(0, 300) : "no output";
}

/**
 * Brings a freshly scaffolded package up to what publication requires.
 *
 * A contained DevApp build needs a lockfile and a recorded tree, so a scaffold without
 * them is created already unable to publish — a failure that would otherwise surface much
 * later, from the publish dialog, naming a file the author never knew to make. Failures are
 * reported rather than thrown: a package that cannot install is still a working development
 * preview, and destroying the scaffold would help nobody.
 */
export function prepareScaffoldedDevAppProject(
  packageRoot: string,
  run: ScaffoldCommandRunner = runCommand,
): DevAppScaffoldPreparation {
  const warnings: string[] = [];

  // Only an executable package needs a lockfile; a dependency-free view publishes as a
  // static artifact and never reaches the contained build.
  const needsLockfile = declaresDependencies(packageRoot);
  const install = run("bun", ["install"], packageRoot);
  if (install.status !== 0 && needsLockfile) {
    warnings.push(
      `Installing dependencies failed, so this package has no bun.lock and cannot be published yet: ${firstMeaningfulLine(install.output)}`,
    );
  }
  const lockfile = fs.existsSync(path.join(packageRoot, "bun.lock"));
  if (install.status === 0 && needsLockfile && !lockfile) {
    warnings.push(
      "Installing dependencies produced no bun.lock, so this package cannot be published yet.",
    );
  }

  let committed = false;
  const inRepository = run("git", ["rev-parse", "--is-inside-work-tree"], packageRoot).status === 0;
  if (inRepository) {
    const staged = run("git", ["add", "-A"], packageRoot);
    if (staged.status !== 0) {
      warnings.push(`Staging the scaffold failed: ${firstMeaningfulLine(staged.output)}`);
    } else {
      const commit = run("git", ["commit", "-m", "feat: scaffold Cozea DevApp"], packageRoot);
      // An empty commit means the tree was already recorded, which is the state we wanted.
      committed = commit.status === 0 || /nothing to commit/i.test(commit.output);
      if (!committed) {
        warnings.push(`Recording the scaffold in git failed: ${firstMeaningfulLine(commit.output)}`);
      }
    }
  }

  return { lockfile, committed, warnings };
}
