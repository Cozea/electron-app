import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

function buildEnvironmentCaptureCommand(names: ReadonlyArray<string>): string {
  return names
    .map((name) => {
      return [
        `printf '%s\\n' '__COZEA_ENV_${name}_START__'`,
        `printenv ${name} || true`,
        `printf '%s\\n' '__COZEA_ENV_${name}_END__'`,
      ].join("; ");
    })
    .join("; ");
}

function extractEnvironmentValue(output: string, name: string): string | undefined {
  const startMarker = `__COZEA_ENV_${name}_START__`;
  const endMarker = `__COZEA_ENV_${name}_END__`;
  const startIndex = output.indexOf(startMarker);
  if (startIndex === -1) return undefined;

  const valueStartIndex = startIndex + startMarker.length;
  const endIndex = output.indexOf(endMarker, valueStartIndex);
  if (endIndex === -1) return undefined;

  let value = output.slice(valueStartIndex, endIndex);
  if (value.startsWith("\n")) {
    value = value.slice(1);
  }
  if (value.endsWith("\n")) {
    value = value.slice(0, -1);
  }

  return value.length > 0 ? value : undefined;
}

export async function syncShellEnvironment(): Promise<void> {
  if (process.platform !== "darwin") return;

  try {
    const shell = process.env.SHELL ?? "/bin/zsh";

    const names = ["PATH", "SSH_AUTH_SOCK"];
    const { stdout: output } = await execFile(shell, ["-ilc", buildEnvironmentCaptureCommand(names)], {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 10 * 1024 * 1024,
    });

    for (const name of names) {
      const value = extractEnvironmentValue(output, name);
      if (value !== undefined) {
        if (name === "PATH") {
          process.env.PATH = value;
        } else if (name === "SSH_AUTH_SOCK" && !process.env.SSH_AUTH_SOCK) {
          process.env.SSH_AUTH_SOCK = value;
        }
      }
    }

    console.log("[Boot] Shell environment synced successfully from", shell);
  } catch (err) {
    console.error("[Boot] Failed to sync shell environment:", err);
  }
}
