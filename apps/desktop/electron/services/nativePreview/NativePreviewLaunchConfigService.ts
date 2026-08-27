import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import type {
  NativePreviewLaunchConfig,
  NativePreviewLaunchKind,
  NativePreviewResolveLaunchConfigRequest,
  NativePreviewResolveLaunchConfigResult,
} from '../../../../../shared/nativePreviewTypes'
import { resolveAuthorizedWorkspaceAccess } from '../../workspaces/authorization.ts'
import { NativePreviewRuntimeBridgeService } from './NativePreviewRuntimeBridgeService'

interface PackageJsonShape {
  version?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_METRO_PORT = 8081
const EXPO_EDITOR_SENTINEL = 'cozea-native-preview-editor'

function shellEscape(argument: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(argument)) {
    return argument
  }

  return `'${argument.replace(/'/g, `'\\''`)}'`
}

function buildShellCommand(command: string, args: string[]): string {
  return [shellEscape(command), ...args.map(shellEscape)].join(' ')
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T
  } catch {
    return null
  }
}

function resolveAppRoot(): string {
  if (process.env.APP_ROOT) {
    return path.resolve(process.env.APP_ROOT)
  }

  return path.resolve(__dirname, '../../..')
}

function resolveRuntimeDir(): string {
  return path.join(resolveAppRoot(), 'native-preview-runtime')
}

function resolveEditorProxyPath(): string {
  return path.join(__dirname, 'cozea-native-preview-editor-proxy.js')
}

function resolvePackageVersion(): string {
  const packageJsonPath = path.join(resolveAppRoot(), 'package.json')
  const packageJson = readJsonFile<PackageJsonShape>(packageJsonPath)
  return packageJson?.version?.trim() || '0.0.0'
}

function resolveProjectPackageJson(projectPath: string): PackageJsonShape | null {
  return readJsonFile<PackageJsonShape>(path.join(projectPath, 'package.json'))
}

function detectLaunchKind(packageJson: PackageJsonShape | null): NativePreviewLaunchKind | null {
  const dependencies = {
    ...packageJson?.dependencies,
    ...packageJson?.devDependencies,
  }

  if (dependencies.expo) {
    return 'expo'
  }

  if (dependencies['react-native']) {
    return 'react-native'
  }

  return null
}

function resolveCustomMetroConfigPath(projectPath: string): string | null {
  for (const candidate of ['metro.config.js', 'metro.config.ts']) {
    const candidatePath = path.join(projectPath, candidate)
    if (fs.existsSync(candidatePath)) {
      return candidatePath
    }
  }

  return null
}

function assertRuntimeFileExists(filePath: string, label: string): void {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} is missing at ${filePath}`)
  }
}

function resolveReactNativeCliPath(projectPath: string): string {
  const reactNativeEntry = require.resolve('react-native', { paths: [projectPath] })
  const reactNativeRoot = path.dirname(reactNativeEntry)
  const cliPath = path.join(reactNativeRoot, 'cli.js')

  assertRuntimeFileExists(cliPath, 'React Native CLI entry')
  return cliPath
}

function buildLaunchEnv(options: {
  projectPath: string
  port: number
  devtoolsPort: number
  runtimeBridgePort: number | null
  runtimeDir: string
  customMetroConfigPath: string | null
  kind: NativePreviewLaunchKind
}): Record<string, string> {
  const env: Record<string, string> = {
    NODE_PATH: path.join(options.projectPath, 'node_modules'),
    RCT_METRO_PORT: String(options.port),
    RCT_DEVTOOLS_PORT: String(options.devtoolsPort),
    COZEA_NATIVE_PREVIEW_LIB_PATH: options.runtimeDir,
    COZEA_NATIVE_PREVIEW_VERSION: resolvePackageVersion(),
    REACT_EDITOR: resolveEditorProxyPath(),
  }

  if (options.runtimeBridgePort !== null) {
    env.COZEA_NATIVE_PREVIEW_RUNTIME_BRIDGE_PORT = String(options.runtimeBridgePort)
  }

  if (options.customMetroConfigPath) {
    env.COZEA_NATIVE_PREVIEW_METRO_CONFIG_PATH = options.customMetroConfigPath
  }

  if (options.kind === 'expo') {
    env.DEBUG = 'expo:utils:editor'
    env.EXPO_EDITOR = EXPO_EDITOR_SENTINEL
  }

  return env
}

function buildLaunchCommand(options: {
  projectPath: string
  kind: NativePreviewLaunchKind
  runtimeDir: string
  port: number
  resetCache: boolean
}): string {
  if (options.kind === 'expo') {
    const expoStartPath = path.join(options.runtimeDir, 'expo', 'expo_start.js')
    assertRuntimeFileExists(expoStartPath, 'Expo start shim')

    const args = [expoStartPath, '--port', String(options.port)]
    if (options.resetCache) {
      args.push('--clear')
    }

    return buildShellCommand('node', args)
  }

  const reactNativeCliPath = resolveReactNativeCliPath(options.projectPath)
  const metroConfigPath = path.join(options.runtimeDir, 'metro_config.js')
  const metroReporterPath = path.join(options.runtimeDir, 'metro_reporter.js')
  assertRuntimeFileExists(metroConfigPath, 'Native preview Metro config')
  assertRuntimeFileExists(metroReporterPath, 'Native preview Metro reporter')

  const args = [
    reactNativeCliPath,
    'start',
    ...(options.resetCache ? ['--reset-cache'] : []),
    '--no-interactive',
    '--port',
    String(options.port),
    '--config',
    metroConfigPath,
    '--customLogReporterPath',
    metroReporterPath,
  ]

  return buildShellCommand('node', args)
}

function buildLaunchLabel(kind: NativePreviewLaunchKind): string {
  return kind === 'expo' ? 'Expo Native Preview Metro' : 'React Native Preview Metro'
}

async function allocateTcpPort(preferredPort = 0): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer()

    const listen = (port: number) => {
      server.listen({
        host: '127.0.0.1',
        port,
      })
    }

    server.unref()
    server.once('error', (error) => {
      if (preferredPort > 0) {
        preferredPort = 0
        listen(0)
        return
      }
      reject(error)
    })
    server.once('listening', () => {
      const address = server.address()
      const resolvedPort =
        typeof address === 'object' && address ? address.port : null
      if (!resolvedPort) {
        server.close(() => reject(new Error('Failed to resolve an available native preview devtools port.')))
        return
      }
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(resolvedPort)
      })
    })

    listen(preferredPort)
  })
}

export class NativePreviewLaunchConfigService {
  private static instance: NativePreviewLaunchConfigService | null = null

  public static getInstance(): NativePreviewLaunchConfigService {
    if (!NativePreviewLaunchConfigService.instance) {
      NativePreviewLaunchConfigService.instance = new NativePreviewLaunchConfigService()
    }

    return NativePreviewLaunchConfigService.instance
  }

  public async resolveLaunchConfig(
    request: NativePreviewResolveLaunchConfigRequest
  ): Promise<NativePreviewResolveLaunchConfigResult> {
    if (request.platform !== 'ios') {
      return {
        success: false,
        error: `Unsupported native preview platform: ${request.platform}`,
      }
    }

    try {
      const { projectRootPath } = await resolveAuthorizedWorkspaceAccess({
        workspaceId: request.workspaceId,
        operation: 'read-file',
      })

      const runtimeDir = resolveRuntimeDir()
      assertRuntimeFileExists(runtimeDir, 'Native preview runtime directory')
      assertRuntimeFileExists(resolveEditorProxyPath(), 'Native preview editor proxy')

      const packageJson = resolveProjectPackageJson(projectRootPath)
      const kind = detectLaunchKind(packageJson)

      if (!kind) {
        return {
          success: false,
          error: 'Project is not an Expo or React Native app.',
        }
      }

      const port = request.preferredPort && request.preferredPort > 0
        ? request.preferredPort
        : DEFAULT_METRO_PORT
      const devtoolsPort = await allocateTcpPort()
      const runtimeBridge = await NativePreviewRuntimeBridgeService.getInstance().getBridge(projectRootPath)
      const runtimeBridgePort = runtimeBridge.port
      const customMetroConfigPath = resolveCustomMetroConfigPath(projectRootPath)
      const env = buildLaunchEnv({
        projectPath: projectRootPath,
        port,
        devtoolsPort,
        runtimeBridgePort,
        runtimeDir,
        customMetroConfigPath,
        kind,
      })
      const command = buildLaunchCommand({
        projectPath: projectRootPath,
        kind,
        runtimeDir,
        port,
        resetCache: Boolean(request.resetCache),
      })

      const config: NativePreviewLaunchConfig = {
        workspaceId: request.workspaceId,
        platform: request.platform,
        kind,
        port,
        devtoolsPort,
        runtimeBridgePort,
        label: buildLaunchLabel(kind),
        command,
        env,
        runtimeDir,
        customMetroConfigPath,
      }

      return {
        success: true,
        config,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to resolve native preview launch config',
      }
    }
  }
}
