import net from "node:net"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const HELPER = `
const net = require('node:net');
if (process.argv[1] !== 'get') process.exit(0);
let input = ''; process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; if (input.length > 8192) process.exit(1); });
process.stdin.on('end', () => {
  const socket = net.createConnection(process.env.COZEA_GIT_CREDENTIAL_SOCKET);
  socket.setTimeout(5000, () => socket.destroy());
  socket.on('connect', () => socket.end(input));
  socket.on('data', chunk => process.stdout.write(chunk));
  socket.on('error', () => process.exitCode = 1);
});`

function quote(value: string): string { return `'${value.replace(/'/g, `'\\''`)}'` }

/** A per-operation credential helper. Only socket location and helper code go
 * into Git's environment; credentials never enter argv, config files or env. */
export async function withGitRepositoryCredential<T>(
  remoteUrl: string,
  token: string,
  operation: (environment: Record<string, string>) => Promise<T>,
): Promise<T> {
  const match = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(remoteUrl)
  if (!match || !token || /[\r\n\0]/.test(token) || token.length > 16000) throw new Error("Invalid scoped Git credential")
  const repository = `${match[1]}/${match[2]}`.toLowerCase()
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cz-git-"))
  const socketPath = path.join(directory, "auth.sock")
  const sockets = new Set<net.Socket>()
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
    socket.on("error", () => socket.destroy())
    socket.setTimeout(5000, () => socket.destroy())
    let input = ""
    socket.setEncoding("utf8")
    socket.on("data", (chunk: string) => {
      input += chunk
      if (input.length > 8192) socket.destroy()
    })
    socket.on("end", () => {
      const fields = new Map<string, string>()
      for (const line of input.split("\n")) {
        if (!line) continue
        const separator = line.indexOf("=")
        const key = line.slice(0, separator)
        if (separator < 1 || fields.has(key)) { socket.end(); return }
        fields.set(key, line.slice(separator + 1))
      }
      const requested = fields.get("path")?.replace(/\.git$/, "").toLowerCase()
      if (fields.get("protocol") !== "https" || fields.get("host") !== "github.com" || requested !== repository) {
        socket.end(); return
      }
      socket.end(`username=x-access-token\npassword=${token}\n\n`)
    })
  })
  try {
    await fs.chmod(directory, 0o700)
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve) })
    await fs.chmod(socketPath, 0o600)
    const config = [
      ["credential.helper", ""],
      ["credential.helper", `!${quote(process.execPath)} -e ${quote(HELPER)} --`],
      ["credential.useHttpPath", "true"],
      ["credential.interactive", "false"],
      ["http.followRedirects", "false"],
    ]
    const environment: Record<string, string> = { COZEA_GIT_CREDENTIAL_SOCKET: socketPath,
      GIT_CONFIG_COUNT: String(config.length), GIT_CONFIG_PARAMETERS: "", GIT_TERMINAL_PROMPT: "0",
      GIT_ASKPASS: "/usr/bin/false", SSH_ASKPASS: "/usr/bin/false", GIT_TRACE: "0", GIT_TRACE_CURL: "0", GIT_CURL_VERBOSE: "0" }
    config.forEach(([key, value], index) => { environment[`GIT_CONFIG_KEY_${index}`] = key!; environment[`GIT_CONFIG_VALUE_${index}`] = value! })
    return await operation(environment)
  } finally {
    for (const socket of sockets) socket.destroy()
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
    await fs.rm(directory, { recursive: true, force: true })
  }
}
