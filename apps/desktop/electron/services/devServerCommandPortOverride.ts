const PORT_OVERRIDE_FLAG_BY_FRAMEWORK: Record<string, string | null> = {
  angular: '--port',
  astro: '--port',
  expo: '--port',
  gatsby: '--port',
  nextjs: '--port',
  nuxt: '--port',
  qwik: '--port',
  remix: '--port',
  'solid-start': '--port',
  sveltekit: '--port',
  'vite-react': '--port',
  'vite-svelte': '--port',
  'vite-vue': '--port',
}

function normalizeFramework(framework: string | null | undefined): string | null {
  const trimmed = framework?.trim().toLowerCase()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function stripTrailingForwardedPortArgs(command: string): string {
  return command
    .replace(/\s+--\s+(?:--port|-p)\s+\d+\s*$/i, '')
    .replace(/\s+(?:--port|-p)\s+\d+\s*$/i, '')
    .trim()
}

function buildPortOverrideArg(flag: string, port: number): string {
  return `${flag} ${port}`
}

function applyScriptPortOverride(command: string, portArg: string): string {
  const base = stripTrailingForwardedPortArgs(command)

  // npm needs `--` to stop parsing flags itself. pnpm, Bun, and Yarn pass
  // arguments after the script name directly; forwarding a literal separator
  // makes frameworks such as Next treat `--port` as an application path.
  if (/^npm\s+run\s+/i.test(base)) {
    return `${base} -- ${portArg}`.trim()
  }

  if (
    /^pnpm\s+run\s+/i.test(base) ||
    /^bun\s+run\s+/i.test(base) ||
    /^yarn(?:\s+run)?\s+/i.test(base)
  ) {
    return `${base} ${portArg}`.trim()
  }

  return `${base} ${portArg}`.trim()
}

export function applyDevServerPortOverride(input: {
  command: string
  framework?: string | null
  port: number
}): string {
  const normalizedCommand = normalizeWhitespace(input.command)
  if (!normalizedCommand) {
    return normalizedCommand
  }

  const normalizedFramework = normalizeFramework(input.framework)
  const flag = normalizedFramework
    ? PORT_OVERRIDE_FLAG_BY_FRAMEWORK[normalizedFramework]
    : null

  if (!flag) {
    return normalizedCommand
  }

  return applyScriptPortOverride(normalizedCommand, buildPortOverrideArg(flag, input.port))
}

export function applyDevServerPortPlaceholder(command: string, port: number): string {
  return command.replace(/\{port\}/gi, String(port))
}
