import path from 'node:path'

function resolveAppRoot(): string {
  return process.env.APP_ROOT || process.cwd()
}

export function resolveRadonResourcePath(...parts: string[]): string {
  return path.join(resolveAppRoot(), 'resources', 'radon', ...parts)
}

export function resolveRadonLibPath(): string {
  return resolveRadonResourcePath('lib')
}

export function resolveRadonSimulatorBinaryPath(platform: NodeJS.Platform = process.platform): string {
  const overridePath = process.env.COZEA_RADON_SIMULATOR_BINARY?.trim()
  if (overridePath) {
    return overridePath
  }

  let binaryName = 'simulator-server-linux'
  if (platform === 'darwin') {
    binaryName = 'simulator-server-macos'
  } else if (platform === 'win32') {
    binaryName = 'simulator-server-windows.exe'
  }

  return resolveRadonResourcePath('dist', binaryName)
}
