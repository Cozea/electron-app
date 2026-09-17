import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const COMMAND_TIMEOUT_MS = 5 * 60_000;
/**
 * Bounds what a talkative install or commit can hold in the main process. Past
 * it the child is stopped and the step reported as failed, rather than read as
 * having said less than it did.
 */
const COMMAND_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export interface ScaffoldCommandResult {
  status: number | null;
  /** Standard output alone, for commands whose answer is parsed. */
  stdout: string;
  /** Standard output and error together, for reporting. */
  output: string;
}

/**
 * Asynchronous because this runs in the Electron main process. It used
 * `spawnSync`, so a `bun install` (up to five minutes) or a commit hook froze
 * every window until it finished.
 */
export type ScaffoldCommandRunner = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<ScaffoldCommandResult>;

export interface DevAppScaffoldPreparation {
  /** A `bun.lock` exists, so the package can reach the contained build. */
  lockfile: boolean;
  /** The scaffold is recorded in git rather than left as an uncommitted tree. */
  committed: boolean;
  warnings: string[];
}

function commandEnv(command: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CI: "1" };
  if (command === "git") {
    // The same rules GitProcess applies: never wait on a credential prompt
    // nobody can see, and keep output in the language the checks below read.
    env.GIT_TERMINAL_PROMPT = "0";
    env.LC_ALL = "C";
    env.LANG = "C";
  }
  return env;
}

export const runScaffoldCommand: ScaffoldCommandRunner = (command, args, cwd) =>
  new Promise((resolve) => {
    const stdout: Buffer[] = [];
    const combined: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const settle = (result: ScaffoldCommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const decode = (chunks: Buffer[]) => Buffer.concat(chunks).toString("utf8");

    const child = spawn(command, args, { cwd, env: commandEnv(command), stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle({ status: null, stdout: decode(stdout), output: `${command} timed out` });
    }, COMMAND_TIMEOUT_MS);

    const collect = (isStdout: boolean) => (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > COMMAND_MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        settle({ status: null, stdout: decode(stdout), output: `${command} produced too much output` });
        return;
      }
      if (isStdout) stdout.push(chunk);
      combined.push(chunk);
    };
    child.stdout.on("data", collect(true));
    child.stderr.on("data", collect(false));
    child.on("error", (error) => settle({ status: null, stdout: "", output: error.message }));
    child.on("close", (status) => settle({ status, stdout: decode(stdout), output: decode(combined) }));
  });

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

function nulSeparated(stdout: string): string[] {
  return stdout.split("\0").filter((entry) => entry.length > 0);
}

/**
 * Brings a freshly scaffolded package up to what publication requires.
 *
 * A contained DevApp build needs a lockfile and a recorded tree, so a scaffold without
 * them is created already unable to publish — a failure that would otherwise surface much
 * later, from the publish dialog, naming a file the author never knew to make. Failures are
 * reported rather than thrown: a package that cannot install is still a working development
 * preview, and destroying the scaffold would help nobody.
 *
 * Records only the files the scaffold wrote. This ran `git add -A` and a bare
 * `git commit`, which from any directory stage and commit the whole repository:
 * creating a DevApp committed whatever else the author had in progress, under
 * a message claiming it was the scaffold.
 */
export async function prepareScaffoldedDevAppProject(
  packageRoot: string,
  createdFiles: readonly string[],
  run: ScaffoldCommandRunner = runScaffoldCommand,
): Promise<DevAppScaffoldPreparation> {
  const warnings: string[] = [];

  // Only an executable package needs a lockfile; a dependency-free view publishes as a
  // static artifact and never reaches the contained build.
  const needsLockfile = declaresDependencies(packageRoot);
  const install = await run("bun", ["install"], packageRoot);
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
  const inRepository =
    (await run("git", ["rev-parse", "--is-inside-work-tree"], packageRoot)).status === 0;
  if (inRepository) {
    const scaffoldPaths = [...createdFiles, ...(lockfile ? ["bun.lock"] : [])];
    // Leaves out what .gitignore excludes instead of forcing it in; naming an
    // ignored path to `git add` is an error, not a no-op.
    const pending = await run(
      "git",
      ["ls-files", "-z", "--others", "--modified", "--exclude-standard", "--", ...scaffoldPaths],
      packageRoot,
    );
    const paths = pending.status === 0 ? nulSeparated(pending.stdout) : [];
    if (pending.status !== 0) {
      warnings.push(`Reading the scaffold's git state failed: ${firstMeaningfulLine(pending.output)}`);
    } else if (paths.length === 0) {
      // Either already recorded, or every file is ignored.
      const tracked = await run("git", ["ls-files", "-z", "--", ...scaffoldPaths], packageRoot);
      committed = tracked.status === 0 && nulSeparated(tracked.stdout).length > 0;
      if (!committed) {
        warnings.push("The scaffold's files are all ignored by .gitignore, so it was not recorded in git.");
      }
    } else {
      const staged = await run("git", ["add", "--", ...paths], packageRoot);
      if (staged.status !== 0) {
        warnings.push(`Staging the scaffold failed: ${firstMeaningfulLine(staged.output)}`);
      } else {
        // `--only` commits these paths and leaves anything else the author
        // staged exactly where it was.
        const commit = await run(
          "git",
          ["commit", "--only", "-m", "feat: scaffold Cozea DevApp", "--", ...paths],
          packageRoot,
        );
        committed = commit.status === 0;
        if (!committed) {
          warnings.push(`Recording the scaffold in git failed: ${firstMeaningfulLine(commit.output)}`);
        }
      }
    }
  }

  return { lockfile, committed, warnings };
}
