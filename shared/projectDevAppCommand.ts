export type ProjectDevAppPackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface ProjectDevAppCommandInvocation {
  packageManager: ProjectDevAppPackageManager;
  packageDirectory: string | null;
  scriptName: string;
}

const MAX_COMMAND_LENGTH = 512;
const SAFE_SCRIPT_NAME = /^[A-Za-z0-9@:_./-]+$/;
const SAFE_DIRECTORY = /^[A-Za-z0-9@._ /-]+$/;
const PROJECT_DEV_APP_PREVIEW_SCRIPTS = new Set(["dev", "start", "develop", "web", "serve"]);
const DIRECTORY_FLAGS: Record<ProjectDevAppPackageManager, string> = {
  npm: "--prefix",
  pnpm: "--dir",
  yarn: "--cwd",
  bun: "--cwd",
};

function unwrapDirectoryToken(value: string): string | null {
  const startsQuoted = value.startsWith("'") || value.startsWith('"');
  const endsQuoted = value.endsWith("'") || value.endsWith('"');
  if (startsQuoted !== endsQuoted) {
    return null;
  }

  if (startsQuoted) {
    if (value[0] !== value[value.length - 1]) {
      return null;
    }
    return value.slice(1, -1);
  }

  return value;
}

function normalizePackageDirectory(value: string): string | null {
  const unwrapped = unwrapDirectoryToken(value);
  if (!unwrapped || !SAFE_DIRECTORY.test(unwrapped)) {
    return null;
  }
  if (unwrapped.startsWith("/") || /^[A-Za-z]:/.test(unwrapped)) {
    return null;
  }

  const segments = unwrapped.split("/");
  if (
    segments.some(
      (segment) => !segment || segment !== segment.trim() || segment === "." || segment === "..",
    )
  ) {
    return null;
  }

  return segments.join("/");
}

/**
 * Parse the only command shape a private project DevApp may persist and
 * auto-launch. The command must invoke one local package.json script, with an
 * optional safe project-relative package directory and no shell syntax.
 */
export function parseProjectDevAppCommand(
  value: string | null | undefined,
): ProjectDevAppCommandInvocation | null {
  const command = value?.trim();
  if (!command || command.length > MAX_COMMAND_LENGTH) {
    return null;
  }

  // These characters can change shell control flow or interpolate commands.
  if (/[\r\n;&|<>`$\\]/.test(command)) {
    return null;
  }

  const match = command.match(
    /^((?:npm|pnpm|yarn|bun)(?:\.cmd)?)(?:\s+(--prefix|--dir|--cwd)\s+('[^']*'|"[^"]*"|[^\s]+))?\s+(?:(start|dev)|run\s+([^\s]+))$/i,
  );
  if (!match) {
    return null;
  }

  const packageManager = match[1]
    .replace(/\.cmd$/i, "")
    .toLowerCase() as ProjectDevAppPackageManager;
  const directoryFlag = match[2]?.toLowerCase();
  const directoryToken = match[3];
  const scriptName = match[4] ?? match[5];
  if (!scriptName || !SAFE_SCRIPT_NAME.test(scriptName)) {
    return null;
  }
  if (scriptName !== scriptName.toLowerCase() || !PROJECT_DEV_APP_PREVIEW_SCRIPTS.has(scriptName)) {
    return null;
  }
  if (packageManager === "npm" && match[4] === "dev") {
    return null;
  }

  if (!directoryFlag && !directoryToken) {
    return { packageManager, packageDirectory: null, scriptName };
  }
  if (!directoryFlag || !directoryToken || directoryFlag !== DIRECTORY_FLAGS[packageManager]) {
    return null;
  }

  const packageDirectory = normalizePackageDirectory(directoryToken);
  if (!packageDirectory) {
    return null;
  }

  return { packageManager, packageDirectory, scriptName };
}

export function isProjectDevAppCommand(value: string | null | undefined): boolean {
  return parseProjectDevAppCommand(value) !== null;
}
